// Checks the test helper that stops the service worker (service-worker-restart.js) really does:
// after the stop, the worker's in-memory variables are gone but chrome.storage is kept.
// Settles notes/research/playwright.md, section 10.7. Playwright's Chromium only.
const { test, expect, inServiceWorker } = require('./fixtures');
const { stopServiceWorker } = require('./service-worker-restart');

test('the helper stops the service worker: memory is wiped, storage is kept, and it wakes on the next event', async ({ context, serviceWorker, extensionId }) => {
  let newWorkers = 0;
  context.on('serviceworker', () => { newWorkers += 1; });
  await inServiceWorker(serviceWorker, async () => {
    self.memoryMarker = 'before the stop';
    await chrome.storage.session.set({ sessionMarker: 1 });
    await chrome.storage.local.set({ localMarker: 2 });
  });

  await stopServiceWorker(context, extensionId);

  // A message from an extension page wakes it, as any real event would.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const after = await inServiceWorker(serviceWorker, async () => ({
    memory: self.memoryMarker,
    session: (await chrome.storage.session.get('sessionMarker')).sessionMarker,
    local: (await chrome.storage.local.get('localMarker')).localMarker,
    // The start-up code ran again in the new worker.
    namespaceLoaded: typeof QueueCue === 'object' && typeof QueueCue.alerts === 'object'
  }));
  expect(after).toEqual({ session: 1, local: 2, namespaceLoaded: true });
  expect(newWorkers).toBe(0); // Playwright keeps the same Worker object
});
