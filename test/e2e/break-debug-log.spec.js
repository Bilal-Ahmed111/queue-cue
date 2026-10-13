// Reviewer's "try to break it" tests for the dev-mode alert log (src/background/debug-log.js).
// Runs against the test copy of the extension (log on) and the real project folder (log off).
const { test, expect, inServiceWorker } = require('./fixtures');

const { FAKE_CHAT_URL: FAKE_CHAT } = require('../fake-chat-config');

test.describe('debug log in the test copy', () => {
  test('600 alerts arriving at once: none lost or reordered, capped at the newest 500', async ({ serviceWorker }) => {
    const log = await inServiceWorker(serviceWorker, async () => {
      await QueueCue.debugLog.clear();
      const writes = [];
      for (let i = 0; i < 600; i += 1) {
        writes.push(QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 's' + i }));
      }
      const results = await Promise.all(writes);
      if (!results.every((r) => r === true)) throw new Error('some adds did not report success');
      return QueueCue.debugLog.read();
    });
    expect(log).toHaveLength(500);
    expect(log[0].site).toBe('s100');
    expect(log[499].site).toBe('s599');
    const sites = log.map((e) => Number(e.site.slice(1)));
    expect(sites).toEqual(Array.from({ length: 500 }, (_, i) => i + 100));
    // Timestamps never go backwards.
    for (let i = 1; i < log.length; i += 1) expect(log[i].at).toBeGreaterThanOrEqual(log[i - 1].at);
  });

  test('add, clear, add in the same moment keeps only the last entry', async ({ serviceWorker }) => {
    const log = await inServiceWorker(serviceWorker, async () => {
      const a = QueueCue.debugLog.add({ type: 'agent_joined', platform: 'tawk', site: 'before-clear' });
      const c = QueueCue.debugLog.clear();
      const b = QueueCue.debugLog.add({ type: 'agent_joined', platform: 'tawk', site: 'after-clear' });
      await Promise.all([a, b, c]);
      return QueueCue.debugLog.read();
    });
    expect(log.map((e) => e.site)).toEqual(['after-clear']);
  });

  test('a failed storage write does not block the writes after it', async ({ serviceWorker }) => {
    const result = await inServiceWorker(serviceWorker, async () => {
      await QueueCue.debugLog.clear();
      const area = chrome.storage.session;
      const realSet = area.set;
      let failNext = true;
      area.set = function (items) {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('simulated quota error'));
        }
        return realSet.call(area, items);
      };
      let firstError = null;
      try {
        const first = QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'lost' });
        const second = QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'kept' });
        try { await first; } catch (e) { firstError = e.message; }
        await second;
      } finally {
        area.set = realSet;
      }
      return { firstError, log: await QueueCue.debugLog.read() };
    });
    expect(result.firstError).toBe('simulated quota error');
    expect(result.log.map((e) => e.site)).toEqual(['kept']);
  });

  test('content scripts cannot read the debug log (it may hold chat details later)', async ({ context, serviceWorker }) => {
    await inServiceWorker(serviceWorker, async () => {
      await QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'secret.example' });
      await chrome.scripting.registerContentScripts([{
        id: 'session-read-probe',
        matches: ['http://127.0.0.1/*'],
        js: ['test-probes/session-read.js'],
        runAt: 'document_idle',
        persistAcrossSessions: false
      }]);
    });
    const page = await context.newPage();
    await page.goto(FAKE_CHAT + 'no-vendor.html');
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-qc-session-probe'))).not.toBeNull();
    const probe = await page.evaluate(() => document.documentElement.getAttribute('data-qc-session-probe'));
    expect(probe).toMatch(/^blocked:/);
    expect(probe).not.toContain('secret.example');
  });
});

test.describe('debug log in the real extension folder', () => {
  test.use({ extensionVariant: 'real' });

  test('many adds at once are all ignored and nothing at all is written to session storage', async ({ serviceWorker }) => {
    const result = await inServiceWorker(serviceWorker, async () => {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'x' + i })));
      return {
        config: QueueCue.config,
        results,
        everything: await chrome.storage.session.get(null),
        local: await chrome.storage.local.get(null)
      };
    });
    expect(result.config).toEqual({ debugLog: false });
    expect(result.results.every((r) => r === false)).toBe(true);
    expect(result.everything).toEqual({});
    expect(result.local).toEqual({});
  });

  test('the real extension has no test probes and no pre-granted site access', async ({ serviceWorker }) => {
    const result = await inServiceWorker(serviceWorker, async () => {
      let probeFound;
      try {
        const res = await fetch(chrome.runtime.getURL('test-probes/hook-timing.js'));
        probeFound = res.ok;
      } catch (e) {
        probeFound = false;
      }
      return {
        probeFound,
        granted: await chrome.permissions.getAll()
      };
    });
    expect(result.probeFound).toBe(false);
    expect(result.granted.origins).toEqual([]);
  });
});
