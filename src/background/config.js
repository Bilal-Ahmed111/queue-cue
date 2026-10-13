// Build settings for the service worker.
// The automated tests load a copy of the extension in which this file says debugLog: true
// (see test/e2e/global-setup.js). The real extension never records the debug log.
self.QueueCue = self.QueueCue || {};

QueueCue.config = {
  debugLog: false
};
