// Queue Cue hook. Runs in the page's own JavaScript world (MAIN) at document_start, only on sites
// the user chose to watch, before the page's own scripts. It can reach vendor APIs such as
// window.Tawk_API but not chrome.* APIs; events go to the relay (src/content/relay.js).
// Content scripts can't use import/export, so this file creates one namespace object and the
// detectors in src/detectors/, loaded after it, add themselves to it.
(function () {
  'use strict';

  if (Object.prototype.hasOwnProperty.call(window, '__queueCue')) return;

  var queueCue = { detectors: {} };

  // Not enumerable, so the page's own loops over window never see it.
  Object.defineProperty(window, '__queueCue', { value: queueCue, enumerable: false, configurable: false, writable: false });
})();
