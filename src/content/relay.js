// Queue Cue relay. Runs in the extension's ISOLATED world at document_start on watched sites and
// passes events from the hook (src/content/hook.js) to the service worker. It only accepts messages
// from this same window that carry the hook's marker. The marker isn't a secret (the page could post
// look-alikes), so only the expected fields are passed on and the service worker checks them again.
(function () {
  'use strict';

  var TYPES = ['agent_joined', 'agent_message', 'visitor_message', 'chat_ended'];
  var PLATFORMS = ['tawk'];

  function isEvent(event) {
    return !!event && typeof event === 'object' &&
      TYPES.indexOf(event.type) !== -1 &&
      PLATFORMS.indexOf(event.platform) !== -1 &&
      typeof event.messageKey === 'string' && event.messageKey.length <= 64;
  }

  window.addEventListener('message', function (message) {
    if (message.source !== window) return;
    var data = message.data;
    if (!data || typeof data !== 'object' || data.source !== 'queue-cue-hook' || data.version !== 1) return;
    if (!isEvent(data.event)) return;

    var event = {
      queueCue: 'event',
      type: data.event.type,
      platform: data.event.platform,
      messageKey: data.event.messageKey,
      // For the quiet rule: is this the tab the user is looking at?
      page: { visible: document.visibilityState === 'visible', focused: document.hasFocus() }
    };
    try {
      chrome.runtime.sendMessage(event).catch(function () {});
    } catch (e) {
      // The extension was reloaded or removed; this page keeps the old relay until it's refreshed.
    }
  });
})();
