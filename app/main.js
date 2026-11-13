// Author: GW19 <imgw19@gmail.com>
// Based on Socket.IO

$(function() {
  var TYPING_TIMER_LENGTH = 400; // ms
  var TYPING_EXPIRY = 7000; // ms, in case a 'stop typing' never arrives
  var ROOM_LIST_REFRESH = 30000; // ms
  var NEAR_BOTTOM_SLACK = 80; // px
  var MOBILE_QUERY = '(max-width: 719px)';
  var KEY_TAB = 9;
  var KEY_ENTER = 13;
  var KEY_ESCAPE = 27;

  // Name colours, chosen to stay legible on the dark chat surface.
  var COLORS = [
    '#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b',
    '#51cf66', '#38d9a9', '#3bc9db', '#4dabf7',
    '#748ffc', '#9775fa', '#da77f2', '#f783ac',
    '#ff8787', '#ffc078', '#ffe066', '#c0eb75',
    '#69db7c', '#63e6be', '#66d9e8', '#74c0fc',
    '#91a7ff', '#b197fc', '#e599f7', '#faa2c1',
    '#ffa8a8', '#ffd8a8', '#f0c674', '#e9c46a',
    '#5ec2b7', '#8ecae6', '#bde0fe', '#d0bfff'
  ];

  // Validation rules shared with the server (app/chat-rules.js). The server
  // revalidates everything; these only give the user faster feedback.
  var rules = window.ChatRules;

  // Initialize variables
  var $window = $(window);
  var $usernameInput = $('.usernameInput');
  var $messages = $('.messages');
  var $inputMessage = $('.inputMessage');

  var $pages = $('.pages');
  var $loginPage = $('.login.page');
  var $roomList = $('.room-list');
  var $roomFilter = $('.room-filter');
  var $roomEmpty = $('.room-empty');
  var $scrim = $('.drawer-scrim');

  var $headerTitle = $('.chat-header-title');
  var $headerMeta = $('.chat-header-meta');
  var $typingIndicator = $('.typing-indicator');

  var $btnTips = $('.btn-tips');
  var $tips = $('#effect-tips');
  var $btnCollapse = $('.btn-collapse');
  var $btnRoomsToggle = $('.btn-rooms-toggle');

  // Prompt for setting a username
  var username;
  var connected = false;
  var typing = false;
  var lastTypingTime;
  var $currentInput = $usernameInput.focus();

  // Latest room list from the server, kept so the filter can re-render
  // without asking for it again.
  var roomState = { current: null, rooms: {} };

  // Who is currently typing in this room: name -> expiry timer.
  var typingUsers = {};

  var socket = io();

  function isMobile () {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function addParticipantsMessage (data) {
    // Room joins and leaves carry their own log line; only lab-level events
    // report the headcount.
    if (data.userJoinOrLeftRoom) {
      return;
    }

    if (data.numUsers === 1) {
      log('You are the only one here right now.');
    } else {
      log('There are ' + data.numUsers + ' people in the chat lab.');
    }
  }

  // Sets the client's username
  function setUsername () {
    username = rules.normalizeName($usernameInput.val());

    if (!rules.isValidUsername(username)) {
      username = undefined;
      return;
    }

    $pages.addClass('signed-in');
    $loginPage.off('click');
    $currentInput = $inputMessage;
    $inputMessage.focus();

    // Tell the server your username
    socket.emit('add user', username);
  }

  // Sends a chat message.
  function sendMessage () {
    var message = $inputMessage.val();

    if (!connected) {
      return;
    }

    $inputMessage.val('');

    // If input is a command starting with '/'.
    if (message.charAt(0) === '/') {
      inputCommand(message);
      return;
    }

    if (!rules.isValidMessage(message)) {
      return;
    }

    addChatMessage({
      username: username,
      message: message,
      time: Date.now(),
      own: true
    });
    // tell server to execute 'new message' and send along one parameter
    socket.emit('new message', message);
  }

  // Sends a command.
  function inputCommand (message) {
    var words = message.split(' ');
    var cmd = words[0]
      .substring(1, words[0].length)
      .toLowerCase();

    switch (cmd) {
      // Command /join [room name] = join room.
      case 'join':
        words.shift();
        var room = rules.normalizeName(words.join(' '));
        if (rules.isValidRoomName(room)) {
          socket.emit('join room', room);
        } else {
          log('Room names must be 1-14 characters, using only letters, ' +
              'digits, underscores and Chinese characters');
        }
        break;

      // Command /ls = reload room list.
      case 'ls':
        socket.emit('room list');
        break;

      default:
        log('That command is not recognised');
        break;
    }
  }

  // --- Messages -------------------------------------------------------------

  function formatTime (value) {
    var date = value ? new Date(value) : new Date();
    if (isNaN(date.getTime())) {
      date = new Date();
    }
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // True when the reader is at the foot of the transcript. If they have
  // scrolled up to read, new messages must not yank them back down.
  function isNearBottom () {
    var el = $messages[0];
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_SLACK;
  }

  function scrollToBottom () {
    //noinspection JSUnresolvedVariable
    $messages[0].scrollTop = $messages[0].scrollHeight;
  }

  // A run of messages from one person names them only once.
  function continuesRunFrom (author) {
    var $last = $messages.children().last();
    return $last.length > 0 &&
      $last.hasClass('message') &&
      $last.data('author') === author;
  }

  // Log a message
  function log (message, options) {
    options = options || {};
    var $logDiv = $('<li>').addClass('log');

    if (typeof options.userConnEvent !== 'undefined') {
      var userName = options.username;
      $logDiv.append(
        $('<span class="username">')
          .text(userName)
          .css('color', getUsernameColor(userName)),
        $('<span>').text(message)
      );
    } else {
      $logDiv.append($('<span>').text(message));
    }

    addMessageElement($logDiv, options);
  }

  // Adds the visual chat message to the message list
  function addChatMessage (data, options) {
    options = options || {};

    if (!data.message) {
      return;
    }

    var author = data.username;
    var grouped = continuesRunFrom(author);

    var $time = $('<time class="message-time"/>')
      .attr('datetime', new Date(data.time || Date.now()).toISOString())
      .text(formatTime(data.time));

    var $messageBody = $('<div class="messageBody"/>').text(data.message);

    var $messageDiv = $('<li class="message"/>').data('author', author);

    if (grouped) {
      // Continuation line: no name, and the time only on hover.
      $messageDiv.addClass('grouped').append($time, $messageBody);
    } else {
      $messageDiv.append(
        $('<div class="message-meta"/>').append(
          $('<span class="username"/>')
            .text(author)
            .css('color', getUsernameColor(author)),
          $time
        ),
        $messageBody
      );
    }

    if (data.own) {
      $messageDiv.addClass('own');
    }

    addMessageElement($messageDiv, options);
  }

  // Adds a message element to the messages and scrolls to the bottom
  // el - The element to add as a message
  // options.fade - If the element should fade-in (default = true)
  // options.prepend - If the element should prepend
  //   all other messages (default = false)
  function addMessageElement (el, options) {
    var $el = $(el);

    if (!options) {
      options = {};
    }
    if (typeof options.fade === 'undefined') {
      options.fade = true;
    }
    if (typeof options.prepend === 'undefined') {
      options.prepend = false;
    }

    var follow = isNearBottom();

    // Entry is animated by CSS. jQuery's fadeIn would write an inline
    // display onto the element and break the layout inside it.
    if (!options.fade) {
      $el.addClass('no-animate');
    }
    if (options.prepend) {
      $messages.prepend($el);
    } else {
      $messages.append($el);
    }

    // Only chase the foot of the transcript if the reader was already there,
    // or if this is something they just sent themselves.
    if (follow || $el.hasClass('own')) {
      scrollToBottom();
    }
  }

  // --- Typing indicator -----------------------------------------------------
  //
  // Shown above the composer rather than as a line in the transcript, so it
  // does not scroll away or push the conversation around.

  function renderTyping () {
    var names = Object.keys(typingUsers);
    var text;

    if (names.length === 0) {
      $typingIndicator.prop('hidden', true).text('');
      return;
    }

    if (names.length === 1) {
      text = names[0] + ' is typing…';
    } else if (names.length === 2) {
      text = names[0] + ' and ' + names[1] + ' are typing…';
    } else {
      text = 'Several people are typing…';
    }

    $typingIndicator.prop('hidden', false).text(text);
  }

  function setUserTyping (name) {
    if (!name) {
      return;
    }
    if (typingUsers[name]) {
      clearTimeout(typingUsers[name]);
    }
    typingUsers[name] = setTimeout(function () {
      clearUserTyping(name);
    }, TYPING_EXPIRY);
    renderTyping();
  }

  function clearUserTyping (name) {
    if (!name || !typingUsers[name]) {
      return;
    }
    clearTimeout(typingUsers[name]);
    delete typingUsers[name];
    renderTyping();
  }

  function clearAllTyping () {
    Object.keys(typingUsers).forEach(function (name) {
      clearTimeout(typingUsers[name]);
    });
    typingUsers = {};
    renderTyping();
  }

  // Updates the typing event
  function updateTyping () {
    if (!connected) {
      return;
    }

    if (!typing) {
      typing = true;
      socket.emit('typing');
    }
    lastTypingTime = (new Date()).getTime();

    setTimeout(function () {
      var typingTimer = (new Date()).getTime();
      var timeDiff = typingTimer - lastTypingTime;
      if (timeDiff >= TYPING_TIMER_LENGTH && typing) {
        socket.emit('stop typing');
        typing = false;
      }
    }, TYPING_TIMER_LENGTH);
  }

  // Gets the color of a username.
  function getUsernameColor (username) {
    var eachCharCode = 0;
    var randIndex;
    for (var ii = 0; ii < (username || '').length; ii++) {
      eachCharCode += username.charCodeAt(ii);
    }
    randIndex = Math.abs(eachCharCode % COLORS.length);
    return COLORS[randIndex];
  }

  // --- Room list ------------------------------------------------------------

  // The lobby first, then everything else alphabetically. The order used to
  // follow whatever order the server happened to send, and a jQuery UI
  // sortable let you drag rooms around only for the next refresh to discard
  // it.
  function compareRoomNames (a, b) {
    if (a === rules.LOBBY) { return -1; }
    if (b === rules.LOBBY) { return 1; }
    return a.localeCompare(b);
  }

  function describeOccupancy (count) {
    return count === 1 ? '1 person' : count + ' people';
  }

  function visibleRoomNames () {
    var needle = $.trim($roomFilter.val()).toLowerCase();
    return Object.keys(roomState.rooms)
      .filter(function (roomName) {
        return !needle || roomName.toLowerCase().indexOf(needle) !== -1;
      })
      .sort(compareRoomNames);
  }

  function renderRoomList () {
    var names = visibleRoomNames();

    $roomList.empty();

    names.forEach(function (roomName) {
      var isCurrent = roomName === roomState.current;

      // Built as text nodes, never as an HTML string: room names come from
      // other users and would otherwise be injected into everyone's page.
      var $roomName = $('<span class="room-name"/>')
        .text(roomName)
        .attr('title', roomName);
      var $roomCount = $('<span class="room-count"/>')
        .text(roomState.rooms[roomName]);

      // A real button, so it is reachable and operable from the keyboard.
      var $roomButton = $('<button type="button" class="room-card"/>')
        .append(
          $('<span class="room-hash" aria-hidden="true"/>').text('#'),
          $roomName,
          $roomCount
        )
        .attr('aria-current', isCurrent ? 'true' : null)
        .on('click', function () {
          joinRoom(roomName);
        });

      if (isCurrent) {
        $roomButton.addClass('joined-room');
      }

      $('<li class="room-item"/>').append($roomButton).appendTo($roomList);
    });

    $roomEmpty.prop('hidden', names.length > 0);
  }

  function renderHeader () {
    var room = roomState.current;
    if (!room) {
      return;
    }
    var count = roomState.rooms[room];

    $headerTitle.text(room);
    $headerMeta.text(typeof count === 'number' ? describeOccupancy(count) : '');
    $inputMessage.attr('placeholder', 'Message #' + room);
  }

  function joinRoom (roomName) {
    socket.emit('join room', roomName);
    if (isMobile()) {
      setRoomsCollapsed(true);
    }
    $inputMessage.focus();
  }

  // --- Panels ---------------------------------------------------------------

  function setRoomsCollapsed (collapsed) {
    $pages.toggleClass('rooms-collapsed', collapsed);

    $btnCollapse
      .attr('aria-expanded', collapsed ? 'false' : 'true')
      .attr('title', collapsed ? 'Expand room list' : 'Collapse room list')
      .find('.collapse-icon').html(collapsed ? '&raquo;' : '&laquo;');

    $btnRoomsToggle
      .attr('aria-expanded', collapsed ? 'false' : 'true')
      .attr('title', collapsed ? 'Show room list' : 'Hide room list');

    // The scrim only exists for the mobile drawer.
    $scrim.prop('hidden', collapsed || !isMobile());
  }

  function roomsCollapsed () {
    return $pages.hasClass('rooms-collapsed');
  }

  function setTipsOpen (open) {
    $tips.prop('hidden', !open);
    $btnTips.attr('aria-expanded', open ? 'true' : 'false');
  }

  function tipsOpen () {
    return !$tips.prop('hidden');
  }

  // --- Events ---------------------------------------------------------------

  $window.keydown(function (event) {
    var $target = $(event.target);
    var inControl = $target.is('input, textarea, select, button, a, [contenteditable]');

    if (event.which === KEY_ESCAPE) {
      if (tipsOpen()) {
        setTipsOpen(false);
        $btnTips.focus();
      } else if (isMobile() && !roomsCollapsed()) {
        setRoomsCollapsed(true);
        $inputMessage.focus();
      }
      return;
    }

    // Never interfere with moving focus around.
    if (event.which === KEY_TAB) {
      return;
    }

    if (event.which === KEY_ENTER) {
      var isChatField = $target.is($inputMessage) || $target.is($usernameInput);
      if (isChatField || !inControl) {
        if (username) {
          sendMessage();
          socket.emit('stop typing');
          typing = false;
        } else {
          setUsername();
        }
      }
      return;
    }

    // Typing anywhere jumps to the message box -- but not while the caret is
    // already in some other control, such as the room filter.
    if (inControl || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    $currentInput.focus();
  });

  $inputMessage.on('input', function() {
    updateTyping();
  });

  // Focus input when clicking anywhere on login page
  $loginPage.click(function () {
    $currentInput.focus();
  });

  $roomFilter.on('input', renderRoomList);

  // Enter in the filter joins the first room still showing.
  $roomFilter.on('keydown', function (event) {
    if (event.which !== KEY_ENTER) {
      return;
    }
    event.preventDefault();
    var names = visibleRoomNames();
    if (names.length > 0) {
      joinRoom(names[0]);
    }
  });

  // Collapse / expand the room list. On a narrow screen the same control
  // slides the drawer in and out.
  $btnCollapse.add($btnRoomsToggle).on('click', function () {
    setRoomsCollapsed(!roomsCollapsed());
  });

  $scrim.on('click', function () {
    setRoomsCollapsed(true);
  });

  $btnTips.on('click', function () {
    setTipsOpen(!tipsOpen());
  });

  // Clicking away closes the tips popover.
  $(document).on('click', function (event) {
    if (!tipsOpen()) {
      return;
    }
    if ($(event.target).closest('.ui-tips, .btn-tips').length === 0) {
      setTipsOpen(false);
    }
  });

  // Moving across the breakpoint resets the room list to that layout's
  // default: a visible column on desktop, a closed drawer on mobile.
  function applyLayoutDefault () {
    setRoomsCollapsed(isMobile());
  }

  var mobileQuery = window.matchMedia(MOBILE_QUERY);
  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', applyLayoutDefault);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(applyLayoutDefault);
  }
  applyLayoutDefault();

  // --- Socket events --------------------------------------------------------

  socket.on('login', function (data) {
    connected = true;
    log('Welcome to the Chat Lab.', { prepend: true });
    addParticipantsMessage(data);
  });

  socket.on('new message', function (data) {
    clearUserTyping(data.username);
    addChatMessage(data);
  });

  socket.on('user joined', function (data) {
    log(data.logAction + data.logLocation + data.roomName, {
      userConnEvent: true,
      username: data.username
    });
    addParticipantsMessage(data);
  });

  socket.on('user left', function (data) {
    clearUserTyping(data.username);
    log(data.logAction + data.logLocation + data.roomName, {
      userConnEvent: true,
      username: data.username
    });
    addParticipantsMessage(data);
  });

  socket.on('typing', function (data) {
    setUserTyping(data && data.username);
  });

  socket.on('stop typing', function (data) {
    clearUserTyping(data && data.username);
  });

  // Server rejected a username, room name or message.
  socket.on('invalid input', function (data) {
    log(data && data.message ? data.message : 'That input is not valid');
  });

  socket.on('disconnect', function () {
    connected = false;
    clearAllTyping();
    log('You have been disconnected');
  });

  // Reconnection lives on the manager in Socket.IO 4, not on the socket.
  socket.io.on('reconnect', function () {
    log('You are reconnected');
    if (username) {
      socket.emit('add user', username);
    }
  });

  socket.io.on('reconnect_error', function () {
    log('Reconnection failed…');
  });

  // Show current room list.
  socket.on('show room list', function (room, rooms) {
    if (room !== roomState.current) {
      // Different room, so whoever was typing in the old one is no longer
      // anything to do with us.
      clearAllTyping();
    }
    roomState.current = room;
    roomState.rooms = rooms || {};
    renderRoomList();
    renderHeader();
  });

  socket.on('join left result', function (data) {
    log(data.username + data.logAction
      + data.logLocation + data.roomName);
  });

  // Periodically reload the current room list as a safety net; the server
  // also pushes it to everyone whenever it changes.
  setInterval(function () {
    if (connected) {
      socket.emit('room list');
    }
  }, ROOM_LIST_REFRESH);
});
