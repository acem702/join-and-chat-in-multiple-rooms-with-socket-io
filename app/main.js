// Author: GW19 <imgw19@gmail.com>
// Based on Socket.IO

$(function() {
  var FADE_TIME = 150; // ms
  var TYPING_TIMER_LENGTH = 400; // ms
  var ROOM_LIST_REFRESH = 30000; // ms
  var NEAR_BOTTOM_SLACK = 80; // px
  var MOBILE_QUERY = '(max-width: 719px)';
  var KEY_TAB = 9;
  var KEY_ENTER = 13;
  var KEY_ESCAPE = 27;

  var COLORS = [
    '#e21400', '#91580f', '#f8a700', '#f78b00',
    '#58dc00', '#287b00', '#008dff', '#4ae8c4',
    '#3b88eb', '#3824aa', '#a700ff', '#d300e7',
    '#CC9014', '#FF6C00', '#7900ff', '#14CC78',
    '#001bff', '#00b2d8', '#7900ff', '#00d877',
    '#4d7298', '#795da3', '#f47577', '#db324d',
    '#EE4035', '#F3A530', '#56B949', '#30499B',
    '#F3A530', '#56B949', '#844D9E', '#4e1c81'
  ];

  // Validation rules shared with the server (app/chat-rules.js). The server
  // revalidates everything; these only give the user faster feedback.
  var rules = window.ChatRules;

  // Initialize variables
  var $window = $(window);
  var $usernameInput = $('.usernameInput'); // Input for username
  var $messages = $('.messages'); // Messages area
  var $inputMessage = $('.inputMessage'); // Input message input box

  var $pages = $('.pages'); // Flex row holding both panels
  var $loginPage = $('.login.page'); // login page
  var $chatPage = $('.chat.page'); // Chat room page
  var $roomPage = $('.room.page'); // Room list page
  var $roomList = $('.room-list'); // Room list <ul>
  var $roomFilter = $('.room-filter'); // Filters the room list
  var $roomEmpty = $('.room-empty'); // Shown when the filter matches nothing
  var $scrim = $('.drawer-scrim'); // Backdrop behind the mobile drawer

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
      log('You are the only one here right now!');
    } else {
      log('There are ' + data.numUsers + ' visitors in the chat lab.');
    }
  }

  // Sets the client's username
  function setUsername () {
    // trim(): remove the whitespace from the beginning and end of a string.
    username = rules.normalizeName($usernameInput.val());

    if (!rules.isValidUsername(username)) {
      username = undefined;
      return;
    }

    $loginPage.fadeOut();
    $chatPage.show();
    $roomPage.fadeIn();
    $loginPage.off('click');
    $currentInput = $inputMessage.focus();

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
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      !$last.hasClass('typing') &&
      $last.data('author') === author;
  }

  // Log a message
  function log (message, options) {
    options = options || {};
    var $logDiv;

    if (typeof options.userConnEvent !== 'undefined') {
      var userName = options.username;
      var $usernameDiv = $('<span class="username">')
        .text(userName)
        .css('color', getUsernameColor(userName));
      $logDiv = $('<li>')
        .addClass('log')
        .append($usernameDiv, message);
    } else {
      $logDiv = $('<li>').addClass('log').text(message);
    }

    addMessageElement($logDiv, options);
  }

  // Adds the visual chat message to the message list
  function addChatMessage (data, options) {
    // Don't fade the message in if there is an 'X was typing'
    var $typingMessages = getTypingMessages(data);
    options = options || {};
    if ($typingMessages.length !== 0) {
      options.fade = false;
      $typingMessages.remove();
    }

    if (data.message === '') {
      return;
    }

    var author = data.username;
    var isTyping = data.typing === true;
    var grouped = !isTyping && continuesRunFrom(author);

    var $usernameDiv = $('<span class="username"/>')
      .text(grouped ? '' : author + (isTyping ? '' : ':'))
      .css('color', grouped ? '' : getUsernameColor(author));

    var $messageBodyDiv = $('<span class="messageBody">')
      .text(data.message);

    var $messageDiv = $('<li class="message"/>')
      .data('author', author)
      .append($usernameDiv, $messageBodyDiv);

    if (isTyping) {
      $messageDiv.addClass('typing');
    } else {
      $messageDiv.append(
        $('<time class="message-time"/>')
          .attr('datetime', new Date(data.time || Date.now()).toISOString())
          .text(formatTime(data.time))
      );
    }

    if (grouped) {
      $messageDiv.addClass('grouped');
    }
    if (data.own) {
      $messageDiv.addClass('own');
    }

    addMessageElement($messageDiv, options);
  }

  // Adds the visual chat typing message
  function addChatTyping (data) {
    data.typing = true;
    data.message = 'is typing...';
    addChatMessage(data);
  }

  // Removes the visual chat typing message
  function removeChatTyping (data) {
    getTypingMessages(data).fadeOut(FADE_TIME, function () {
      $(this).remove();
    });
  }

  // Adds a message element to the messages and scrolls to the bottom
  // el - The element to add as a message
  // options.fade - If the element should fade-in (default = true)
  // options.prepend - If the element should prepend
  //   all other messages (default = false)
  function addMessageElement (el, options) {
    var $el = $(el);

    // Setup default options
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
    // display onto the element and break the flex row inside it.
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

  // Gets the 'X is typing' messages of a user
  function getTypingMessages (data) {
    if (!data || typeof data.username === 'undefined') {
      return $();
    }
    return $('.typing.message').filter(function () {
      return $(this).data('author') === data.username;
    });
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
    return count === 1 ? '(1 user)' : '(' + count + ' users)';
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
      var $roomCount = $('<span class="user-number-in-room"/>')
        .text(describeOccupancy(roomState.rooms[roomName]));

      // A real button, so it is reachable and operable from the keyboard.
      var $roomButton = $('<button type="button" class="room-card"/>')
        .append($roomName, $roomCount)
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

  // Focus input when clicking on the message input's border
  $inputMessage.click(function () {
    $inputMessage.focus();
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

  // Whenever the server emits 'login', log the login message
  socket.on('login', function (data) {
    connected = true;
    // Display the welcome message
    log('● Welcome to the Chat Lab ●', {
      prepend: true
    });
    addParticipantsMessage(data);
  });

  // Whenever the server emits 'new message', update the chat body
  socket.on('new message', function (data) {
    addChatMessage(data);
  });

  // Whenever the server emits 'user joined', log it in the chat body
  socket.on('user joined', function (data) {
    log(data.logAction + data.logLocation + data.roomName, {
      userConnEvent: true,
      username: data.username
    });
    addParticipantsMessage(data);
  });

  // Whenever the server emits 'user left', log it in the chat body
  socket.on('user left', function (data) {
    log(data.logAction + data.logLocation + data.roomName, {
      userConnEvent: true,
      username: data.username
    });
    addParticipantsMessage(data);
    removeChatTyping(data);
  });

  // Whenever the server emits 'typing', show the typing message
  socket.on('typing', function (data) {
    addChatTyping(data);
  });

  // Whenever the server emits 'stop typing', kill the typing message
  socket.on('stop typing', function (data) {
    removeChatTyping(data);
  });

  // Server rejected a username, room name or message.
  socket.on('invalid input', function (data) {
    log(data && data.message ? data.message : 'That input is not valid');
  });

  socket.on('disconnect', function () {
    connected = false;
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
    log('Reconnection failed...');
  });

  // Show current room list.
  socket.on('show room list', function (room, rooms) {
    roomState.current = room;
    roomState.rooms = rooms || {};
    renderRoomList();
  });

  socket.on('join left result', function (data) {
    // log results.
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
