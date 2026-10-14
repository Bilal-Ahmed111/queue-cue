// Reviewer "try to break it" tests, Phase 3: alerts (src/background/alerts.js). Fake chat only.
// Same method as alerts.spec.js: the dev-mode log (kinds "alert", "quiet", "duplicate", "opened") stands in
// for real Windows notifications, which tests can't see.
const { test, expect, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL } = require('../fake-chat-config');
const { stopServiceWorker } = require('./service-worker-restart');

const SITE = 'http://127.0.0.1/*';
const NOTIFICATION_ID = `qc ${SITE}`;

async function logOf(serviceWorker, kind) {
  const log = await inServiceWorker(serviceWorker, () => QueueCue.debugLog.read());
  return log.filter((entry) => entry.kind === kind);
}

async function waitForLog(serviceWorker, kind, count, timeout = 10000) {
  await expect.poll(async () => (await logOf(serviceWorker, kind)).length, { timeout }).toBe(count);
  return logOf(serviceWorker, kind);
}

const settle = (page, ms = 1500) => page.waitForTimeout(ms);

function watch(serviceWorker) {
  return inServiceWorker(serviceWorker, (site) => QueueCue.sites.watch(site), SITE);
}

function loaded(chat) {
  return chat.waitForFunction(() => window.Tawk_API && window.Tawk_API.getStatus && window.Tawk_API.getStatus() === 'online');
}

async function openChat(context) {
  const chat = await context.newPage();
  await chat.goto(FAKE_CHAT_URL);
  await loaded(chat);
  return chat;
}

async function openElsewhere(context) {
  const elsewhere = await context.newPage();
  await elsewhere.goto('about:blank');
  await elsewhere.bringToFront();
  return elsewhere;
}

async function tabIdOf(page, serviceWorker) {
  await page.bringToFront();
  return inServiceWorker(serviceWorker, async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
}

const fake = (chat, action, text) => chat.evaluate(([a, t]) => window.FakeTawk[a](t), [action, text]);

function undecided(serviceWorker) {
  return inServiceWorker(serviceWorker, async () => {
    const { recentEvents } = await chrome.storage.session.get('recentEvents');
    return Object.values(recentEvents || {}).filter((e) => !e.decided).length;
  });
}

test('after a second alert replaces the first, clicking it still brings the chat tab to the front', async ({ context, serviceWorker }) => {
  await watch(serviceWorker);
  const chat = await openChat(context);
  const chatTabId = await tabIdOf(chat, serviceWorker);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);

  await fake(chat, 'agentJoin');
  await waitForLog(serviceWorker, 'alert', 1);
  await fake(chat, 'agentMessage', 'First reply');
  await waitForLog(serviceWorker, 'alert', 2);
  await settle(chat); // time for any onClosed from the replaced notification to arrive

  const targets = await inServiceWorker(serviceWorker, async () => (await chrome.storage.session.get('notificationTargets')).notificationTargets);
  expect(Object.keys(targets)).toEqual([NOTIFICATION_ID]);
  expect(await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.openChat(id), NOTIFICATION_ID)).toBe(true);
  const active = await inServiceWorker(serviceWorker, async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  expect(active).toBe(chatTabId);
});

test('many replies at once with the chat in two tabs: one alert per reply, none lost, none doubled', async ({ context, serviceWorker }) => {
  await watch(serviceWorker);
  const first = await openChat(context);
  await fake(first, 'visitorMessage', 'Hello');
  await openChat(context);
  await openElsewhere(context);

  const COUNT = 15;
  await first.evaluate((n) => {
    for (let i = 1; i <= n; i += 1) window.FakeTawk.agentMessage('Burst reply ' + i);
  }, COUNT);
  await waitForLog(serviceWorker, 'alert', COUNT, 20000);
  await waitForLog(serviceWorker, 'duplicate', COUNT, 20000);
  await settle(first);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(COUNT);
  expect(await undecided(serviceWorker)).toBe(0);
  // Still one notification on screen for the site.
  expect(Object.keys(await inServiceWorker(serviceWorker, () => chrome.notifications.getAll()))).toEqual([NOTIFICATION_ID]);
});

