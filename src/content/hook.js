// Queue Cue hook. Runs in the page's own JavaScript world (MAIN) at document_start, only on sites
// the user chose to watch, before the page's own scripts. It can reach the vendor's JavaScript (its
// API objects and the events it sends on window) but not chrome.* APIs, so it passes events to the relay (src/content/relay.js)
// with window.postMessage. Content scripts can't use import/export, so this file creates one
// namespace object and the detectors in src/detectors/, loaded after it, use and add to it.
(function () {
  'use strict';

  if (Object.prototype.hasOwnProperty.call(window, '__queueCue')) return;

  // Kept now, before the page's scripts run, in case the page replaces it later.
  var post = window.postMessage.bind(window);

  var queueCue = { detectors: {} };

  // Every detector sends the same event shape (CLAUDE.md, Architecture):
  // { type: "agent_joined" | "agent_message" | "visitor_message" | "chat_ended", platform, messageKey }.
  // messageKey never contains message text, only a fingerprint of it.
  // The page can see these messages and could post look-alikes: the marker below isn't a secret,
  // so the relay and the service worker check every field.
  Object.defineProperty(queueCue, 'emit', {
    enumerable: true,
    value: function (event) {
      var origin = window.location.origin;
      try {
        post({ source: 'queue-cue-hook', version: 1, event: event }, origin && origin !== 'null' ? origin : '*');
      } catch (e) {
        // Never let Queue Cue break the page.
      }
    }
  });

  // Not enumerable, so the page's own loops over window never see it.
  Object.defineProperty(window, '__queueCue', { value: queueCue, enumerable: false, configurable: false, writable: false });
})();
