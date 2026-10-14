// Checks that the fake Tawk.to chat behaves like the real widget did in the live tests
// (notes/research/tawk.md, sections 7 and 8.3). These run without the extension.
const { test, expect } = require('@playwright/test');

const { FAKE_CHAT_URL: FAKE_CHAT } = require('../fake-chat-config');

// Runs before the page's own scripts: attaches a recorder to every Tawk_API callback,
// the way a site (or our hook) would set handlers before the widget loads.
function recordCallbacks() {
  const names = [
    'onBeforeLoad', 'onLoad', 'onStatusChange', 'onChatMaximized', 'onChatMinimized', 'onChatHidden',
    'onChatStarted', 'onChatEnded', 'onPrechatSubmit', 'onOfflineSubmit',
    'onChatMessageVisitor', 'onChatMessageAgent', 'onChatMessageSystem',
    'onAgentJoinChat', 'onAgentLeaveChat', 'onChatSatisfaction', 'onVisitorNameChanged',
    'onFileUpload', 'onTagsUpdated', 'onTranscriptRequest', 'onUnreadCountChanged'
  ];
  window.__calls = [];
  window.Tawk_API = {};
  names.forEach((name) => {
    window.Tawk_API[name] = function (...args) {
      const api = window.Tawk_API;
      window.__calls.push({
        name,
        args,
        status: typeof api.getStatus === 'function' ? api.getStatus() : null,
        ongoing: typeof api.isChatOngoing === 'function' ? api.isChatOngoing() : null
      });
    };
  });
}

async function openChat(page) {
  await page.addInitScript(recordCallbacks);
  await page.goto(FAKE_CHAT);
  await waitForLoad(page);
}

async function waitForLoad(page) {
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'onLoad'));
}

async function callNames(page) {
  return page.evaluate(() => window.__calls.map((c) => c.name));
}

async function callsNamed(page, name) {
  return page.evaluate((n) => window.__calls.filter((c) => c.name === n), name);
}

test('starts up in the same order as the real widget', async ({ page }) => {
  await openChat(page);
  expect(await callNames(page)).toEqual(['onBeforeLoad', 'onStatusChange', 'onLoad']);

  const [statusChange] = await callsNamed(page, 'onStatusChange');
  expect(statusChange.args).toEqual(['online']);
  expect(statusChange.status).toBe('');

  const [load] = await callsNamed(page, 'onLoad');
  expect(load.status).toBe('online');
});

test('passes the same data as the real widget', async ({ page }) => {
  await openChat(page);

  await page.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await page.evaluate(() => window.FakeTawk.agentJoin());
  await page.evaluate(() => window.FakeTawk.agentMessage('How can I help?'));

  expect((await callNames(page)).slice(3)).toEqual([
    'onChatMessageVisitor', 'onChatStarted', 'onAgentJoinChat', 'onChatMessageAgent'
  ]);

  const [visitor] = await callsNamed(page, 'onChatMessageVisitor');
  expect(visitor.args).toEqual([{ message: 'Hello', attachments: [] }]);

  const [started] = await callsNamed(page, 'onChatStarted');
  expect(Object.keys(started.args[0])).toEqual(['chatId']);
  expect(started.args[0].chatId).toMatch(/^[0-9a-f-]{36}$/);

  const [joined] = await callsNamed(page, 'onAgentJoinChat');
  expect(Object.keys(joined.args[0]).sort()).toEqual(['id', 'image', 'name', 'position']);

  const [agent] = await callsNamed(page, 'onChatMessageAgent');
  expect(agent.args).toEqual([{ message: 'How can I help?', attachments: [] }]);
});

