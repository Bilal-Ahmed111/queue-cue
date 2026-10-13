// Shared test setup: launches Playwright's bundled Chromium with the extension loaded.
// By default it loads the test copy (test/.build/extension). A test file can switch to the real
// extension folder with: test.use({ extensionVariant: 'real' })
const path = require('path');
const { test: base, expect, chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const EXTENSION_PATHS = {
  test: path.join(ROOT, 'test', '.build', 'extension'),
  real: ROOT
};

function isExtensionWorker(worker) {
  return worker.url().startsWith('chrome-extension://');
}

const test = base.extend({
  extensionVariant: ['test', { option: true }],

  context: async ({ extensionVariant }, use) => {
    const extensionPath = EXTENSION_PATHS[extensionVariant];
    let context;
    try {
      // '' = a fresh temporary browser profile for every test.
      context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: !process.env.HEADED,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`
        ]
      });
    } catch (error) {
      if (/spawn UNKNOWN/.test(String(error && error.message)) && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
        error.message = 'Run the tests with "npm test", not "npx playwright test": on this PC Chromium only ' +
          'starts from the copy inside the project (see test/playwright.env).\n' + error.message;
      }
      throw error;
    }
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let worker = context.serviceWorkers().find(isExtensionWorker);
    if (!worker) worker = await context.waitForEvent('serviceworker', { predicate: isExtensionWorker });
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split('/')[2]);
  }
});

// Runs code in the service worker. If the worker happens to restart mid-call, Playwright throws
// "Service worker restarted" (notes/research/playwright.md, section 8); try once more.
async function inServiceWorker(worker, fn, arg) {
  try {
    return await worker.evaluate(fn, arg);
  } catch (error) {
    if (!/Service worker restarted/i.test(String(error && error.message))) throw error;
    return worker.evaluate(fn, arg);
  }
}

module.exports = { test, expect, inServiceWorker };
