// Dev-mode log. Tests can't see real notifications, so in the test copy of the extension every chat
// event received and every alert is also written here, in chrome.storage.session, where a test can
// read it. Entries carry a "kind": "event" (received), "duplicate", "quiet", "alert", "expired",
// "opened" or "keep-awake" (switched on or off).
// Does nothing unless QueueCue.config.debugLog is true.
self.QueueCue = self.QueueCue || {};

QueueCue.debugLog = (function () {
  var STORAGE_KEY = 'debugLog';
  var MAX_ENTRIES = 500;

  // Writes run one after another so two alerts arriving together can't overwrite each other.
  // Only the service worker writes the log, so this in-memory queue is enough.
  var pending = Promise.resolve();

  function enabled() {
    return !!(QueueCue.config && QueueCue.config.debugLog);
  }

  function add(entry) {
    if (!enabled()) return Promise.resolve(false);
    var write = pending.then(async function () {
      var stored = await chrome.storage.session.get(STORAGE_KEY);
      var log = stored[STORAGE_KEY] || [];
      log.push(Object.assign({}, entry, { at: Date.now() }));
      if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
      await chrome.storage.session.set({ [STORAGE_KEY]: log });
      return true;
    });
    // A failed write must not block the ones after it.
    pending = write.catch(function () {});
    return write;
  }

  async function read() {
    var stored = await chrome.storage.session.get(STORAGE_KEY);
    return stored[STORAGE_KEY] || [];
  }

  function clear() {
    var done = pending.then(function () {
      return chrome.storage.session.remove(STORAGE_KEY);
    });
    pending = done.catch(function () {});
    return done;
  }

  return { enabled: enabled, add: add, read: read, clear: clear };
})();
