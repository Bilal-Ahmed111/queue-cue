// Phase 3, step 2: the hook (src/content/hook.js), the Tawk.to detector (src/detectors/tawk.js) and the
// relay (src/content/relay.js) get chat events to the service worker, which records them in the
// dev-mode log (kind "event"). The detector listens to the widget's "tawk..." window events (tawk.md 8.3).
// Fake chat only: a fake proves the logic; only the real chat proves it works.
// Turning events into alerts (duplicates, quiet rule, notifications) is step 3.
const { test, expect, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL } = require('../fake-chat-config');

const SITE = 'http://127.0.0.1/*';
const page = (path) => new URL(path, FAKE_CHAT_URL).href;

function watchFakeChat(serviceWorker) {
  return inServiceWorker(serviceWorker, (site) => QueueCue.sites.watch(site), SITE);
}

async function readEvents(serviceWorker) {
  const log = await inServiceWorker(serviceWorker, () => QueueCue.debugLog.read());
  return log.filter((entry) => entry.kind === 'event');
}

async function eventsAfter(serviceWorker, count) {
  await expect.poll(async () => (await readEvents(serviceWorker)).length).toBe(count);
  return readEvents(serviceWorker);
}

// Lets the relay and the service worker finish anything still on its way.
async function settle(chat) {
  await chat.waitForTimeout(500);
}

async function openChat(context, path = '/') {
  const chat = await context.newPage();
  await chat.goto(page(path));
  await waitUntilLoaded(chat);
  return chat;
}

function waitUntilLoaded(chat) {
  return chat.waitForFunction(() => window.Tawk_API && window.Tawk_API.getStatus && window.Tawk_API.getStatus() === 'online');
}

const fake = (chat, action, text) => chat.evaluate(([a, t]) => window.FakeTawk[a](t), [action, text]);

test('agent joins, agent replies, visitor writes and chat ends each reach the service worker', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await openChat(context);
  const tabId = await inServiceWorker(serviceWorker, async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0].id);

  await fake(chat, 'visitorMessage', 'Hello, I need help');
  await fake(chat, 'agentJoin');
  await fake(chat, 'agentMessage', 'Hi, how can I help?');
  await fake(chat, 'endChat');

  const events = await eventsAfter(serviceWorker, 4);
  expect(events.map((e) => e.type)).toEqual(['visitor_message', 'agent_joined', 'agent_message', 'chat_ended']);
  for (const e of events) {
    expect(e).toMatchObject({ kind: 'event', platform: 'tawk', site: '127.0.0.1', tabId, page: { visible: true, focused: true } });
  }
  expect(events[0].messageKey).toMatch(/^visitor_message:[0-9a-f]{8}$/);
  expect(events[1].messageKey).toMatch(/^agent_joined:[0-9a-f]{8}$/);
  expect(events[2].messageKey).toMatch(/^agent_message:[0-9a-f]{8}$/);
  expect(events[3].messageKey).toBe('chat_ended');
});

test('the same text gives the same key, other text another key, and the text itself never leaves the page', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'My order number is 12345');
  await fake(chat, 'agentMessage', 'Same words');
  await fake(chat, 'agentMessage', 'Same words');
  await fake(chat, 'agentMessage', 'Other words');

  const events = await eventsAfter(serviceWorker, 4);
  const keys = events.map((e) => e.messageKey);
  expect(keys[1]).toBe(keys[2]);
  expect(keys[3]).not.toBe(keys[1]);
  const everything = JSON.stringify(await inServiceWorker(serviceWorker, async () => ({
    session: await chrome.storage.session.get(null),
    local: await chrome.storage.local.get(null)
  })));
  for (const text of ['12345', 'My order', 'Same words', 'Other words']) expect(everything).not.toContain(text);
});

test('with the chat open in two tabs, each tab reports the agent\'s reply under the same key', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const first = await openChat(context);
  await fake(first, 'visitorMessage', 'Hello');
  const second = await openChat(context);
  await eventsAfter(serviceWorker, 1);

  await fake(second, 'agentMessage', 'Reply heard everywhere');
  const events = (await eventsAfter(serviceWorker, 3)).slice(1);
  expect(events.map((e) => e.type)).toEqual(['agent_message', 'agent_message']);
  expect(events[0].messageKey).toBe(events[1].messageKey);
  expect(events[0].tabId).not.toBe(events[1].tabId);
});

test('the agent closing the chat reports nothing; an agent coming back is reported as usual', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await fake(chat, 'agentJoin');
  await fake(chat, 'agentMessage', 'Reply A');
  await eventsAfter(serviceWorker, 3);

  await fake(chat, 'agentLeave');
  await settle(chat);
  expect(await readEvents(serviceWorker)).toHaveLength(3);

  await fake(chat, 'agentJoin');
  await fake(chat, 'agentMessage', 'Reply B');
  const events = await eventsAfter(serviceWorker, 5);
  expect(events.slice(3).map((e) => e.type)).toEqual(['agent_joined', 'agent_message']);
});

