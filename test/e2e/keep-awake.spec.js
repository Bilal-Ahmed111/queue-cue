// Phase 3, step 4: keep the PC awake while a watched chat is going (src/background/keep-awake.js).
// Fake chat only. Tests can't see whether Windows really stays awake (that's Bilal's check with
// powercfg /requests): they read the dev-mode log (kind "keep-awake") and record the calls to chrome.power.
const { test, expect, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL } = require('../fake-chat-config');
const { stopServiceWorker } = require('./service-worker-restart');

const SITE = 'http://127.0.0.1/*';
const ALARM = 'qc-keep-awake-limit';

async function switches(serviceWorker) {
  const log = await inServiceWorker(serviceWorker, () => QueueCue.debugLog.read());
  return log.filter((e) => e.kind === 'keep-awake').map((e) => `${e.on ? 'on' : 'off'}: ${e.reason}`);
}

async function waitForSwitches(serviceWorker, expected) {
  await expect.poll(() => switches(serviceWorker), { timeout: 10000 }).toEqual(expected);
}

async function setUp(serviceWorker) {
  await inServiceWorker(serviceWorker, (site) => QueueCue.sites.watch(site), SITE);
  // Record each call to chrome.power.
  await inServiceWorker(serviceWorker, () => {
    self.powerCalls = [];
    const request = chrome.power.requestKeepAwake.bind(chrome.power);
    const release = chrome.power.releaseKeepAwake.bind(chrome.power);
    chrome.power.requestKeepAwake = (level) => { self.powerCalls.push(`request ${level}`); return request(level); };
    chrome.power.releaseKeepAwake = () => { self.powerCalls.push('release'); return release(); };
  });
}

async function openChat(context, path = '/') {
  const chat = await context.newPage();
  await chat.goto(new URL(path, FAKE_CHAT_URL).href);
  await chat.waitForFunction(() => window.Tawk_API && window.Tawk_API.getStatus && window.Tawk_API.getStatus() === 'online');
  return chat;
}

const fake = (chat, action, text) => chat.evaluate(([a, t]) => window.FakeTawk[a](t), [action, text]);

const settle = (page) => page.waitForTimeout(800);

function alarm(serviceWorker) {
  return inServiceWorker(serviceWorker, (name) => chrome.alarms.get(name), ALARM);
}

test('a chat starting keeps the PC awake at "system" level, with a 60-minute limit; the chat ending lets it sleep', async ({ context, serviceWorker }) => {
  await setUp(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1']);
  expect(await inServiceWorker(serviceWorker, () => self.powerCalls)).toEqual(['request system']);
  const limit = await alarm(serviceWorker);
  expect(Math.abs(limit.scheduledTime - (Date.now() + 60 * 60 * 1000))).toBeLessThan(2 * 60 * 1000);

  // More activity keeps it on (and moves the limit), without switching it on again.
  await fake(chat, 'agentJoin');
  await fake(chat, 'agentMessage', 'Hi');
  await settle(chat);
  expect(await switches(serviceWorker)).toEqual(['on: chat going on 127.0.0.1']);

  await fake(chat, 'endChat');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1', 'off: chat ended on 127.0.0.1']);
  expect((await inServiceWorker(serviceWorker, () => self.powerCalls)).at(-1)).toBe('release');
  expect(await alarm(serviceWorker)).toBeUndefined();
});

test('with the chat in two tabs, closing one keeps the PC awake; closing both lets it sleep', async ({ context, serviceWorker }) => {
  await setUp(serviceWorker);
  const first = await openChat(context);
  const second = await openChat(context);
  await fake(first, 'visitorMessage', 'Hello'); // heard in both tabs
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1']);
  await settle(first);

  await first.close();
  await settle(second);
  expect(await switches(serviceWorker)).toEqual(['on: chat going on 127.0.0.1']);

  await second.close();
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1', 'off: chat tab closed']);
});

test('reloading the chat or moving around the site keeps the PC awake; going to another site lets it sleep', async ({ context, serviceWorker }) => {
  await setUp(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1']);

  await chat.reload();
  await chat.goto(new URL('/no-vendor.html', FAKE_CHAT_URL).href);
  await settle(chat);
  expect(await switches(serviceWorker)).toEqual(['on: chat going on 127.0.0.1']);

  await chat.goto('about:blank');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1', 'off: chat tab left the site']);
});

test('60 minutes with no chat activity lets the PC sleep; recent activity keeps it awake', async ({ context, serviceWorker }) => {
  await setUp(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1']);

  // The alarm going off early, with activity 59 minutes ago: stays on and sets a new limit.
  await inServiceWorker(serviceWorker, async (name) => {
    const { keepAwake } = await chrome.storage.session.get('keepAwake');
    keepAwake.lastActivity = Date.now() - 59 * 60 * 1000;
    await chrome.storage.session.set({ keepAwake });
    await QueueCue.keepAwake.onAlarm({ name });
  }, ALARM);
  expect(await switches(serviceWorker)).toEqual(['on: chat going on 127.0.0.1']);
  expect(await alarm(serviceWorker)).toBeDefined();

  // Activity 61 minutes ago, and Chrome's real alarm firing (unpacked extensions may set alarms under 30 s).
  await inServiceWorker(serviceWorker, async (name) => {
    const { keepAwake } = await chrome.storage.session.get('keepAwake');
    keepAwake.lastActivity = Date.now() - 61 * 60 * 1000;
    await chrome.storage.session.set({ keepAwake });
    await chrome.alarms.create(name, { when: Date.now() + 500 });
  }, ALARM);
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1', 'off: no chat activity for 60 minutes']);
  expect(await alarm(serviceWorker)).toBeUndefined();
});

test('"Stop watching this site" lets the PC sleep', async ({ context, serviceWorker, extensionId }) => {
  await setUp(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1']);

  const popup = await context.newPage();
  await popup.addInitScript((url) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info) => (info && info.active ? Promise.resolve([{ id: -1, active: true, url }]) : query(info));
  }, chat.url());
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await popup.getByRole('button', { name: 'Stop watching this site' }).click();
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1', 'off: site no longer watched']);
});

test('after Chrome stops the service worker, a chat tab closing still lets the PC sleep', async ({ context, serviceWorker, extensionId }) => {
  await setUp(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1']);

  await stopServiceWorker(context, extensionId);
  await chat.close(); // Chrome wakes the worker for tabs.onRemoved
  // Whichever notices first switches it off: the tabs.onRemoved handler, or the start-up check that
  // runs as the worker wakes. Either way it switches off exactly once.
  await expect.poll(() => switches(serviceWorker), { timeout: 10000 }).toHaveLength(2);
  const [on, off] = await switches(serviceWorker);
  expect(on).toBe('on: chat going on 127.0.0.1');
  expect(['off: chat tab closed', 'off: start-up check']).toContain(off);
});

test('when the service worker starts, keep-awake for tabs that are gone is let go', async ({ context, serviceWorker, extensionId }) => {
  await setUp(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1']);

  // As if the tab had closed while the worker was stopped and the event was missed.
  await inServiceWorker(serviceWorker, async (site) => {
    const { keepAwake } = await chrome.storage.session.get('keepAwake');
    keepAwake.tabs = { 999999: site };
    await chrome.storage.session.set({ keepAwake });
  }, SITE);
  await stopServiceWorker(context, extensionId);
  const wake = await context.newPage();
  await wake.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await waitForSwitches(serviceWorker, ['on: chat going on 127.0.0.1', 'off: start-up check']);
});