test('the page saying it isn\'t focused (user in another app) gives an alert even though the chat tab is in front in Chrome', async ({ context, serviceWorker }) => {
  await watch(serviceWorker);
  const chat = await openChat(context);
  const chatTabId = await tabIdOf(chat, serviceWorker);
  // Playwright pages always say visible and focused, so feed the service worker what the relay would send
  // from a page that has lost focus, with the real tab as sender.
  await inServiceWorker(serviceWorker, async ([tabId, url]) => {
    const tab = await chrome.tabs.get(tabId);
    const sender = { id: chrome.runtime.id, tab, frameId: 0, url };
    await QueueCue.alerts.receive({ queueCue: 'event', type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0000aaaa', page: { visible: true, focused: false } }, sender);
    await QueueCue.alerts.receive({ queueCue: 'event', type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0000bbbb', page: { visible: false, focused: true } }, sender);
  }, [chatTabId, chat.url()]);
  const alerts = await waitForLog(serviceWorker, 'alert', 2);
  expect(alerts.every((a) => a.tabId === chatTabId)).toBe(true);
  expect(await logOf(serviceWorker, 'quiet')).toHaveLength(0);
});

test('two chat tabs: the one in front says unfocused, a background one says focused: that is not "looking at the chat"', async ({ context, serviceWorker }) => {
  await watch(serviceWorker);
  const back = await openChat(context);
  const backId = await tabIdOf(back, serviceWorker);
  const front = await openChat(context);
  const frontId = await tabIdOf(front, serviceWorker);
  await inServiceWorker(serviceWorker, async ([frontTab, backTab, url]) => {
    const send = async (tabId, page) => QueueCue.alerts.receive(
      { queueCue: 'event', type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0000cccc', page },
      { id: chrome.runtime.id, tab: await chrome.tabs.get(tabId), frameId: 0, url });
    await send(backTab, { visible: true, focused: true });
    await send(frontTab, { visible: true, focused: false });
  }, [frontId, backId, front.url()]);
  await waitForLog(serviceWorker, 'alert', 1);
  expect(await logOf(serviceWorker, 'quiet')).toHaveLength(0);
});

test('refreshing the chat mid-chat: old replies stay silent, the next new reply alerts once', async ({ context, serviceWorker }) => {
  await watch(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);
  await fake(chat, 'agentJoin');
  await fake(chat, 'agentMessage', 'Before the refresh');
  await waitForLog(serviceWorker, 'alert', 2);

  // Refresh right after a reply, while the decision may still be gathering copies.
  await fake(chat, 'agentMessage', 'Just before the refresh');
  await waitForLog(serviceWorker, 'event', 4); // received, decision still waiting for other tabs
  await chat.reload();
  await loaded(chat);
  await openElsewhere(context);
  await waitForLog(serviceWorker, 'alert', 3);
  await settle(chat);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(3);

  await fake(chat, 'agentMessage', 'After the refresh');
  await waitForLog(serviceWorker, 'alert', 4);
  await settle(chat);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(4);
});

test('the service worker stopping between two different replies: both alert, once each', async ({ context, serviceWorker, extensionId }) => {
  await watch(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);
  await fake(chat, 'agentMessage', 'One');
  await waitForLog(serviceWorker, 'alert', 1);

  await stopServiceWorker(context, extensionId);
  await fake(chat, 'agentMessage', 'Two'); // wakes the worker
  await waitForLog(serviceWorker, 'alert', 2);
  await stopServiceWorker(context, extensionId);
  await fake(chat, 'agentMessage', 'Three');
  await waitForLog(serviceWorker, 'alert', 3);
  await settle(chat);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(3);
  expect(await logOf(serviceWorker, 'duplicate')).toHaveLength(0);
});

test('chat in its own pop-up window: quiet while it is in front; an alert from it, once clicked, brings that pop-up back', async ({ context, serviceWorker }) => {
  // Headless Chromium reports every window as focused at once, so "the user went back to the main window"
  // can't be acted out here; the alert half feeds the worker a report from the pop-up whose page lost focus.
  await watch(serviceWorker);
  const opener = await openChat(context);
  await fake(opener, 'visitorMessage', 'Hello');
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    opener.evaluate((url) => { window.open(url, 'chat', 'popup,width=420,height=600'); }, FAKE_CHAT_URL)
  ]);
  await loaded(popup);
  const popupTab = await inServiceWorker(serviceWorker, async () => {
    for (const win of await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })) {
      if (win.tabs.length) return { id: win.tabs[0].id, windowId: win.id };
    }
    return null;
  });
  expect(popupTab).toBeTruthy();
  expect(await popup.evaluate(() => Object.prototype.hasOwnProperty.call(window, '__queueCue'))).toBe(true);

  await popup.bringToFront();
  await fake(popup, 'agentMessage', 'Seen in the pop-up');
  await waitForLog(serviceWorker, 'quiet', 1);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(0);

  await opener.bringToFront();
  await inServiceWorker(serviceWorker, async ([tabId, url]) => {
    await QueueCue.alerts.receive({ queueCue: 'event', type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0000dddd', page: { visible: true, focused: false } },
      { id: chrome.runtime.id, tab: await chrome.tabs.get(tabId), frameId: 0, url });
  }, [popupTab.id, popup.url()]);
  const [alert] = await waitForLog(serviceWorker, 'alert', 1);
  expect(alert.tabId).toBe(popupTab.id);
  expect(await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.openChat(id), NOTIFICATION_ID)).toBe(true);
  expect((await logOf(serviceWorker, 'opened'))[0].tabId).toBe(popupTab.id);
  const after = await inServiceWorker(serviceWorker, async (t) => ({ active: (await chrome.tabs.get(t.id)).active, focused: (await chrome.windows.get(t.windowId)).focused }), popupTab);
  expect(after).toEqual({ active: true, focused: true });
});

test('the chat tab closing a moment after a reply still gives the alert, and clicking it does nothing harmful', async ({ context, serviceWorker }) => {
  await watch(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);
  await chat.evaluate(() => window.FakeTawk.agentMessage('Bye'));
  await waitForLog(serviceWorker, 'event', 2); // received; the decision is still waiting
  await chat.close();
  await waitForLog(serviceWorker, 'alert', 1);
  expect(await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.openChat(id), NOTIFICATION_ID)).toBe(false);
});