test('after a refresh, old messages report nothing', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await fake(chat, 'agentJoin');
  await fake(chat, 'agentMessage', 'Old reply');
  await eventsAfter(serviceWorker, 3);

  await chat.reload();
  await waitUntilLoaded(chat);
  await settle(chat);
  expect(await readEvents(serviceWorker)).toHaveLength(3);
});

test('anything Tawk.to fires before it has finished loading is ignored', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await openChat(context);
  await fake(chat, 'visitorMessage', 'Hello');
  await eventsAfter(serviceWorker, 1);

  // On the next load, make the fake fire an agent message the moment its script runs, before onLoad.
  await chat.addInitScript(() => {
    let fakeTawk;
    Object.defineProperty(window, 'FakeTawk', {
      configurable: true,
      get() { return fakeTawk; },
      set(value) {
        fakeTawk = value;
        value.agentMessage('Early reply');
        window.earlyReplyFired = true;
      }
    });
  });
  await chat.reload();
  await waitUntilLoaded(chat);
  expect(await chat.evaluate(() => window.earlyReplyFired)).toBe(true);
  await settle(chat);
  expect(await readEvents(serviceWorker)).toHaveLength(1);

  await fake(chat, 'agentMessage', 'Late reply');
  const events = await eventsAfter(serviceWorker, 2);
  expect(events[1].type).toBe('agent_message');
});

test('if Tawk.to never signals it has loaded, events count from 5 seconds after it started', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await context.newPage();
  await chat.addInitScript(() => { window.FakeTawkOptions = { skipOnLoad: true }; });
  await chat.goto(page('/'));
  await chat.waitForFunction(() => !!window.FakeTawk);
  await chat.waitForTimeout(300); // onBeforeLoad has fired; onLoad never will
  expect(await chat.evaluate(() => window.Tawk_API.getStatus())).toBe('');

  await fake(chat, 'visitorMessage', 'Too early');
  await chat.waitForTimeout(5200);
  expect(await readEvents(serviceWorker)).toHaveLength(0);

  await fake(chat, 'agentMessage', 'After the fallback');
  const events = await eventsAfter(serviceWorker, 1);
  expect(events[0].type).toBe('agent_message');
});

// Runs the same chat on site-handlers.html and returns what the site's own handlers saw.
async function siteHandlerRun(chat) {
  await waitUntilLoaded(chat);
  return chat.evaluate(() => {
    const t = window.FakeTawk;
    t.visitorMessage('Hi');
    t.agentJoin();
    t.agentMessage('Reply');
    let threw = false;
    try {
      t.endChat();
    } catch (e) {
      threw = e.message;
    }
    return { calls: window.siteCalls.slice(), threw };
  });
}

test('the site\'s own Tawk.to handlers see exactly what they would without Queue Cue', async ({ context, serviceWorker }) => {
  const chat = await context.newPage();
  await chat.goto(page('/site-handlers.html'));
  const without = await siteHandlerRun(chat);
  await chat.evaluate(() => window.FakeTawk.reset());

  await watchFakeChat(serviceWorker);
  await chat.reload();
  const withQueueCue = await siteHandlerRun(chat);

  expect(withQueueCue).toEqual(without);
  // What the site's handlers see, as a reminder of what this test covers:
  expect(without.calls).toEqual([
    'load',
    'visitor message (object literal): {"message":"Hi","attachments":[]}',
    'agent joined: ' + JSON.stringify({ name: 'Test Agent', position: '', image: 'https://embed.tawk.to/_s/v4/assets/images/default-profile.svg', id: 'fakeagent00000000000001' }),
    'agent message (first handler): {"message":"Reply","attachments":[]}',
    'agent message (chained handler): {"message":"Reply","attachments":[]}',
    'chat ended (throws)'
  ]);
  expect(without.threw).toBe('Site handler failed on purpose');

  // And Queue Cue still heard everything, once each, despite the chained and the throwing handlers.
  const events = await eventsAfter(serviceWorker, 4);
  expect(events.map((e) => e.type)).toEqual(['visitor_message', 'agent_joined', 'agent_message', 'chat_ended']);
});

test('Queue Cue leaves Tawk_API and the site\'s handlers exactly as the site made them', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await context.newPage();
  await chat.addInitScript(() => {
    window.__mine = function () {};
  });
  await chat.goto(page('/'));
  // Set like a site would, after the snippet; checked once the widget has loaded.
  await chat.evaluate(() => { window.Tawk_API.onChatMessageAgent = window.__mine; });
  await waitUntilLoaded(chat);
  const seen = await chat.evaluate(() => {
    const global = Object.getOwnPropertyDescriptor(window, 'Tawk_API');
    const handler = Object.getOwnPropertyDescriptor(window.Tawk_API, 'onChatMessageAgent');
    return {
      globalIsPlainValue: !!global && 'value' in global && !('get' in global),
      handlerIsPlainValue: !!handler && 'value' in handler && !('get' in handler),
      sameHandler: window.Tawk_API.onChatMessageAgent === window.__mine
    };
  });
  expect(seen).toEqual({ globalIsPlainValue: true, handlerIsPlainValue: true, sameHandler: true });
});

