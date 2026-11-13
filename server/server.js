// Author: GW19 <imgw19@gmail.com>
// Based on Socket.IO

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const rules = require('../app/chat-rules.js');

const LOBBY = rules.LOBBY;

// Action labels used to build the log lines shown in the chat body. They are
// concatenated as <username> + action + location + roomName, so the trailing
// spaces are load bearing.
const logCreate = 'created ';
const logJoin = 'joined ';
const logLeft = 'left ';

// Location labels: the lab is the site as a whole, a room is inside it.
const logLab = 'the chat lab';
const logRoom = 'room ';

// Wraps a room name where it appears inside a log line.
function quoteRoom (roomName) {
  return '"' + roomName + '"';
}

function createApp () {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  // Routing
  app.use(express.static(path.join(__dirname, '..', 'app')));

  // --- Occupancy -----------------------------------------------------------
  //
  // Room membership is read straight from the Socket.IO adapter rather than
  // kept in counters of our own. Hand-maintained counts drift: a disconnect
  // that races a room switch, or a reconnect, used to leave rooms stuck in
  // the list or counts running negative.

  // Sockets that have not sent a valid 'add user' yet are not chat users.
  function isChatUser (socket) {
    return Boolean(socket && socket.data && socket.data.username);
  }

  function loggedInSockets () {
    return Array.from(io.sockets.sockets.values()).filter(isChatUser);
  }

  function userCount () {
    return loggedInSockets().length;
  }

  // { roomName: numberOfUsers }, lobby always present, private per-socket
  // rooms (Socket.IO puts every socket in a room named after its own id)
  // excluded.
  function roomOccupancy () {
    const adapter = io.sockets.adapter;
    const occupancy = Object.create(null);
    occupancy[LOBBY] = 0;

    for (const [roomName, members] of adapter.rooms) {
      if (adapter.sids.has(roomName)) {
        continue; // a socket's own private room, not a chat room
      }

      let count = 0;
      for (const socketId of members) {
        if (isChatUser(io.sockets.sockets.get(socketId))) {
          count += 1;
        }
      }

      if (count > 0 || roomName === LOBBY) {
        occupancy[roomName] = count;
      }
    }

    return occupancy;
  }

  function roomExists (roomName) {
    const occupancy = roomOccupancy();
    return Object.prototype.hasOwnProperty.call(occupancy, roomName) &&
      occupancy[roomName] > 0;
  }

  // Push the room list to every logged-in client. Each client needs its own
  // current room so it can highlight it, so this is a loop rather than a
  // single broadcast. Previously only the sockets in the two affected rooms
  // were refreshed, which left everyone else looking at a stale list.
  function broadcastRoomList () {
    const occupancy = roomOccupancy();
    for (const socket of loggedInSockets()) {
      socket.emit('show room list', socket.data.currentRoom, occupancy);
    }
  }

  // --- Connection ----------------------------------------------------------

  io.on('connection', function (socket) {
    socket.data.username = null;
    socket.data.currentRoom = LOBBY;

    // when the client emits 'new message', this listens and executes
    socket.on('new message', function (data) {
      if (!isChatUser(socket) || !rules.isValidMessage(data)) {
        return;
      }

      // we tell the client to execute 'new message'
      socket.broadcast.to(socket.data.currentRoom).emit('new message', {
        username: socket.data.username,
        message: data
      });
    });

    // when the client emits 'add user', this listens and executes
    socket.on('add user', function (username) {
      if (isChatUser(socket)) {
        return;
      }

      // The browser limits this too, but a crafted client can send anything,
      // so the server decides.
      const name = rules.normalizeName(username);
      if (!rules.isValidUsername(name)) {
        socket.emit('invalid input', {
          field: 'username',
          message: 'Your nickname must be 1-14 characters and cannot be blank'
        });
        return;
      }

      // we store the username in the socket session for this client
      socket.data.username = name;
      socket.data.currentRoom = LOBBY;

      // Default to join the lobby.
      socket.join(LOBBY);

      socket.emit('login', {
        numUsers: userCount()
      });

      // echo to everyone that a person has connected
      socket.broadcast.emit('user joined', {
        username: name,
        numUsers: userCount(),
        logAction: logJoin,
        logLocation: logLab,
        roomName: '',
        userJoinOrLeftRoom: false
      });

      // First join: show the room list to everyone, including this client.
      broadcastRoomList();
    });

    // when the client emits 'typing', we broadcast it to others
    socket.on('typing', function () {
      if (!isChatUser(socket)) {
        return;
      }
      socket.broadcast.to(socket.data.currentRoom).emit('typing', {
        username: socket.data.username
      });
    });

    // when the client emits 'stop typing', we broadcast it to others.
    // Scoped to the current room: this used to broadcast globally, so a user
    // in one room could clear another user's typing indicator in a different
    // room.
    socket.on('stop typing', function () {
      if (!isChatUser(socket)) {
        return;
      }
      socket.broadcast.to(socket.data.currentRoom).emit('stop typing', {
        username: socket.data.username
      });
    });

    // when the user disconnects, perform this
    socket.on('disconnect', function () {
      if (!isChatUser(socket)) {
        return;
      }

      const name = socket.data.username;
      socket.data.username = null;

      // echo globally that this client has left
      socket.broadcast.emit('user left', {
        username: name,
        numUsers: userCount(),
        logAction: logLeft,
        logLocation: logLab,
        roomName: '',
        userJoinOrLeftRoom: false
      });

      // The adapter has already dropped this socket, so the refreshed list
      // reflects the departure.
      broadcastRoomList();
    });

    // Show the room list to this user.
    socket.on('room list', function () {
      if (!isChatUser(socket)) {
        return;
      }
      socket.emit('show room list', socket.data.currentRoom, roomOccupancy());
    });

    socket.on('join room', function (room) {
      if (!isChatUser(socket)) {
        return;
      }

      const target = rules.normalizeName(room);
      if (!rules.isValidRoomName(target)) {
        socket.emit('invalid input', {
          field: 'room',
          message: 'Room names must be 1-14 characters, using only letters, ' +
            'digits, underscores and Chinese characters'
        });
        return;
      }

      const previous = socket.data.currentRoom;
      if (target === previous) {
        return;
      }

      // Clear any typing indicator this user left behind in the old room.
      socket.broadcast.to(previous).emit('stop typing', {
        username: socket.data.username
      });

      // Before joining a room, leave the current one. ------------------------
      socket.leave(previous);
      socket.broadcast.to(previous).emit('user left', {
        username: socket.data.username,
        numUsers: userCount(),
        logAction: logLeft,
        logLocation: logRoom,
        roomName: quoteRoom(previous),
        userJoinOrLeftRoom: true
      });

      // Then join the new room. ---------------------------------------------
      // Checked before joining, so an empty room counts as a creation.
      const isNewRoom = !roomExists(target);
      socket.join(target);
      socket.data.currentRoom = target;

      socket.emit('join left result', {
        username: 'You ',
        logAction: isNewRoom ? logCreate : logJoin,
        logLocation: logRoom,
        roomName: quoteRoom(target)
      });

      socket.broadcast.to(target).emit('user joined', {
        username: socket.data.username,
        numUsers: userCount(),
        logAction: logJoin,
        logLocation: logRoom,
        roomName: quoteRoom(target),
        userJoinOrLeftRoom: true
      });

      // Every time someone joins a room, refresh the list for everyone.
      broadcastRoomList();
    });
  });

  return { app, server, io };
}

// Only listen when run directly, so tests can start their own instance on an
// ephemeral port.
if (require.main === module) {
  const port = process.env.PORT || 3232;
  const { server } = createApp();
  server.listen(port, function () {
    console.log('Server listening at port %d', port);
  });
}

module.exports = { createApp, LOBBY };
