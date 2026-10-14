// Reviewer "try to break it" tests, Phase 3: the host site must work exactly as it does without Queue Cue,
// however it writes its Tawk.to code. Fake chat only (test/fake-chat/break-site-patterns.html).
// Each test runs the same chat twice on the same page, first without Queue Cue watching, then with it,
// and compares what the site's own handlers saw.
const { test, expect, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL } = require('../fake-chat-config');

const SITE = 'http://127.0.0.1/*';
const pageUrl = (pattern) => new URL(`/break-site-patterns.html?pattern=${pattern}`, FAKE_CHAT_URL).href;

async function readEvents(serviceWorker) {
  const log = await inServiceWorker(serviceWorker, () => QueueCue.debugLog.read());
  return log.filter((entry) => entry.kind === 'event').map((entry) => entry.type);
}

// Plays one chat and returns what the site's own handlers recorded.
async function playChat(chat) {
  await chat.waitForFunction(() => window.Tawk_API && window.Tawk_API.getStatus && window.Tawk_API.getStatus() === 'online');
  return chat.evaluate(() => {
    const t = window.FakeTawk;
    t.visitorMessage('Hi');
    t.agentJoin();
    t.agentMessage('Reply');
    t.endChat();
    return window.siteCalls.slice();
  });
}

async function withAndWithout(context, serviceWorker, pattern) {
  const chat = await context.newPage();
  const errors = [];
  chat.on('pageerror', (error) => errors.push(error.message));
  await chat.goto(pageUrl(pattern));
  const without = await playChat(chat);
  await chat.evaluate(() => window.FakeTawk.reset());

  await inServiceWorker(serviceWorker, (site) => QueueCue.sites.watch(site), SITE);
  await chat.reload();
  const withQueueCue = await playChat(chat);
  await chat.waitForTimeout(500);
  return { without, withQueueCue, errors, events: await readEvents(serviceWorker) };
}

test('a site that only sets a handler "if there isn\'t one yet" still gets its handlers called', async ({ context, serviceWorker }) => {
  // Patterns like: Tawk_API.onLoad = Tawk_API.onLoad || mine;  if (!Tawk_API.onChatMessageAgent) ...
  const run = await withAndWithout(context, serviceWorker, 'default-if-missing');
  expect(run.without).toEqual([
    'load (|| default): null',
    'agent joined (typeof check): ' + JSON.stringify({ name: 'Test Agent', position: '', image: 'https://embed.tawk.to/_s/v4/assets/images/default-profile.svg', id: 'fakeagent00000000000001' }),
    'agent message (if missing): {"message":"Reply","attachments":[]}'
  ]);
  expect(run.withQueueCue).toEqual(run.without);
  expect(run.errors).toEqual([]);
});

test('a site that creates Tawk_API with Object.defineProperty is not broken', async ({ context, serviceWorker }) => {
  const run = await withAndWithout(context, serviceWorker, 'define-property');
  expect(run.without).toContain('agent message (defineProperty): {"message":"Reply","attachments":[]}');
  expect(run.withQueueCue).toEqual(run.without);
  expect(run.errors).toEqual([]);
  // Known gap, recorded rather than required: Queue Cue's watcher on window.Tawk_API is replaced, so it hears nothing here.
  test.info().annotations.push({ type: 'events heard with defineProperty', description: JSON.stringify(run.events) });
});

test('a site handler that can\'t be changed (non-configurable) is left alone and still called', async ({ context, serviceWorker }) => {
  const run = await withAndWithout(context, serviceWorker, 'locked-handler');
  expect(run.without).toContain('agent message (locked): {"message":"Reply","attachments":[]}');
  expect(run.withQueueCue).toEqual(run.without);
  expect(run.errors).toEqual([]);
  test.info().annotations.push({ type: 'events heard with a locked handler', description: JSON.stringify(run.events) });
});

test('a site that swaps in a whole new Tawk_API object before Tawk.to loads: same calls, and Queue Cue still hears the chat', async ({ context, serviceWorker }) => {
  const run = await withAndWithout(context, serviceWorker, 'replaced-object');
  expect(run.without).toEqual([
    'load (second object): null',
    'agent message (second object): {"message":"Reply","attachments":[]}'
  ]);
  expect(run.withQueueCue).toEqual(run.without);
  expect(run.errors).toEqual([]);
  expect(run.events).toEqual(['visitor_message', 'agent_joined', 'agent_message', 'chat_ended']);
});

test('a chat snippet added a second after the page loads (cookie-consent style) is still heard', async ({ context, serviceWorker }) => {
  const run = await withAndWithout(context, serviceWorker, 'loaded-late');
  expect(run.without).toEqual([
    'load (late snippet): null',
    'agent message (late snippet): {"message":"Reply","attachments":[]}'
  ]);
  expect(run.withQueueCue).toEqual(run.without);
  expect(run.errors).toEqual([]);
  expect(run.events).toEqual(['visitor_message', 'agent_joined', 'agent_message', 'chat_ended']);
});
