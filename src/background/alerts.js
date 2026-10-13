// Chat events from the relay (src/content/relay.js). Every field is checked again here: content
// scripts run next to web pages, and the page can post look-alike messages to the relay.
// Phase 3 step 2: valid events from watched sites are recorded in the dev-mode log.
// Step 3 turns them into alerts (duplicates, the quiet rule, notifications).
self.QueueCue = self.QueueCue || {};

QueueCue.alerts = (function () {
  var TYPES = ['agent_joined', 'agent_message', 'visitor_message', 'chat_ended'];
  var PLATFORMS = ['tawk'];
  // "<type>:<8 hex digits>" (a fingerprint of the message, never its text), or just "chat_ended".
  var MESSAGE_KEY = /^(?:(agent_joined|agent_message|visitor_message):[0-9a-f]{8}|(chat_ended))$/;

  function keyMatchesType(key, type) {
    var match = MESSAGE_KEY.exec(key);
    return !!match && (match[1] || match[2]) === type;
  }

  // Returns the checked event, or null if anything about it is off.
  function parse(message, sender) {
    if (!message || typeof message !== 'object' || message.queueCue !== 'event') return null;
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab || typeof sender.tab.id !== 'number') return null;
    if (sender.frameId !== 0) return null; // top frame only, where the hook runs
    if (TYPES.indexOf(message.type) === -1 || PLATFORMS.indexOf(message.platform) === -1) return null;
    if (typeof message.messageKey !== 'string' || !keyMatchesType(message.messageKey, message.type)) return null;
    var page = message.page;
    if (!page || typeof page.visible !== 'boolean' || typeof page.focused !== 'boolean') return null;
    var pattern = QueueCue.sites.patternFor(sender.url);
    if (!pattern) return null;
    return {
      type: message.type,
      platform: message.platform,
      messageKey: message.messageKey,
      pattern: pattern,
      site: new URL(sender.url).hostname,
      tabId: sender.tab.id,
      windowId: sender.tab.windowId,
      page: { visible: page.visible, focused: page.focused }
    };
  }

  // Returns true if the event was accepted.
  async function receive(message, sender) {
    var event = parse(message, sender);
    if (!event) return false;
    // A page opened before "Stop watching" keeps its scripts until it's refreshed: ignore it.
    var watched = await QueueCue.sites.readList();
    if (watched.indexOf(event.pattern) === -1) return false;
    await QueueCue.debugLog.add({
      kind: 'event',
      type: event.type,
      platform: event.platform,
      messageKey: event.messageKey,
      site: event.site,
      tabId: event.tabId,
      page: event.page
    });
    return true;
  }

  return { parse: parse, receive: receive };
})();
