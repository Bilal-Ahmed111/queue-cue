// Checks that the extension loads in Playwright's Chromium, that the dev-mode alert log works,
// and settles open questions from notes/research/ (hook timing, service worker going idle).
const { test, expect, inServiceWorker } = require('./fixtures');

const FAKE_CHAT = 'http://127.0.0.1:4173/';

test.describe('test copy of the extension', () => {
  test('loads from the project folder (whose path has spaces) and starts its service worker', async ({ serviceWorker, extensionId }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const manifest = await inServiceWorker(serviceWorker, () => chrome.runtime.getManifest());
    expect(manifest.name).toBe('Queue Cue');
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
  });

  test('dev-mode alert log keeps every entry, even when two arrive at once', async ({ serviceWorker }) => {
    const log = await inServiceWorker(serviceWorker, async () => {
      await Promise.all([
        QueueCue.debugLog.add({ type: 'agent_joined', platform: 'tawk', site: 'a.example' }),
        QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'b.example' })
      ]);
      return QueueCue.debugLog.read();
    });
    expect(log.map((e) => e.site)).toEqual(['a.example', 'b.example']);
    expect(typeof log[0].at).toBe('number');

    const afterClear = await inServiceWorker(serviceWorker, async () => {
      await QueueCue.debugLog.clear();
      return QueueCue.debugLog.read();
    });
    expect(afterClear).toEqual([]);
  });

  test('a MAIN-world script registered for document_start runs before the page\'s own scripts', async ({ context, serviceWorker }) => {
    await inServiceWorker(serviceWorker, () => chrome.scripting.registerContentScripts([{
      id: 'hook-timing-probe',
      matches: ['http://127.0.0.1/*'],
      js: ['test-probes/hook-timing.js'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: false
    }]));

    const page = await context.newPage();
    await page.goto(FAKE_CHAT);
    // page.evaluate runs in the page's own world, so seeing the probe's result proves it ran in MAIN.
    const probe = await page.evaluate(() => window.__qcTimingProbe);
    expect(probe).toEqual({ scriptsInDocument: 0, tawkApiExisted: false, readyState: 'loading' });
  });

  // Finding (2026-10-13, Chromium 156): under Playwright the worker did NOT stop during 40 s idle
  // (the annotation records "false"), so this only shows that it still answers and the log is kept.
  // Phase 3 needs a way to force a stop before it can test recovery after a restart.
  test('service worker still answers after 40 seconds idle, and the log is kept', async ({ serviceWorker }) => {
    test.slow();
    await inServiceWorker(serviceWorker, async () => {
      self.__qcBeforeIdle = true;
      await QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'idle.example' });
    });

    // Chrome stops an idle service worker after about 30 seconds.
    await new Promise((resolve) => setTimeout(resolve, 40000));

    const after = await inServiceWorker(serviceWorker, async () => ({
      restarted: self.__qcBeforeIdle !== true,
      log: await QueueCue.debugLog.read()
    }));
    test.info().annotations.push({ type: 'service worker restarted while idle', description: String(after.restarted) });
    expect(after.log.map((e) => e.site)).toEqual(['idle.example']);
  });
});

test.describe('real extension folder', () => {
  test.use({ extensionVariant: 'real' });

  test('loads from the project root, the folder Bilal will load, with the debug log off', async ({ serviceWorker }) => {
    const result = await inServiceWorker(serviceWorker, async () => ({
      manifest: chrome.runtime.getManifest(),
      enabled: QueueCue.debugLog.enabled(),
      added: await QueueCue.debugLog.add({ type: 'agent_message', platform: 'tawk', site: 'x.example' }),
      log: await QueueCue.debugLog.read()
    }));
    expect(result.manifest.name).toBe('Queue Cue');
    expect(result.manifest.host_permissions).toBeUndefined();
    expect(result.enabled).toBe(false);
    expect(result.added).toBe(false);
    expect(result.log).toEqual([]);
  });
});
