// Chat events from the relay (src/content/relay.js), turned into alerts.
// - Every field is checked again here: content scripts run next to web pages, and the page can post
//   look-alike messages to the relay.
// - Every open tab of a chat reports the same event, and Tawk.to messages have no ID, so the same
//   messageKey on the same site within SAME_MESSAGE_MS counts as one message.
// - Quiet rule (CLAUDE.md): no alert when the chat tab is both visible and focused. The copies from all
//   tabs arrive within milliseconds, so the decision waits GATHER_MS for them, then stays quiet only if
//   Chrome's focused window shows one of those tabs AND that tab's page said it was visible and focused.
// - The service worker can stop at any time, so all of this lives in chrome.storage.session.
self.QueueCue = self.QueueCue || {};

QueueCue.alerts = (function () {
  var TYPES = ['agent_joined', 'agent_message', 'visitor_message', 'chat_ended'];
  var ALERT_TYPES = ['agent_joined', 'agent_message'];
  var PLATFORMS = ['tawk'];
  // "<type>:<8 hex digits>" (a fingerprint of the message, never its text), or just "chat_ended".
  var MESSAGE_KEY = /^(?:(agent_joined|agent_message|visitor_message):[0-9a-f]{8}|(chat_ended))$/;
  var GATHER_MS = 500;
  var SAME_MESSAGE_MS = 10000;
  var RECENT_KEY = 'recentEvents';
  var TARGETS_KEY = 'notificationTargets';

  // Storage changes run one after another, so copies arriving together can't overwrite each other.
  var pending = Promise.resolve();
  function queue(task) {
    var run = pending.then(task);
    pending = run.catch(function () {});
    return run;
  }

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

  async function readStored(key) {
    var stored = await chrome.storage.session.get(key);
    return stored[key] || {};
  }

  function store(key, value) {
    return chrome.storage.session.set({ [key]: value });
  }

  // Events too old to be repeated, once decided, are forgotten.
  function prune(recent, now) {
    Object.keys(recent).forEach(function (id) {
      if (recent[id].decided && now - recent[id].firstAt > SAME_MESSAGE_MS) delete recent[id];
    });
    return recent;
  }

  // Returns true if the event was accepted.
  async function receive(message, sender) {
    var event = parse(message, sender);
    if (!event) return false;
    return queue(async function () {
      // A page opened before "Stop watching" keeps its scripts until it's refreshed: ignore it.
      var watched = await QueueCue.sites.readList();
      if (watched.indexOf(event.pattern) === -1) return false;
      // Access removed without Chrome telling us (chrome.permissions.onRemoved isn't guaranteed):
      // ignore the event and bring the list back in line.
      if (!(await chrome.permissions.contains({ origins: [event.pattern] }))) {
        QueueCue.sites.reconcile().catch(reportError);
        return false;
      }
      await QueueCue.debugLog.add({
        kind: 'event', type: event.type, platform: event.platform, messageKey: event.messageKey,
        site: event.site, tabId: event.tabId, page: event.page
      });
      // Every copy counts here, so keep-awake knows each tab the chat is open in.
      await QueueCue.keepAwake.onEvent(event);

      var now = Date.now();
      var recent = prune(await readStored(RECENT_KEY), now);
      var id = event.pattern + ' ' + event.messageKey;
      var report = { tabId: event.tabId, windowId: event.windowId, visible: event.page.visible, focused: event.page.focused };
      var earlier = recent[id];
      if (earlier && now - earlier.firstAt <= SAME_MESSAGE_MS) {
        if (!earlier.decided) earlier.reports.push(report);
        await store(RECENT_KEY, recent);
        await QueueCue.debugLog.add({ kind: 'duplicate', type: event.type, site: event.site, tabId: event.tabId });
        return true;
      }

      var alertable = ALERT_TYPES.indexOf(event.type) !== -1;
      recent[id] = { firstAt: now, type: event.type, site: event.site, pattern: event.pattern, decided: !alertable, reports: [report] };
      await store(RECENT_KEY, recent);
      // A short wait (well under the worker's 30-second idle limit). If the worker stops anyway,
      // decideDue() runs again when it restarts.
      if (alertable) setTimeout(function () { decideDue().catch(reportError); }, GATHER_MS + 20);
      return true;
    });
  }

  function reportError(error) {
    console.error('Queue Cue: deciding on an alert failed:', error);
  }

  // Is the user looking at one of the tabs that reported this event?
  async function userIsLookingAt(entry) {
    var win = await chrome.windows.getLastFocused();
    if (!win || !win.focused || win.state === 'minimized') return false;
    var active = (await chrome.tabs.query({ active: true, windowId: win.id }))[0];
    if (!active) return false;
    return entry.reports.some(function (r) { return r.tabId === active.id && r.visible && r.focused; });
  }

  // Decides every event that has waited GATHER_MS for its copies from other tabs. One left undecided
  // for longer than SAME_MESSAGE_MS (only if the worker crashed mid-wait) is dropped: an alert that
  // turns up much later would point at a chat that has moved on.
  function decideDue() {
    return queue(async function () {
      var now = Date.now();
      var recent = await readStored(RECENT_KEY);
      var due = Object.keys(recent).filter(function (id) {
        return !recent[id].decided && now - recent[id].firstAt >= GATHER_MS;
      });
      if (!due.length) return;
      due.forEach(function (id) { recent[id].decided = true; });
      await store(RECENT_KEY, recent);
      for (var i = 0; i < due.length; i++) {
        var entry = recent[due[i]];
        if (now - entry.firstAt > SAME_MESSAGE_MS) {
          await QueueCue.debugLog.add({ kind: 'expired', type: entry.type, site: entry.site });
          continue;
        }
        var looking = false;
        try {
          looking = await userIsLookingAt(entry);
        } catch (e) {
          looking = false; // when in doubt, alert
        }
        if (looking) {
          await QueueCue.debugLog.add({ kind: 'quiet', type: entry.type, site: entry.site });
        } else {
          await notify(entry);
        }
      }
    });
  }

  // One notification per site: a new alert replaces the previous one instead of piling up.
  function notificationIdFor(pattern) {
    return 'qc ' + pattern;
  }

  async function notify(entry) {
    var id = notificationIdFor(entry.pattern);
    var target = entry.reports[0];
    var targets = await readStored(TARGETS_KEY);
    targets[id] = { tabId: target.tabId, windowId: target.windowId, pattern: entry.pattern };
    await store(TARGETS_KEY, targets);
    // Names the site only, never the message.
    var title = (entry.type === 'agent_joined' ? 'Agent joined on ' : 'Agent replied on ') + entry.site;
    await QueueCue.debugLog.add({ kind: 'alert', type: entry.type, site: entry.site, title: title, notificationId: id, tabId: target.tabId });
    try {
      await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: title,
        message: 'Click to go to the chat.',
        // Stays on screen until clicked or closed (Windows shows it as a reminder with a Close button).
        requireInteraction: true
      });
    } catch (error) {
      console.error('Queue Cue: showing the notification failed:', error);
    }
  }

  // Finds the chat tab for a notification: the tab that reported it if it's still on the site,
  // otherwise any open tab on the site.
  async function findChatTab(target) {
    try {
      var tab = await chrome.tabs.get(target.tabId);
      if (QueueCue.sites.patternFor(tab.url) === target.pattern) return tab;
    } catch (e) {
      // The tab was closed.
    }
    var others = await chrome.tabs.query({ url: target.pattern });
    return others[0] || null;
  }

  // chrome.notifications.onClicked: bring the chat tab, and its window, to the front.
  function openChat(notificationId) {
    return queue(async function () {
      var targets = await readStored(TARGETS_KEY);
      var target = targets[notificationId];
      delete targets[notificationId];
      await store(TARGETS_KEY, targets);
      try {
        await chrome.notifications.clear(notificationId);
      } catch (e) {
        // Already gone.
      }
      if (!target) return false;
      var tab = await findChatTab(target);
      if (!tab) return false;
      await chrome.tabs.update(tab.id, { active: true });
      var win = await chrome.windows.get(tab.windowId);
      await chrome.windows.update(tab.windowId, win.state === 'minimized' ? { focused: true, state: 'normal' } : { focused: true });
      await QueueCue.debugLog.add({ kind: 'opened', site: new URL(target.pattern.slice(0, -1)).hostname, tabId: tab.id });
      return true;
    });
  }

  // chrome.notifications.onClosed: the user closed it, so forget where it pointed.
  function forget(notificationId) {
    return queue(async function () {
      var targets = await readStored(TARGETS_KEY);
      if (!targets[notificationId]) return;
      delete targets[notificationId];
      await store(TARGETS_KEY, targets);
    });
  }

  return {
    parse: parse,
    receive: receive,
    decideDue: decideDue,
    openChat: openChat,
    forget: forget,
    GATHER_MS: GATHER_MS,
    SAME_MESSAGE_MS: SAME_MESSAGE_MS
  };
})();
