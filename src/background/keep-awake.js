// Keeps the PC from going to sleep while a watched chat is going (CLAUDE.md, Architecture), so Chrome
// keeps running and the alert can come. Level "system": the screen may still switch off; only sleep is
// blocked. Released when the chat ends, when every tab of the chat is closed or has left the site, when
// the site stops being watched, and after 60 minutes with no chat activity.
// Facts it relies on (notes/research/chrome-mv3.md, P3-Q4): Chrome keeps the request when the service
// worker stops, and drops it when the extension is reloaded, disabled or removed. Calling
// requestKeepAwake again just replaces the earlier request. Closing the laptop lid always wins, and on a
// Modern Standby laptop on battery Windows may end the request a few minutes after its sleep timeout.
self.QueueCue = self.QueueCue || {};

QueueCue.keepAwake = (function () {
  var STATE_KEY = 'keepAwake';
  var ALARM = 'qc-keep-awake-limit';
  var IDLE_LIMIT_MS = 60 * 60 * 1000;
  var ACTIVITY = ['visitor_message', 'agent_joined', 'agent_message'];

  var pending = Promise.resolve();
  function queue(task) {
    var run = pending.then(task);
    pending = run.catch(function () {});
    return run;
  }

  // { tabs: { "<tabId>": "<site pattern>" }, lastActivity: <ms>, on: <boolean> }
  async function read() {
    var stored = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY];
    return {
      tabs: (stored && stored.tabs) || {},
      lastActivity: (stored && stored.lastActivity) || 0,
      on: !!(stored && stored.on)
    };
  }

  function forgetTabs(state, keep) {
    Object.keys(state.tabs).forEach(function (tabId) {
      if (!keep(Number(tabId), state.tabs[tabId])) delete state.tabs[tabId];
    });
  }

  // Makes Chrome's keep-awake request and the 60-minute alarm match the saved state.
  async function apply(state, reason) {
    var wanted = Object.keys(state.tabs).length > 0;
    if (wanted) {
      chrome.power.requestKeepAwake('system');
      await chrome.alarms.create(ALARM, { when: Math.max(state.lastActivity + IDLE_LIMIT_MS, Date.now() + 60000) });
    } else {
      chrome.power.releaseKeepAwake();
      await chrome.alarms.clear(ALARM);
    }
    if (wanted !== state.on) {
      state.on = wanted;
      await QueueCue.debugLog.add({ kind: 'keep-awake', on: wanted, reason: reason });
    }
    await chrome.storage.session.set({ [STATE_KEY]: state });
  }

  // A checked chat event from a watched site (src/background/alerts.js), from any of the chat's tabs.
  function onEvent(event) {
    return queue(async function () {
      var state = await read();
      if (event.type === 'chat_ended') {
        // Every tab of the site shows the same chat, so the chat is over in all of them.
        forgetTabs(state, function (tabId, pattern) { return pattern !== event.pattern; });
        return apply(state, 'chat ended on ' + event.site);
      }
      if (ACTIVITY.indexOf(event.type) === -1) return undefined;
      // Events wait their turn, so the tab may have closed or left the site since it sent this one.
      // Don't bring it back, or keep-awake would stay on for a tab that's gone.
      var tab = null;
      try {
        tab = await chrome.tabs.get(event.tabId);
      } catch (e) {
        // Closed.
      }
      if (!tab || QueueCue.sites.patternFor(tab.url) !== event.pattern) return undefined;
      state.tabs[event.tabId] = event.pattern;
      state.lastActivity = Date.now();
      return apply(state, 'chat going on ' + event.site);
    });
  }

  // chrome.tabs.onRemoved
  function onTabClosed(tabId) {
    return queue(async function () {
      var state = await read();
      if (!state.tabs[tabId]) return undefined;
      delete state.tabs[tabId];
      return apply(state, 'chat tab closed');
    });
  }

  // chrome.tabs.onUpdated, when a tab starts loading a page: did a chat tab leave its site? Without
  // access to the new site, Chrome doesn't tell us its address, which also means it isn't the chat's site.
  function onTabNavigated(tabId) {
    return queue(async function () {
      var state = await read();
      var pattern = state.tabs[tabId];
      if (!pattern) return undefined;
      var tab = null;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (e) {
        // Closed in the meantime.
      }
      if (tab && QueueCue.sites.patternFor(tab.url) === pattern) return undefined;
      delete state.tabs[tabId];
      return apply(state, 'chat tab left the site');
    });
  }

  // "Stop watching this site", or access removed.
  function forgetSite(pattern) {
    return queue(async function () {
      var state = await read();
      forgetTabs(state, function (tabId, p) { return p !== pattern; });
      return apply(state, 'site no longer watched');
    });
  }

  // chrome.alarms.onAlarm
  function onAlarm(alarm) {
    if (!alarm || alarm.name !== ALARM) return Promise.resolve();
    return queue(async function () {
      var state = await read();
      // Alarms can fire a little early or late; only give up once the hour has really passed.
      if (Date.now() - state.lastActivity >= IDLE_LIMIT_MS - 1000) state.tabs = {};
      return apply(state, 'no chat activity for 60 minutes');
    });
  }

  // Each time the service worker starts: drop tabs that closed or left the site while it was stopped,
  // then make Chrome's request match.
  function checkAtStartUp() {
    return queue(async function () {
      var state = await read();
      if (!state.on && !Object.keys(state.tabs).length) return undefined;
      var watched = await QueueCue.sites.readList();
      var ids = Object.keys(state.tabs);
      for (var i = 0; i < ids.length; i++) {
        var pattern = state.tabs[ids[i]];
        var tab = null;
        try {
          tab = await chrome.tabs.get(Number(ids[i]));
        } catch (e) {
          // Closed.
        }
        if (!tab || QueueCue.sites.patternFor(tab.url) !== pattern || watched.indexOf(pattern) === -1) delete state.tabs[ids[i]];
      }
      if (Object.keys(state.tabs).length && Date.now() - state.lastActivity >= IDLE_LIMIT_MS) state.tabs = {};
      return apply(state, 'start-up check');
    });
  }

  return {
    onEvent: onEvent,
    onTabClosed: onTabClosed,
    onTabNavigated: onTabNavigated,
    forgetSite: forgetSite,
    onAlarm: onAlarm,
    checkAtStartUp: checkAtStartUp,
    ALARM: ALARM,
    IDLE_LIMIT_MS: IDLE_LIMIT_MS
  };
})();
