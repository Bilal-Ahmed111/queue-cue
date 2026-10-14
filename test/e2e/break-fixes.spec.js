// Reviewer's second-round "try to break it" tests, aimed at the Phase 2 fixes:
// the fake chat telling other tabs first, the server's 400 reply, the shared port and the log's own timestamp.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { plainTest: plain, expect } = require('./fixtures');
const { test: withExtension, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL: FAKE_CHAT, FAKE_CHAT_PORT } = require('../fake-chat-config');

const ROOT = path.resolve(__dirname, '..', '..');

// Records every callback, like a site (or our hook) would before the widget loads.
// Callbacks named in window.__qcThrow (set by the test) throw after recording.
function recordCallbacks(throwing) {
  const names = [
    'onBeforeLoad', 'onLoad', 'onStatusChange', 'onChatStarted', 'onChatEnded',
    'onChatMessageVisitor', 'onChatMessageAgent', 'onAgentJoinChat'
  ];
  window.__calls = [];
  window.Tawk_API = window.Tawk_API || {};
  names.forEach((name) => {
    window.Tawk_API[name] = function (...args) {
      window.__calls.push({ name, args });
      if (throwing.includes(name)) throw new Error('site handler bug in ' + name);
    };
  });
}

async function openChat(page, throwing = []) {
  await page.addInitScript(recordCallbacks, throwing);
  await page.goto(FAKE_CHAT);
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'onLoad'));
}

const named = (page, n) => page.evaluate((x) => window.__calls.filter((c) => c.name === x), n);
const count = async (page, n) => (await named(page, n)).length;

plain.describe('fake chat: a throwing site handler only affects its own tab', () => {
  plain('a handler that throws in a receiving tab does not stop a third tab hearing the agent', async ({ context }) => {
    const sender = await context.newPage();
    const broken = await context.newPage();
    const healthy = await context.newPage();
    await openChat(sender);
    await openChat(broken, ['onChatMessageAgent', 'onAgentJoinChat']);
    await openChat(healthy);

    await sender.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
    await sender.evaluate(() => window.FakeTawk.agentJoin());
    await sender.evaluate(() => window.FakeTawk.agentMessage('Reply 1'));
    await sender.evaluate(() => window.FakeTawk.agentMessage('Reply 2'));

    for (const p of [sender, broken, healthy]) {
      await expect.poll(() => count(p, 'onAgentJoinChat')).toBe(1);
      await expect.poll(() => count(p, 'onChatMessageAgent')).toBe(2);
    }
  });

  // The real widget tells the other tabs that a chat started, but not what the visitor wrote
  // (notes/research/tawk.md, section 8.3), and the fake now does the same.
  plain('first visitor message: a throwing handler in the sending tab still lets other tabs hear that the chat started', async ({ context }) => {
    const sender = await context.newPage();
    const other = await context.newPage();
    await openChat(sender, ['onChatMessageVisitor']);
    await openChat(other);

    const error = await sender.evaluate(() => {
      try { window.FakeTawk.visitorMessage('Hello'); return null; } catch (e) { return e.message; }
    });
    expect(error).toMatch(/site handler bug/);

    await expect.poll(() => count(other, 'onChatStarted')).toBe(1);
    expect(await count(other, 'onChatMessageVisitor')).toBe(0);
    const [started] = await named(other, 'onChatStarted');
    expect(typeof started.args[0].chatId).toBe('string');

    // The chat was saved before anything fired, so it survives the bug: a reload brings it back.
    await sender.reload();
    await sender.waitForFunction(() => window.__calls.some((c) => c.name === 'onLoad'));
    const [restarted] = await named(sender, 'onChatStarted');
    expect(restarted.args).toEqual(started.args);
    await expect(sender.locator('#fake-tawk-widget')).toContainText('You: Hello');
  });

  plain('a throwing onChatEnded in the sending tab still ends the chat in the other tab', async ({ context }) => {
    const sender = await context.newPage();
    const other = await context.newPage();
    await openChat(sender, ['onChatEnded']);
    await openChat(other);
    await sender.evaluate(() => window.FakeTawk.visitorMessage('Hello'));
    await sender.evaluate(() => window.FakeTawk.agentMessage('Hi'));
    await sender.evaluate(() => { try { window.FakeTawk.endChat(); } catch (e) { /* site bug */ } });

    await expect.poll(() => count(other, 'onChatEnded')).toBe(1);
    expect(await other.evaluate(() => window.Tawk_API.isVisitorEngaged())).toBe(false);
  });

  plain('the sending tab hears its own events once, never echoed back by the broadcast', async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await openChat(a);
    await openChat(b);
    await a.evaluate(() => {
      window.FakeTawk.visitorMessage('Hello');
      window.FakeTawk.agentJoin();
      window.FakeTawk.agentMessage('Hi');
      window.FakeTawk.endChat();
    });
    await expect.poll(() => count(b, 'onChatEnded')).toBe(1);
    await a.waitForTimeout(200);
    for (const n of ['onChatMessageVisitor', 'onChatStarted', 'onAgentJoinChat', 'onChatMessageAgent', 'onChatEnded']) {
      expect(await count(a, n), n).toBe(1);
      // The visitor's message stays in the tab it was typed in (real widget, section 8.3).
      expect(await count(b, n), n).toBe(n === 'onChatMessageVisitor' ? 0 : 1);
    }
  });
});

