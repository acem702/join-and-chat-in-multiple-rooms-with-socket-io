// Author: GW19 <imgw19@gmail.com>
//
// Validation rules shared by the browser client and the Node server.
// The server is the authority -- the client uses these only to give fast
// feedback before sending. Loaded as a <script> in the browser (exposes
// window.ChatRules) and via require() on the server.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatRules = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The default room every user lands in. It is never deleted, even when empty.
  var LOBBY = '大廳';

  var MAX_NAME_LENGTH = 14;
  var MAX_MESSAGE_LENGTH = 2000;

  // Room names: 1-14 characters, not blank, limited to Chinese characters,
  // ASCII letters, digits, underscore and whitespace.
  var ROOM_NAME_RULE =
    /^(?!\s*$)[a-zA-Z0-9_一-龥 \f\n\r\t\v]{1,14}$/;

  // Usernames: 1-14 characters, not blank, no control characters.
  var USERNAME_RULE = /^(?!\s*$)[^\u0000-\u001f\u007f]{1,14}$/;

  // Collapses internal whitespace runs and trims the ends, so that
  // "my  room" and "my room " are treated as the same room.
  function normalizeName (value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.replace(/\s+/g, ' ').trim();
  }

  function isValidRoomName (value) {
    return typeof value === 'string' && ROOM_NAME_RULE.test(value);
  }

  function isValidUsername (value) {
    return typeof value === 'string' && USERNAME_RULE.test(value);
  }

  function isValidMessage (value) {
    return typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_MESSAGE_LENGTH;
  }

  return {
    LOBBY: LOBBY,
    MAX_NAME_LENGTH: MAX_NAME_LENGTH,
    MAX_MESSAGE_LENGTH: MAX_MESSAGE_LENGTH,
    ROOM_NAME_RULE: ROOM_NAME_RULE,
    USERNAME_RULE: USERNAME_RULE,
    normalizeName: normalizeName,
    isValidRoomName: isValidRoomName,
    isValidUsername: isValidUsername,
    isValidMessage: isValidMessage
  };
}));
