// Reviewer "try to break it" tests, Phase 3: keep-awake (src/background/keep-awake.js). Fake chat only.
// Reads the dev-mode log (kind "keep-awake") and the saved state; whether Windows really stays awake is a manual check.
// The test copy of the extension only has access to http://127.0.0.1, so http://localhost (same test server)
// stands in for "another website Queue Cue has no access to".
const { test, expect, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL, FAKE_CHAT_PORT } = require('../fake-chat-config');
const { stopServiceWorker } = require('./service-worker-restart');

const SITE = 'http://127.0.0.1/*';
const OTHER_SITE_PAGE = `http://localhost:${FAKE_CHAT_PORT}/no-vendor.html`;

async function switches(serviceWorker) {
  const log = await inServiceWorker(serviceWorker, () => QueueCue.debugLog.read());
  return log.filter((e) => e.kind === 'keep-awake').map((e) => `${e.on ? 'on' : 'off'}: ${e.reason}`);
}

function savedState(serviceWorker) {
  return inServiceWorker(serviceWorker, async () => (await chrome.storage.session.get('keepAwake')).keepAwake || null);
}

async function expectOffInTheEnd(serviceWorker) {
  await expect.poll(async () => {
    const state = await savedState(serviceWorker);
    return { on: !!(state && state.on), tabs: state ? Object.keys(state.tabs).length : 0 };
  }, { timeout: 10000 }).toEqual({ on: false, tabs: 0 });
  const alarm = await inServiceWorker(serviceWorker, () => chrome.alarms.get('qc-keep-awake-limit'));
  expect(alarm).toBeUndefined();
}

function watch(serviceWorker) {
  return inServiceWorker(serviceWorker, (site) => QueueCue.sites.watch(site), SITE);
}

async function openChat(context) {
  const chat = await context.newPage();
  await chat.goto(FAKE_CHAT_URL);
  await chat.waitForFunction(() => window.Tawk_API && window.Tawk_API.getStatus && window.Tawk_API.getStatus() === 'online');
  return chat;
}

async function startChat(context, serviceWorker) {
  await watch(serviceWorker);
  const chat = await openChat(context);
  await chat.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await expect.poll(() => switches(serviceWorker), { timeout: 10000 }).toEqual(['on: chat going on 127.0.0.1']);
  return chat;
}

test('the chat tab going to another website (typed in the address bar) lets the PC sleep', async ({ context, serviceWorker }) => {
  const chat = await startChat(context, serviceWorker);
  await chat.goto(OTHER_SITE_PAGE);
  await expectOffInTheEnd(serviceWorker);
});

test('the chat tab going to another website by a link on the page lets the PC sleep', async ({ context, serviceWorker }) => {
  const chat = await startChat(context, serviceWorker);
  await Promise.all([
    chat.waitForURL(OTHER_SITE_PAGE),
    chat.evaluate((url) => { window.location.href = url; }, OTHER_SITE_PAGE)
  ]);
  await expectOffInTheEnd(serviceWorker);
});

test('closing the chat tab straight after a burst of messages still lets the PC sleep', async ({ context, serviceWorker }) => {
  const chat = await startChat(context, serviceWorker);
  // Many events still being handled when Chrome reports the tab closed.
  await chat.evaluate(() => {
    for (let i = 1; i <= 12; i += 1) window.FakeTawk.agentMessage('Last words ' + i);
  });
  await chat.close();
  await expectOffInTheEnd(serviceWorker);
});

test('the service worker stopping mid-chat does not switch keep-awake off while the chat is still open', async ({ context, serviceWorker, extensionId }) => {
  const chat = await startChat(context, serviceWorker);
  await stopServiceWorker(context, extensionId);
  await chat.evaluate(() => window.FakeTawk.agentMessage('Still here')); // wakes the worker
  await chat.waitForTimeout(1500);
  expect(await switches(serviceWorker)).toEqual(['on: chat going on 127.0.0.1']);
  expect((await savedState(serviceWorker)).on).toBe(true);
  expect(await inServiceWorker(serviceWorker, () => chrome.alarms.get('qc-keep-awake-limit'))).toBeDefined();
});

test('after a chat ends, starting a new chat on the same page keeps the PC awake again', async ({ context, serviceWorker }) => {
  const chat = await startChat(context, serviceWorker);
  await chat.evaluate(() => window.FakeTawk.endChat());
  await expect.poll(() => switches(serviceWorker), { timeout: 10000 }).toEqual(['on: chat going on 127.0.0.1', 'off: chat ended on 127.0.0.1']);
  await chat.evaluate(() => window.FakeTawk.visitorMessage('A new question'));
  await expect.poll(() => switches(serviceWorker), { timeout: 10000 }).toEqual(['on: chat going on 127.0.0.1', 'off: chat ended on 127.0.0.1', 'on: chat going on 127.0.0.1']);
});