plain.describe('test server: odd requests', () => {
  const PORT = 4197;
  let server;

  // Sends the request line exactly as written, so nothing tidies the address first.
  function rawRequest(target) {
    return new Promise((resolve) => {
      const socket = net.connect(PORT, '127.0.0.1', () => {
        socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      });
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => resolve({ status: Number((data.match(/^HTTP\/1\.1 (\d{3})/) || [])[1] || 0), data }));
      socket.on('error', (error) => resolve({ status: 0, data: '', error: error.code }));
      socket.setTimeout(3000, () => { socket.destroy(); resolve({ status: 0, data: '', error: 'timeout' }); });
    });
  }

  plain.beforeAll(async () => {
    server = spawn(process.execPath, [path.join(ROOT, 'test', 'serve.js')], {
      env: { ...process.env, FAKE_CHAT_PORT: String(PORT) },
      stdio: 'pipe'
    });
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (d) => { if (String(d).includes('Fake chat server')) resolve(); });
      server.on('exit', (code) => reject(new Error('serve.js exited early with code ' + code)));
    });
  });

  plain.afterAll(() => {
    if (server && server.exitCode === null) server.kill();
  });

  plain('malformed and unusual addresses never crash it or leak files outside test/fake-chat', async () => {
    const targets = [
      'http://[',                       // absolute address that is not a valid URL
      'http://a:b',                     // bad port
      'http://x/../../package.json',    // absolute address trying to climb out
      '/%c0%ae%c0%ae/package.json',     // overlong encoding of ".."
      '/..%00/package.json',            // null byte mid-climb
      '/%ff',                           // invalid UTF-8
      '/%E0%A4%A',                      // cut-off encoding
      '/CON', '/NUL', '/aux.js',        // Windows device names
      '*'
    ];
    for (const target of targets) {
      const res = await rawRequest(target);
      expect(res.error, `${target} gave a network error`).toBeUndefined();
      expect([400, 403, 404], `${target} gave ${res.status}`).toContain(res.status);
      expect(res.data).not.toContain('queue-cue');
    }
    expect((await rawRequest('/')).status, 'server died').toBe(200);
  });

  plain('fifty malformed requests at once, then it still serves the fake chat', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => rawRequest(i % 2 ? '/%' : '/a%00b')));
    expect(results.map((r) => r.status)).toEqual(Array(50).fill(400));
    const res = await rawRequest('/fake-tawk.js');
    expect(res.status).toBe(200);
    expect(res.data).toContain('Fake Tawk.to embed script');
  });
});

plain.describe('one shared fake chat address', () => {
  plain('no test file, the server or the Playwright config still uses the old port 4173 or a hard-coded fake chat port', () => {
    const files = [path.join(ROOT, 'playwright.config.js'), path.join(ROOT, 'test', 'serve.js')];
    for (const dir of [path.join(ROOT, 'test', 'e2e'), path.join(ROOT, 'test', 'fake-chat')]) {
      for (const name of fs.readdirSync(dir)) if (/\.(js|html)$/.test(name)) files.push(path.join(dir, name));
    }
    for (const file of files) {
      if (file === __filename) continue; // this file names the old port in its own test title
      const text = fs.readFileSync(file, 'utf8');
      expect(text, `${file} mentions 4173`).not.toMatch(/\b4173\b/);
      expect(text, `${file} hard-codes ${FAKE_CHAT_PORT}`).not.toContain(String(FAKE_CHAT_PORT));
    }
  });

  plain('Playwright serves and browses the same address the tests use', () => {
    const config = require(path.join(ROOT, 'playwright.config.js'));
    expect(config.webServer.url).toBe(FAKE_CHAT);
    expect(config.use.baseURL).toBe(FAKE_CHAT);
    expect(config.webServer.command).toBe('node test/serve.js');
  });
});

withExtension.describe('debug log timestamps', () => {
  withExtension('an entry that brings its own "at" time gets the log\'s time instead', async ({ serviceWorker }) => {
    const result = await inServiceWorker(serviceWorker, async () => {
      await QueueCue.debugLog.clear();
      const before = Date.now();
      await QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'a', at: 0 });
      await QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'b', at: 9e15 });
      await QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'c', at: 'not a time' });
      return { before, after: Date.now(), log: await QueueCue.debugLog.read() };
    });
    expect(result.log.map((e) => e.site)).toEqual(['a', 'b', 'c']);
    for (const entry of result.log) {
      expect(typeof entry.at).toBe('number');
      expect(entry.at).toBeGreaterThanOrEqual(result.before);
      expect(entry.at).toBeLessThanOrEqual(result.after);
    }
  });

  withExtension('add() does not change the caller\'s object', async ({ serviceWorker }) => {
    const entry = await inServiceWorker(serviceWorker, async () => {
      const mine = { type: 'agent_joined', platform: 'tawk', site: 'x' };
      await QueueCue.debugLog.add(mine);
      return mine;
    });
    expect(entry).toEqual({ type: 'agent_joined', platform: 'tawk', site: 'x' });
  });
});
