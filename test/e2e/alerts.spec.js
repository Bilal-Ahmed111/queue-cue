// Phase 3, step 3: chat events become alerts (src/background/alerts.js). Fake chat only.
// Tests can't see real Windows notifications: they read the dev-mode log (kinds "alert", "quiet",
// "duplicate", "opened") and record what was passed to chrome.notifications.create.
// Under Playwright every page says it is visible and focused (smoke-focus.spec.js), so "the user is
// looking at the chat" is set up here by bringing a tab to the front; Chrome's view of the active tab
// then decides. Switching to another app is a manual check.
const { test, expect, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL } = require('../fake-chat-config');
const { stopServiceWorker } = require('./service-worker-restart');

const SITE = 'http://127.0.0.1/*';
const NOTIFICATION_ID = `qc ${SITE}`;

async function logOf(serviceWorker, kind) {
  const log = await inServiceWorker(serviceWorker, () => QueueCue.debugLog.read());
  return log.filter((entry) => entry.kind === kind);
}

async function waitForLog(serviceWorker, kind, count) {
  await expect.poll(async () => (await logOf(serviceWorker, kind)).length, { timeout: 10000 }).toBe(count);
  return logOf(serviceWorker, kind);
}

// Long enough for any decision still on its way (decisions wait about half a second).
const settle = (page) => page.waitForTimeout(1200);

async function setUp(context, serviceWorker) {
  await inServiceWorker(serviceWorker, (site) => QueueCue.sites.watch(site), SITE);
  // Record each notification the extension asks Chrome to show.
  await inServiceWorker(serviceWorker, () => {
    self.shownNotifications = [];
    const create = chrome.notifications.create.bind(chrome.notifications);
    chrome.notifications.create = (id, options) => {
      self.shownNotifications.push({ id, options });
      return create(id, options);
    };
  });
}

async function openChat(context) {
  const chat = await context.newPage();
  await chat.goto(FAKE_CHAT_URL);
  await chat.waitForFunction(() => window.Tawk_API && window.Tawk_API.getStatus && window.Tawk_API.getStatus() === 'online');
  return chat;
}

// A tab that isn't the chat, for "the user is somewhere else".
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

test('an agent joining and an agent replying each give one alert naming the site; the visitor\'s messages and the chat ending give none', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello, my account number is 998877');
  await openElsewhere(context);

  await fake(chat, 'agentJoin');
  await fake(chat, 'agentMessage', 'Thanks, I can see account 998877');
  const alerts = await waitForLog(serviceWorker, 'alert', 2);
  expect(alerts.map((a) => a.title)).toEqual(['Agent joined on 127.0.0.1', 'Agent replied on 127.0.0.1']);

  await fake(chat, 'visitorMessage', 'Great');
  await fake(chat, 'endChat');
  await settle(chat);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(2);

  const shown = await inServiceWorker(serviceWorker, () => self.shownNotifications);
  expect(shown).toHaveLength(2);
  for (const { id, options } of shown) {
    expect(id).toBe(NOTIFICATION_ID);
    expect(options).toEqual({
      type: 'basic',
      iconUrl: expect.stringMatching(/^chrome-extension:\/\/[a-p]{32}\/icons\/icon-128\.png$/),
      title: expect.stringMatching(/^Agent (joined|replied) on 127\.0\.0\.1$/),
      message: 'Click to go to the chat.',
      requireInteraction: true
    });
  }
  // Never the message text.
  expect(JSON.stringify(shown)).not.toContain('998877');
  // One notification per site: the reply replaced the "joined" one.
  const open = await inServiceWorker(serviceWorker, () => chrome.notifications.getAll());
  expect(Object.keys(open)).toEqual([NOTIFICATION_ID]);
});

test('no alert while the chat tab is in front; an alert once it isn\'t', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await chat.bringToFront();

  await fake(chat, 'agentMessage', 'Reply while you watch');
  await waitForLog(serviceWorker, 'quiet', 1);
  await settle(chat);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(0);

  await openElsewhere(context);
  await fake(chat, 'agentMessage', 'Reply while you are away');
  await waitForLog(serviceWorker, 'alert', 1);
});

test('with the chat open in two tabs: one alert, or none if either tab is in front', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const first = await openChat(context);
  await fake(first, 'visitorMessage', 'Hello');
  const second = await openChat(context);
  await openElsewhere(context);

  await fake(first, 'agentMessage', 'Heard in both tabs');
  await waitForLog(serviceWorker, 'alert', 1);
  await waitForLog(serviceWorker, 'duplicate', 1);
  await settle(first);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(1);

  await second.bringToFront();
  await fake(first, 'agentMessage', 'Second reply');
  await waitForLog(serviceWorker, 'quiet', 1);
  await settle(first);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(1);
});

test('the same message again within 10 seconds isn\'t alerted twice; after that it is', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);

  await fake(chat, 'agentMessage', 'Are you still there?');
  await waitForLog(serviceWorker, 'alert', 1);
  await fake(chat, 'agentMessage', 'Are you still there?');
  await waitForLog(serviceWorker, 'duplicate', 1);
  await settle(chat);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(1);

  // Pretend the first one was 11 seconds ago rather than waiting.
  await inServiceWorker(serviceWorker, async () => {
    const { recentEvents } = await chrome.storage.session.get('recentEvents');
    for (const id of Object.keys(recentEvents)) recentEvents[id].firstAt -= 11000;
    await chrome.storage.session.set({ recentEvents });
  });
  await fake(chat, 'agentMessage', 'Are you still there?');
  await waitForLog(serviceWorker, 'alert', 2);
});

