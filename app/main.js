// Author: GW19 <imgw19@gmail.com>
// Based on Socket.IO

$(function() {
  var FADE_TIME = 150; // ms
  var TYPING_TIMER_LENGTH = 400; // ms
  var ROOM_LIST_REFRESH = 30000; // ms
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
  var $btnTips = $('.btn-tips'); // Tool buttons
  var $btnCollapse = $('.btn-collapse'); // Room list collapse toggle

  // Prompt for setting a username
  var username;
  var connected = false;
  var typing = false;
  var lastTypingTime;
  var $currentInput = $usernameInput.focus();

  var socket = io();

  function addParticipantsMessage (data) {
    // Room joins and leaves carry their own log line; only lab-level events
    // report the headcount.
    if (data.userJoinOrLeftRoom) {
      return;
    }

    if (data.numUsers === 1) {
      log('目前只有你一個人在這裡唷！');
    } else {
      log('目前總共有 ' + data.numUsers + ' 位旅客在聊天實驗室。');
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
      message: message
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
          //noinspection JSUnresolvedVariable
          $roomList[0].scrollTop = $roomList[0].scrollHeight;
        } else {
          log('房間名稱長度限制為 1～14 個字元，' +
              '並只能由中文、英文、數字及底線所組成');
        }
        break;

      // Command /ls = reload room list.
      case 'ls':
        socket.emit('room list');
        break;

      default:
        log('您輸入了無效的指令');
        break;
    }
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

    var userName = data.username;
    var colorOfUserName = getUsernameColor(userName);
    if (data.typing !== true) {
      userName += ': ';
    }

    var $usernameDiv = $('<span class="username"/>')
      .text(userName)
      .css('color', colorOfUserName);
    var $messageBodyDiv = $('<span class="messageBody">')
      .text(data.message);

    var typingClass = data.typing ? 'typing' : '';
    var $messageDiv = $('<li class="message"/>')
      .data('username', userName)
      .addClass(typingClass)
      .append($usernameDiv, $messageBodyDiv);

    addMessageElement($messageDiv, options);
  }

  // Adds the visual chat typing message
  function addChatTyping (data) {
    data.typing = true;
    data.message = '正在輸入訊息...';
    addChatMessage(data);
  }

  // Removes the visual chat typing message
  function removeChatTyping (data) {
    getTypingMessages(data).fadeOut(function () {
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

    // Apply options
    if (options.fade) {
      $el.hide().fadeIn(FADE_TIME);
    }
    if (options.prepend) {
      $messages.prepend($el);
    } else {
      $messages.append($el);
    }
    // When sending message, make screen to last message (here is bottom).
    //noinspection JSUnresolvedVariable
    $messages[0].scrollTop = $messages[0].scrollHeight;
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
      return $(this).data('username') === data.username;
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

  // Keyboard events

  $window.keydown(function (event) {
    // Let buttons keep focus so they stay usable from the keyboard.
    if ($(event.target).is('button')) {
      return;
    }

    // Auto-focus the current input when a key is typed
    //noinspection JSUnresolvedVariable
    if (!(event.ctrlKey || event.metaKey || event.altKey)) {
      $currentInput.focus();
    }
    // When the client hits ENTER on their keyboard
    if (event.which === 13) {
      if (username) {
        sendMessage();
        socket.emit('stop typing');
        typing = false;
      } else {
        setUsername();
      }
    }
  });

  $inputMessage.on('input', function() {
    updateTyping();
  });

  // Click events

  // Focus input when clicking anywhere on login page
  $loginPage.click(function () {
    $currentInput.focus();
  });

  // Focus input when clicking on the message input's border
  $inputMessage.click(function () {
    $inputMessage.focus();
  });

  // Collapse / expand the room list. The chat panel grows into the space.
  $btnCollapse.on('click', function () {
    var collapsed = $pages
      .toggleClass('rooms-collapsed')
      .hasClass('rooms-collapsed');

    $btnCollapse
      .attr('aria-expanded', collapsed ? 'false' : 'true')
      .attr('title', collapsed ? '展開房間列表' : '收合房間列表')
      .html(collapsed ? '&raquo;' : '&laquo;');

    $inputMessage.focus();
  });

  // Socket events

  // Whenever the server emits 'login', log the login message
  socket.on('login', function (data) {
    connected = true;
    // Display the welcome message
    log('● 歡迎來到聊天實驗室 ●', {
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
    log(data && data.message ? data.message : '您輸入了無效的內容');
  });

  socket.on('disconnect', function () {
    connected = false;
    log('您已經中斷連線');
  });

  // Reconnection lives on the manager in Socket.IO 4, not on the socket.
  socket.io.on('reconnect', function () {
    log('您已經重新連線');
    if (username) {
      socket.emit('add user', username);
    }
  });

  socket.io.on('reconnect_error', function () {
    log('重新連線失敗...');
  });

  // Show current room list.
  socket.on('show room list', function (room, rooms) {
    $roomList.empty();

    $.each(rooms, function (roomName, numUserInRoom) {
      // Built as text nodes, never as an HTML string: room names come from
      // other users and would otherwise be injected into everyone's page.
      var $roomName = $('<b/>').text(roomName);
      var $roomCount = $('<span class="user-number-in-room"/>')
        .text('(' + numUserInRoom + '人)');

      var $roomDiv = $('<div class="room"/>')
        .append($roomName, $roomCount)
        .click(function () {
          socket.emit('join room', roomName);
          $inputMessage.focus();
        });

      // Compared against the real room name. This used to go through a
      // lowercased, whitespace-stripped class name, so "My Room" and
      // "myroom" collided and highlighted the wrong entry.
      if (roomName === room) {
        $roomDiv.addClass('joined-room');
      }

      $roomList.append($roomDiv);
    });
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


  // jQuery UI Style
  $roomList.sortable();
  $btnTips.tooltip();
  $btnTips.on( "click", function() {
    $('#effect-tips').toggle('blind');
  });
});