test('says the chat is ongoing only after the first agent message', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await page.evaluate(() => window.FakeTawk.agentJoin());
  expect(await page.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(false);
  expect(await page.evaluate(() => window.Tawk_API.isVisitorEngaged())).toBe(true);

  await page.evaluate(() => window.FakeTawk.agentMessage('Hi'));
  expect(await page.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(true);
});

test('reads each callback only once, when it loads', async ({ page }) => {
  await openChat(page);

  // A handler swapped in after load is ignored; the one set before load keeps firing.
  await page.evaluate(() => {
    window.__lateCalls = 0;
    window.Tawk_API.onChatMessageAgent = () => { window.__lateCalls += 1; };
  });
  await page.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await page.evaluate(() => window.FakeTawk.agentMessage('Reply'));

  expect(await page.evaluate(() => window.__lateCalls)).toBe(0);
  expect(await callsNamed(page, 'onChatMessageAgent')).toHaveLength(1);
});

test('reads a getter/setter callback once and calls what the getter returned', async ({ page }) => {
  // Imitates the planned hook: a wrapper behind a getter, and the site setting its handler later.
  await page.addInitScript(() => {
    window.__getterReads = 0;
    window.__wrapperCalls = [];
    window.__siteCalls = [];
    let siteHandler = null;
    const wrapper = function (message) {
      window.__wrapperCalls.push(message);
      if (typeof siteHandler === 'function') siteHandler.apply(this, arguments);
    };
    window.Tawk_API = {};
    Object.defineProperty(window.Tawk_API, 'onChatMessageAgent', {
      configurable: true,
      enumerable: true,
      get() { window.__getterReads += 1; return wrapper; },
      set(fn) { siteHandler = fn; }
    });
    window.Tawk_API.onChatMessageAgent = (message) => window.__siteCalls.push(message);
    window.Tawk_API.onLoad = () => { window.__loaded = true; };
  });
  await page.goto(FAKE_CHAT);
  await page.waitForFunction(() => window.__loaded === true);

  await page.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await page.evaluate(() => window.FakeTawk.agentMessage('Reply'));

  expect(await page.evaluate(() => window.__getterReads)).toBe(1);
  expect(await page.evaluate(() => window.__wrapperCalls)).toEqual([{ message: 'Reply', attachments: [] }]);
  expect(await page.evaluate(() => window.__siteCalls)).toEqual([{ message: 'Reply', attachments: [] }]);
});

test('after a refresh, shows old messages without firing them again', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await page.evaluate(() => window.FakeTawk.agentJoin());
  await page.evaluate(() => window.FakeTawk.agentMessage('Reply 1'));
  await page.evaluate(() => window.FakeTawk.agentMessage('Reply 2'));
  const [started] = await callsNamed(page, 'onChatStarted');

  await page.reload();
  await waitForLoad(page);

  // Only the start-up callbacks, plus onChatStarted again with the same chat ID.
  expect(await callNames(page)).toEqual(['onBeforeLoad', 'onStatusChange', 'onChatStarted', 'onLoad']);
  const [startedAgain] = await callsNamed(page, 'onChatStarted');
  expect(startedAgain.args).toEqual(started.args);

  // The old messages are still shown in the widget.
  await expect(page.locator('#fake-tawk-widget .fake-tawk-message')).toHaveCount(3);
});

test('every open tab hears agent events', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await openChat(first);
  await first.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await openChat(second);

  // The agent's buttons on the first tab stand in for the Tawk.to dashboard.
  await first.click('#agent-join');
  await first.click('#agent-message');

  for (const page of [first, second]) {
    await expect.poll(() => callsNamed(page, 'onChatMessageAgent')).toHaveLength(1);
    expect(await callsNamed(page, 'onAgentJoinChat')).toHaveLength(1);
    const [agent] = await callsNamed(page, 'onChatMessageAgent');
    expect(agent.args).toEqual([{ message: 'Agent reply 1', attachments: [] }]);
  }
});

// Records every "tawk..." window event and every callback, in one list, to compare the two.
function recordEventsAndCallbacks() {
  const names = ['BeforeLoad', 'Load', 'StatusChange', 'ChatStarted', 'ChatEnded', 'ChatMessageVisitor',
    'ChatMessageAgent', 'AgentJoinChat', 'AgentLeaveChat'];
  window.__seen = [];
  window.Tawk_API = {};
  names.forEach((n) => {
    window.addEventListener('tawk' + n, (event) => window.__seen.push({
      what: 'event tawk' + n, detail: event.detail, custom: event instanceof CustomEvent, bubbles: event.bubbles
    }));
    window.Tawk_API['on' + n] = (...args) => window.__seen.push({ what: 'callback on' + n, args });
  });
}

