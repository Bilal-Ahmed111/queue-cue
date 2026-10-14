// Tawk.to detector. Runs in the page's MAIN world right after src/content/hook.js, at document_start,
// before the page's own scripts. It listens to the "tawk..." events the widget sends on window
// (Bilal's decision C, 2026-10-14). Tawk.to's own official add-ons (React, Angular, Vue) listen to these
// events, but Tawk.to's API docs don't mention them. Facts it relies on (notes/research/tawk.md,
// section 8.3, real widget):
// - The widget sends these events whether or not the site sets any Tawk_API callbacks, and as well as
//   the callbacks. Each is a CustomEvent on window; event.detail holds what the callback would get.
// - Messages arrive as { message, attachments } with no ID; tawkAgentJoinChat has { name, position, image, id }.
// - Old messages are not sent again after a refresh. Agent events reach every open tab of the chat;
//   a visitor's message only reaches the tab it was typed in.
// - tawkChatEnded only comes when the visitor ends the chat. When the agent closes it, only
//   tawkAgentLeaveChat comes, and the agent can come back to the same chat later. So "agent left" is
//   not treated as the end: keep-awake's 60-minute limit covers it (Bilal's decision, 2026-10-14).
// How it stays out of the site's way (CLAUDE.md, "Never break the host site"): it only listens. It never
// creates, reads or changes Tawk_API or the site's handlers, so the site's code runs exactly as it would
// without Queue Cue, and pages without Tawk.to are untouched.
(function () {
  'use strict';

  var queueCue = window.__queueCue;
  if (!queueCue || queueCue.detectors.tawk) return;
  queueCue.detectors.tawk = true;

  // Kept now, before the page's scripts run, in case the page replaces it later.
  var setTimer = window.setTimeout.bind(window);

  // If tawkLoad never comes, start listening this long after tawkBeforeLoad anyway (tawkLoad normally
  // arrives under a second after it).
  var READY_FALLBACK_MS = 5000;

  // Nothing counts until Tawk.to has finished loading. Old messages aren't sent again after a refresh
  // (research), but if they ever were, it would be while the widget loads.
  var ready = false;
  var fallbackStarted = false;

  // A short code worked out from the text (FNV-1a, 32 bits). The same text always gives the same code,
  // but the code can't be turned back into the text, so the text never leaves the page.
  function fingerprint(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return ('0000000' + hash.toString(16)).slice(-8);
  }

  function messageText(message) {
    var text = message && typeof message.message === 'string' ? message.message : '';
    var files = message && Array.isArray(message.attachments) ? message.attachments.length : 0;
    return text + '\u0000' + files;
  }

  function emit(type, text) {
    if (!ready) return;
    queueCue.emit({ type: type, platform: 'tawk', messageKey: text === null ? type : type + ':' + fingerprint(text) });
  }

  // Event name -> what to do with its detail.
  var listeners = {
    tawkBeforeLoad: function () {
      if (fallbackStarted) return;
      fallbackStarted = true;
      setTimer(function () { ready = true; }, READY_FALLBACK_MS);
    },
    tawkLoad: function () {
      ready = true;
    },
    tawkAgentJoinChat: function (agent) {
      emit('agent_joined', String((agent && (agent.id || agent.name)) || ''));
    },
    tawkChatMessageAgent: function (message) {
      emit('agent_message', messageText(message));
    },
    tawkChatMessageVisitor: function (message) {
      emit('visitor_message', messageText(message));
    },
    tawkChatEnded: function () {
      emit('chat_ended', null);
    }
  };

  Object.keys(listeners).forEach(function (name) {
    try {
      // Capture, so ours runs before any listener the page adds, even one that stops the event.
      window.addEventListener(name, function (event) {
        try {
          listeners[name](event.detail);
        } catch (e) {
          // Never let Queue Cue break the chat.
        }
      }, true);
    } catch (e) {
      // Leave the page alone.
    }
  });
})();