test('repeats are still caught after Chrome stops the service worker', async ({ context, serviceWorker, extensionId }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);
  await fake(chat, 'agentMessage', 'Hello?');
  await waitForLog(serviceWorker, 'alert', 1);

  await stopServiceWorker(context, extensionId);
  await fake(chat, 'agentMessage', 'Hello?'); // wakes the worker
  await waitForLog(serviceWorker, 'duplicate', 1);
  await settle(chat);
  expect(await logOf(serviceWorker, 'alert')).toHaveLength(1);
});

test('a decision the worker didn\'t finish before it stopped is finished when it starts again', async ({ context, serviceWorker, extensionId }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  const chatTabId = await tabIdOf(chat, serviceWorker);
  await openElsewhere(context);
  // As the worker would have left it if it stopped while waiting for the other tabs' copies.
  await inServiceWorker(serviceWorker, async ([site, tabId]) => {
    await chrome.storage.session.set({ recentEvents: { [`${site} agent_message:0123abcd`]: {
      firstAt: Date.now() - 2000, type: 'agent_message', site: '127.0.0.1', pattern: site, decided: false,
      reports: [{ tabId, windowId: (await chrome.tabs.get(tabId)).windowId, visible: true, focused: true }]
    } } });
  }, [SITE, chatTabId]);

  await stopServiceWorker(context, extensionId);
  const wake = await context.newPage(); // the popup's status request wakes the worker
  await wake.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const alerts = await waitForLog(serviceWorker, 'alert', 1);
  expect(alerts[0]).toMatchObject({ title: 'Agent replied on 127.0.0.1', tabId: chatTabId });
});

test('clicking the notification brings the chat tab to the front', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  const chatTabId = await tabIdOf(chat, serviceWorker);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);
  await fake(chat, 'agentMessage', 'Your reply');
  await waitForLog(serviceWorker, 'alert', 1);

  // What chrome.notifications.onClicked calls (tests can't click a real notification).
  const opened = await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.openChat(id), NOTIFICATION_ID);
  expect(opened).toBe(true);
  const after = await inServiceWorker(serviceWorker, async () => ({
    active: (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id,
    open: Object.keys(await chrome.notifications.getAll())
  }));
  expect(after).toEqual({ active: chatTabId, open: [] });
  expect((await logOf(serviceWorker, 'opened'))[0]).toMatchObject({ site: '127.0.0.1', tabId: chatTabId });

  // A second click on the same (now cleared) notification does nothing.
  expect(await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.openChat(id), NOTIFICATION_ID)).toBe(false);
});

test('if the chat tab was closed, clicking goes to another tab on the site, or does nothing if there is none', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const first = await openChat(context);
  await fake(first, 'visitorMessage', 'Hello');
  const second = await openChat(context);
  const secondTabId = await tabIdOf(second, serviceWorker);
  await openElsewhere(context);

  await fake(first, 'agentMessage', 'Reply');
  const [alert] = await waitForLog(serviceWorker, 'alert', 1);
  const target = alert.tabId === secondTabId ? second : first;
  const other = target === second ? first : second;
  const chatTabIds = await inServiceWorker(serviceWorker, async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' })).map((t) => t.id));
  await target.close();
  const opened = await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.openChat(id), NOTIFICATION_ID);
  expect(opened).toBe(true);
  const active = await inServiceWorker(serviceWorker, async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  expect(chatTabIds).toContain(active);
  expect(active).not.toBe(alert.tabId);

  // Now with no chat tab left at all.
  await openElsewhere(context);
  await fake(other, 'agentMessage', 'Another reply');
  await waitForLog(serviceWorker, 'alert', 2);
  await other.close();
  expect(await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.openChat(id), NOTIFICATION_ID)).toBe(false);
});

test('closing a notification forgets where it pointed', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await openElsewhere(context);
  await fake(chat, 'agentMessage', 'Reply');
  await waitForLog(serviceWorker, 'alert', 1);

  // What chrome.notifications.onClosed calls.
  await inServiceWorker(serviceWorker, (id) => QueueCue.alerts.forget(id), NOTIFICATION_ID);
  const targets = await inServiceWorker(serviceWorker, async () => (await chrome.storage.session.get('notificationTargets')).notificationTargets);
  expect(targets).toEqual({});
});

test('the fake chat\'s "in 5 seconds" button (for trying alerts by hand) alerts once you look away', async ({ context, serviceWorker }) => {
  await setUp(context, serviceWorker);
  const chat = await openChat(context);
  await chat.click('#visitor-message');
  await chat.click('#agent-message-later');
  await expect(chat.locator('#later-note')).toBeVisible();
  await openElsewhere(context);
  const [alert] = await waitForLog(serviceWorker, 'alert', 1);
  expect(alert.title).toBe('Agent replied on 127.0.0.1');
  await expect(chat.locator('#later-note')).toBeHidden();
});
