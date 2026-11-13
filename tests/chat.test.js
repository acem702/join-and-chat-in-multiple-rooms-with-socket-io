'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { io: ioClient } = require('socket.io-client');

const { createApp, LOBBY } = require('../server/server.js');

const TIMEOUT = 3000;

// --- helpers ---------------------------------------------------------------

function startServer () {
  const { server, io } = createApp();
  return new Promise(resolve => {
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        url: `http://localhost:${port}`,
        async close () {
          io.close();
          await new Promise(done => server.close(done));
        }
      });
    });
  });
}

// Room lists are recorded from the moment the socket exists, so a list that
// arrives before a test gets around to waiting for it is not missed.
function connect (url) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true });

  socket.lastRoom = null;
  socket.lastRooms = null;
  const waiters = [];
  socket.roomListWaiters = waiters;

  socket.on('show room list', (room, rooms) => {
    socket.lastRoom = room;
    socket.lastRooms = rooms;

    for (const waiter of waiters.splice(0)) {
      if (waiter.predicate(room, rooms)) {
        waiter.resolve({ room, rooms });
      } else {
        waiters.push(waiter);
      }
    }
  });

  return socket;
}

// Waits for the next room list matching the predicate.
function nextRoomList (socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const waiter = { predicate };
    const timer = setTimeout(() => {
      const index = socket.roomListWaiters.indexOf(waiter);
      if (index >= 0) socket.roomListWaiters.splice(index, 1);
      reject(new Error('timed out waiting for room list'));
    }, TIMEOUT);

    waiter.resolve = value => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.roomListWaiters.push(waiter);
  });
}

// Resolves with the payload of the next matching event.
function waitFor (socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, TIMEOUT);

    function handler (...args) {
      if (!predicate(...args)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(args.length > 1 ? args : args[0]);
    }

    socket.on(event, handler);
  });
}

// Asserts an event does NOT arrive within a short window.
async function expectNoEvent (socket, event, ms = 400) {
  let fired = false;
  const handler = () => { fired = true; };
  socket.on(event, handler);
  await new Promise(r => setTimeout(r, ms));
  socket.off(event, handler);
  assert.equal(fired, false, `did not expect "${event}" to fire`);
}

// Connects and logs in, resolving once the server confirms and the first
// room list has landed.
async function login (url, username) {
  const socket = connect(url);
  await waitFor(socket, 'connect');

  const loggedIn = waitFor(socket, 'login');
  const firstList = nextRoomList(socket);
  socket.emit('add user', username);
  await Promise.all([loggedIn, firstList]);

  return socket;
}

// Joins a room and resolves with the room list showing the user inside it.
// `expected` is the room name after server-side normalisation, which is not
// always the string that was sent.
async function joinRoom (socket, room, expected = room) {
  const list = nextRoomList(socket, current => current === expected);
  socket.emit('join room', room);
  return (await list).rooms;
}

function roomsOf (socket) {
  return nextRoomList(socket).then(({ rooms }) => rooms);
}

// --- tests -----------------------------------------------------------------

test('lobby exists and counts the users in it', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  t.after(() => alice.close());

  assert.equal(alice.lastRoom, LOBBY);
  assert.equal(alice.lastRooms[LOBBY], 1);
});

test('headcount reflects both users', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  t.after(() => alice.close());

  const joined = waitFor(alice, 'user joined');
  const bob = await login(srv.url, 'Bob');
  t.after(() => bob.close());

  const payload = await joined;
  assert.equal(payload.username, 'Bob');
  assert.equal(payload.numUsers, 2);
});

test('joining a new room reports it as created, joining again as joined', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  const bob = await login(srv.url, 'Bob');
  t.after(() => { alice.close(); bob.close(); });

  const aliceResult = waitFor(alice, 'join left result');
  alice.emit('join room', '技術討論');
  assert.equal((await aliceResult).logAction, '已經建立');

  const bobResult = waitFor(bob, 'join left result');
  bob.emit('join room', '技術討論');
  assert.equal((await bobResult).logAction, '已經加入');
});

test('room occupancy tracks moves, and empty rooms disappear while the lobby stays', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  t.after(() => alice.close());

  let rooms = await joinRoom(alice, '技術討論');
  assert.equal(rooms['技術討論'], 1);
  assert.equal(rooms[LOBBY], 0, 'lobby is kept even when empty');

  rooms = await joinRoom(alice, '閒聊');
  assert.equal(rooms['閒聊'], 1);
  assert.ok(!('技術討論' in rooms), 'the vacated room is dropped from the list');
});