test('a watched page without Tawk.to gets no Tawk_API value, no errors and no events', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const plain = await context.newPage();
  const errors = [];
  plain.on('pageerror', (error) => errors.push(error.message));
  await plain.goto(page('/no-vendor.html'));

  const seen = await plain.evaluate(() => ({
    hookLoaded: Object.prototype.hasOwnProperty.call(window, '__queueCue'),
    hookListed: Object.keys(window).includes('__queueCue'),
    value: window.Tawk_API,
    type: typeof Tawk_API,
    inWindow: 'Tawk_API' in window
  }));
  expect(seen).toEqual({ hookLoaded: true, hookListed: false, type: 'undefined', inWindow: false });

  // Odd things a site might put in Tawk_API don't break anything, and read back as set.
  const readBack = await plain.evaluate(() => [5, 'text', null, Object.freeze({ onLoad: 1 }), Object.seal({})].map((value) => {
    window.Tawk_API = value;
    return window.Tawk_API === value;
  }));
  expect(readBack).toEqual([true, true, true, true, true]);
  await settle(plain);
  expect(errors).toEqual([]);
  expect(await readEvents(serviceWorker)).toEqual([]);
});

test('messages that only look like the hook\'s are ignored', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await openChat(context);
  await chat.evaluate(() => {
    const valid = { type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0123abcd' };
    const wrap = (event, extra) => Object.assign({ source: 'queue-cue-hook', version: 1, event }, extra);
    const fakes = [
      'just a string',
      null,
      wrap(valid, { version: 2 }),
      wrap(valid, { source: 'someone-else' }),
      wrap(Object.assign({}, valid, { type: 'agent_left' })),
      wrap(Object.assign({}, valid, { platform: 'zendesk' })),
      wrap(Object.assign({}, valid, { messageKey: 'agent_message:Hello there' })),
      wrap(Object.assign({}, valid, { messageKey: 'agent_joined:0123abcd' })),
      wrap(Object.assign({}, valid, { messageKey: 'x'.repeat(100) })),
      wrap(null)
    ];
    for (const message of fakes) window.postMessage(message, '*');
    // A valid-looking message from a frame inside the page, not from the page itself.
    const frame = document.createElement('iframe');
    frame.srcdoc = '<script>parent.postMessage({ source: "queue-cue-hook", version: 1, event: ' +
      JSON.stringify(valid) + ' }, "*");<\/script>';
    document.body.appendChild(frame);
  });
  await chat.waitForTimeout(1000);
  expect(await readEvents(serviceWorker)).toEqual([]);

  // Known limit: the marker isn't a secret, so a watched page can post a well-formed event about
  // itself. It still carries no message text, and step 3 will treat it like any other event.
  await chat.evaluate(() => window.postMessage({ source: 'queue-cue-hook', version: 1,
    event: { type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0123abcd' } }, '*'));
  expect((await eventsAfter(serviceWorker, 1))[0].messageKey).toBe('agent_message:0123abcd');
});

test('the service worker refuses events that come from the wrong place or are badly formed', async ({ serviceWorker }) => {
  const results = await inServiceWorker(serviceWorker, () => {
    const message = { queueCue: 'event', type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0123abcd', page: { visible: false, focused: false } };
    const sender = { id: chrome.runtime.id, tab: { id: 7, windowId: 1 }, frameId: 0, url: 'https://shop.example/help' };
    const variants = {
      good: [message, sender],
      childFrame: [message, Object.assign({}, sender, { frameId: 2 })],
      noTab: [message, Object.assign({}, sender, { tab: undefined })],
      otherExtension: [message, Object.assign({}, sender, { id: 'abcdefghijklmnopabcdefghijklmnop' })],
      notAWebPage: [message, Object.assign({}, sender, { url: 'chrome://settings/' })],
      noPageState: [Object.assign({}, message, { page: undefined }), sender],
      pageStateNotBoolean: [Object.assign({}, message, { page: { visible: 'yes', focused: 1 } }), sender],
      wrongMarker: [Object.assign({}, message, { queueCue: 'popup' }), sender]
    };
    const out = {};
    for (const [name, [m, s]] of Object.entries(variants)) out[name] = QueueCue.alerts.parse(m, s);
    return out;
  });
  expect(results.good).toEqual({ type: 'agent_message', platform: 'tawk', messageKey: 'agent_message:0123abcd',
    pattern: 'https://shop.example/*', site: 'shop.example', tabId: 7, windowId: 1, page: { visible: false, focused: false } });
  for (const name of ['childFrame', 'noTab', 'otherExtension', 'notAWebPage', 'noPageState', 'pageStateNotBoolean', 'wrongMarker']) {
    expect(results[name], name).toBeNull();
  }
});

test('a page still open after "Stop watching" is ignored until it\'s refreshed', async ({ context, serviceWorker }) => {
  await watchFakeChat(serviceWorker);
  const chat = await openChat(context);
  await inServiceWorker(serviceWorker, (site) => QueueCue.sites.unwatch(site), SITE);

  await fake(chat, 'visitorMessage', 'Hello');
  await fake(chat, 'agentMessage', 'Reply');
  await settle(chat);
  expect(await readEvents(serviceWorker)).toEqual([]);
});
