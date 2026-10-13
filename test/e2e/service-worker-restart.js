// Test helper: stops the extension's service worker on demand, the way Chrome does after about
// 30 seconds idle. Under Playwright the worker never goes idle by itself (an attached debugger keeps it
// alive: notes/research/playwright.md, section 10), so tests that check state survives a restart need this.
// Method: Chrome DevTools Protocol, ServiceWorker.stopWorker, sent from a session on an extension page.

// Opens an extension page and a DevTools session on it that reports service worker versions.
async function openWorkerControl(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const cdp = await context.newCDPSession(page);
  const latest = new Map(); // versionId -> latest ServiceWorkerVersion
  cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
    for (const version of event.versions) latest.set(version.versionId, version);
  });
  await cdp.send('ServiceWorker.enable');
  const ours = () => [...latest.values()].filter((v) => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`));
  return { page, cdp, ours };
}

async function waitFor(check, what, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// Stops the worker and waits until Chrome reports it stopped. Returns the running statuses seen.
async function stopServiceWorker(context, extensionId) {
  const control = await openWorkerControl(context, extensionId);
  const running = await waitFor(() => control.ours().find((v) => v.runningStatus === 'running'), 'the running extension worker');
  await control.cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId });
  await waitFor(() => control.ours().find((v) => v.versionId === running.versionId && v.runningStatus === 'stopped'), 'the worker to stop');
  await control.cdp.detach();
  await control.page.close();
}

module.exports = { stopServiceWorker };