// This is the bug visible in the original: only sockets inside the two rooms
// involved in a move were refreshed, so everyone else kept a stale list.
test('a room change refreshes the list for uninvolved users too', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  const bob = await login(srv.url, 'Bob');
  t.after(() => { alice.close(); bob.close(); });

  // Alice stays in the lobby; Bob hops through two rooms she is not in.
  await joinRoom(bob, '技術討論');

  const aliceSees = roomsOf(alice);
  bob.emit('join room', '閒聊');
  const rooms = await aliceSees;

  assert.equal(rooms['閒聊'], 1);
  assert.ok(!('技術討論' in rooms),
    'Alice should not still be shown the room Bob left');
});

test('counts recover after a disconnect', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  t.after(() => alice.close());

  const bob = await login(srv.url, 'Bob');
  await joinRoom(bob, '技術討論');

  const afterLeave = roomsOf(alice);
  bob.close();
  const rooms = await afterLeave;

  assert.ok(!('技術討論' in rooms), 'room emptied by the disconnect is gone');
  assert.equal(rooms[LOBBY], 1, 'lobby count never goes negative');
});

test('messages only reach the sender\'s room', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  const bob = await login(srv.url, 'Bob');
  const carol = await login(srv.url, 'Carol');
  t.after(() => { alice.close(); bob.close(); carol.close(); });

  await joinRoom(alice, '技術討論');
  await joinRoom(bob, '技術討論');

  const bobGets = waitFor(bob, 'new message');
  alice.emit('new message', 'hello room');

  assert.equal((await bobGets).message, 'hello room');
  await expectNoEvent(carol, 'new message');
});

// 'typing' was room-scoped but 'stop typing' was broadcast globally, so a
// user in one room could clear a typing indicator in another.
test('typing and stop typing are both scoped to the room', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  const carol = await login(srv.url, 'Carol');
  t.after(() => { alice.close(); carol.close(); });

  await joinRoom(alice, '技術討論');

  alice.emit('typing');
  await expectNoEvent(carol, 'typing');

  alice.emit('stop typing');
  await expectNoEvent(carol, 'stop typing');
});

test('server rejects room names the client-side rule would block', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  t.after(() => alice.close());

  const rejected = [
    '<img src=x onerror=alert(1)>',  // the injection the room list used to run
    '',                              // empty
    '   ',                           // blank
    'a'.repeat(15),                  // too long
    'no-dashes-allowed'
  ];

  for (const name of rejected) {
    const invalid = waitFor(alice, 'invalid input');
    alice.emit('join room', name);
    const payload = await invalid;
    assert.equal(payload.field, 'room', `expected "${name}" to be rejected`);
  }

  // The user is still in the lobby and nothing stray was created.
  const pending = nextRoomList(alice);
  alice.emit('room list');
  const { room, rooms } = await pending;
  assert.equal(room, LOBBY);
  assert.deepEqual(Object.keys(rooms), [LOBBY]);
});

test('server rejects invalid usernames', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const socket = connect(srv.url);
  t.after(() => socket.close());
  await waitFor(socket, 'connect');

  const invalid = waitFor(socket, 'invalid input');
  socket.emit('add user', 'x'.repeat(15));
  assert.equal((await invalid).field, 'username');

  // Still not a chat user, so chat events are ignored.
  socket.emit('room list');
  await expectNoEvent(socket, 'show room list');
});

test('a valid room name containing spaces is normalised, not rejected', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  t.after(() => alice.close());

  const rooms = await joinRoom(alice, 'my  room ', 'my room');
  assert.equal(rooms['my room'], 1,
    'internal whitespace collapsed and ends trimmed');
});

test('oversized messages are dropped', async t => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await login(srv.url, 'Alice');
  const bob = await login(srv.url, 'Bob');
  t.after(() => { alice.close(); bob.close(); });

  alice.emit('new message', 'x'.repeat(2001));
  await expectNoEvent(bob, 'new message');

  const delivered = waitFor(bob, 'new message');
  alice.emit('new message', 'ok');
  assert.equal((await delivered).message, 'ok');
});
