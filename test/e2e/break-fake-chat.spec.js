// Reviewer's "try to break it" tests for the fake Tawk.to chat (test/fake-chat/fake-tawk.js).
// No extension loaded. Each test gets a fresh browser context, so the fake's saved chat starts empty.
const { plainTest: test, expect } = require('./fixtures');

const { FAKE_CHAT_URL: FAKE_CHAT } = require('../fake-chat-config');

function recordCallbacks() {
  const names = [
    'onBeforeLoad', 'onLoad', 'onStatusChange', 'onChatStarted', 'onChatEnded',
    'onChatMessageVisitor', 'onChatMessageAgent', 'onChatMessageSystem',
    'onAgentJoinChat', 'onAgentLeaveChat', 'onUnreadCountChanged'
  ];
  window.__calls = [];
  window.Tawk_API = window.Tawk_API || {};
  window.__snippetApi = window.Tawk_API;
  names.forEach((name) => {
    window.Tawk_API[name] = function (...args) { window.__calls.push({ name, args }); };
  });
}

async function openChat(page, url = FAKE_CHAT) {
  await page.addInitScript(recordCallbacks);
  await page.goto(url);
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'onLoad'));
}

const names = (page) => page.evaluate(() => window.__calls.map((c) => c.name));
const named = (page, n) => page.evaluate((x) => window.__calls.filter((c) => c.name === x), n);
const STARTUP = ['onBeforeLoad', 'onStatusChange', 'onLoad'];

test('agent actions before any visitor message are refused and fire nothing', async ({ page }) => {
  await openChat(page);
  await expect(page.evaluate(() => window.FakeTawk.agentJoin())).rejects.toThrow(/visitor must send a message/);
  await expect(page.evaluate(() => window.FakeTawk.agentMessage('hi'))).rejects.toThrow(/no chat/);
  expect(await names(page)).toEqual(STARTUP);
  expect(await page.evaluate(() => window.Tawk_API.isVisitorEngaged())).toBe(false);
});

test('Tawk_API stays the same object the snippet created (section 7)', async ({ page }) => {
  await openChat(page);
  expect(await page.evaluate(() => window.__snippetApi === window.Tawk_API)).toBe(true);
});

test('ending the chat fires onChatEnded in every tab, then agent replies are refused', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await openChat(a);
  await openChat(b);
  await a.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await a.evaluate(() => window.FakeTawk.agentMessage('Hi'));
  await a.evaluate(() => window.FakeTawk.endChat());

  for (const p of [a, b]) {
    await expect.poll(() => named(p, 'onChatEnded')).toHaveLength(1);
    expect(await p.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(false);
    expect(await p.evaluate(() => window.Tawk_API.isVisitorEngaged())).toBe(false);
  }
  await expect(a.evaluate(() => window.FakeTawk.agentMessage('late'))).rejects.toThrow(/no chat/);
  // Ending twice does nothing the second time.
  await a.evaluate(() => window.FakeTawk.endChat());
  await a.waitForTimeout(100);
  expect(await named(a, 'onChatEnded')).toHaveLength(1);
});

test('reload after the chat ended: no onChatStarted, no replay, a new message starts a new chat', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await page.evaluate(() => window.FakeTawk.agentJoin());
  await page.evaluate(() => window.FakeTawk.agentMessage('Bye'));
  const [first] = await named(page, 'onChatStarted');
  await page.evaluate(() => window.FakeTawk.endChat());

  await page.reload();
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'onLoad'));
  expect(await names(page)).toEqual(STARTUP);
  await expect(page.locator('#fake-tawk-widget')).toContainText('Chat ended');

  await page.evaluate(() => window.FakeTawk.visitorMessage('Back again'));
  const [second] = await named(page, 'onChatStarted');
  expect(second.args[0].chatId).not.toBe(first.args[0].chatId);
  // The new chat has no agent yet.
  expect(await page.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(false);
});

test('reset forgets the chat: reload fires only the start-up callbacks', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await page.evaluate(() => window.FakeTawk.agentMessage('Hi'));
  await page.evaluate(() => window.FakeTawk.reset());
  expect(await page.evaluate(() => window.Tawk_API.isVisitorEngaged())).toBe(false);
  await page.reload();
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'onLoad'));
  expect(await names(page)).toEqual(STARTUP);
  await expect(page.locator('#fake-tawk-widget .fake-tawk-message')).toHaveCount(0);
});

test('a tab opened mid-chat gets onChatStarted with the same chatId and no old messages', async ({ context }) => {
  const a = await context.newPage();
  await openChat(a);
  await a.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await a.evaluate(() => window.FakeTawk.agentJoin());
  await a.evaluate(() => window.FakeTawk.agentMessage('Reply'));
  const [started] = await named(a, 'onChatStarted');

  const b = await context.newPage();
  await openChat(b);
  expect(await names(b)).toEqual(['onBeforeLoad', 'onStatusChange', 'onChatStarted', 'onLoad']);
  const [startedB] = await named(b, 'onChatStarted');
  expect(startedB.args).toEqual(started.args);
  expect(await b.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(true);
});

test('50 agent messages in a burst arrive in order, once each, in both tabs', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await openChat(a);
  await openChat(b);
  await a.evaluate(() => {
    window.FakeTawk.visitorMessage('Hello');
    for (let i = 0; i < 50; i += 1) window.FakeTawk.agentMessage('m' + i);
  });
  const expected = Array.from({ length: 50 }, (_, i) => [{ message: 'm' + i, attachments: [] }]);
  for (const p of [a, b]) {
    await expect.poll(async () => (await named(p, 'onChatMessageAgent')).length).toBe(50);
    expect((await named(p, 'onChatMessageAgent')).map((c) => c.args)).toEqual(expected);
  }
});

test('message text with HTML is shown as text, not run as code', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => window.FakeTawk.visitorMessage('<img src=x onerror="window.__xss=1">'));
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#fake-tawk-widget')).toContainText('<img src=x');
});

// The real server sends each agent reply to every tab on its own, so a site handler that throws in one
// tab can't stop another tab hearing the reply. Phase 3's "the site's handler throws" tests rely on this.
test('a site handler that throws in one tab does not stop the other tab hearing the agent', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.addInitScript(() => {
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_API.onChatMessageAgent = () => { throw new Error('site handler bug'); };
    window.Tawk_API.onLoad = () => { window.__loaded = true; };
  });
  await a.goto(FAKE_CHAT);
  await a.waitForFunction(() => window.__loaded === true);
  await openChat(b);

  await a.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await a.evaluate(() => {
    try { window.FakeTawk.agentMessage('Reply'); } catch (e) { /* the site's own bug */ }
  });
  await expect.poll(async () => (await named(b, 'onChatMessageAgent')).length, { timeout: 2000 }).toBe(1);
});