async function openRecorded(page) {
  await page.addInitScript(recordEventsAndCallbacks);
  await page.goto(FAKE_CHAT);
  await page.waitForFunction(() => window.__seen.some((s) => s.what === 'callback onLoad'));
}

const seen = (page) => page.evaluate(() => window.__seen);
const seenNamed = async (page, what) => (await seen(page)).filter((s) => s.what === what);

test('sends each event on window first, then to the callback, with the same data', async ({ page }) => {
  await openRecorded(page);
  await page.evaluate(() => {
    window.FakeTawk.visitorMessage('Hello');
    window.FakeTawk.agentJoin();
    window.FakeTawk.agentMessage('Hi');
    window.FakeTawk.endChat();
  });
  const all = await seen(page);
  expect(all.map((s) => s.what)).toEqual([
    'event tawkBeforeLoad', 'callback onBeforeLoad', 'event tawkStatusChange', 'callback onStatusChange',
    'event tawkLoad', 'callback onLoad',
    'event tawkChatMessageVisitor', 'callback onChatMessageVisitor', 'event tawkChatStarted', 'callback onChatStarted',
    'event tawkAgentJoinChat', 'callback onAgentJoinChat', 'event tawkChatMessageAgent', 'callback onChatMessageAgent',
    'event tawkChatEnded', 'callback onChatEnded'
  ]);
  for (let i = 0; i < all.length; i += 2) {
    expect(all[i]).toMatchObject({ custom: true, bubbles: false });
    // A callback with data gets it as its one argument; the event's detail is the same, or null.
    expect(all[i].detail).toEqual(all[i + 1].args.length ? all[i + 1].args[0] : null);
  }
  const [agent] = await seenNamed(page, 'event tawkChatMessageAgent');
  expect(agent.detail).toEqual({ message: 'Hi', attachments: [] });
});

test('a visitor\'s message only fires in its own tab; the chat starting reaches the other tabs', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await openRecorded(first);
  await openRecorded(second);
  await first.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
  await expect.poll(async () => (await seen(second)).map((s) => s.what).slice(6))
    .toEqual(['event tawkChatStarted', 'callback onChatStarted']);
  const [started] = await seenNamed(first, 'event tawkChatStarted');
  const [startedThere] = await seenNamed(second, 'event tawkChatStarted');
  expect(startedThere.detail).toEqual(started.detail);
});

test('the agent closing the chat fires only "agent left", in every tab; the agent can come back', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await openRecorded(first);
  await openRecorded(second);
  await first.evaluate(() => {
    window.FakeTawk.visitorMessage('Hello');
    window.FakeTawk.agentJoin();
    window.FakeTawk.agentMessage('Reply A');
  });
  expect(await first.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(true);

  await first.evaluate(() => window.FakeTawk.agentLeave());
  for (const p of [first, second]) {
    await expect.poll(async () => (await seenNamed(p, 'event tawkAgentLeaveChat')).length).toBe(1);
    const [left] = await seenNamed(p, 'event tawkAgentLeaveChat');
    expect(Object.keys(left.detail).sort()).toEqual(['id', 'image', 'name', 'position']);
    expect(await seenNamed(p, 'event tawkChatEnded')).toHaveLength(0);
    expect(await p.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(false);
    expect(await p.evaluate(() => window.Tawk_API.isVisitorEngaged())).toBe(true);
  }

  await first.evaluate(() => {
    window.FakeTawk.agentJoin();
    window.FakeTawk.agentMessage('Reply B');
  });
  for (const p of [first, second]) {
    await expect.poll(async () => (await seenNamed(p, 'event tawkChatMessageAgent')).map((s) => s.detail.message))
      .toEqual(['Reply A', 'Reply B']);
  }
  expect(await first.evaluate(() => window.Tawk_API.isChatOngoing())).toBe(true);
  // Same chat: no second chat start.
  expect(await seenNamed(first, 'event tawkChatStarted')).toHaveLength(1);
});

test('a page without the snippet gets no Tawk_API', async ({ page }) => {
  await page.goto(FAKE_CHAT + 'no-vendor.html');
  expect(await page.evaluate(() => typeof window.Tawk_API)).toBe('undefined');
});
