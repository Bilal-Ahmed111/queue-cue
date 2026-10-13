// Playwright settings. Run the tests with: npm test
// Set HEADED=1 to watch the browser while the tests run.
const { defineConfig } = require('@playwright/test');
const { FAKE_CHAT_URL } = require('./test/fake-chat-config');

module.exports = defineConfig({
  testDir: 'test/e2e',
  // One browser at a time: extension tests share focus and are easier to follow one by one.
  workers: 1,
  fullyParallel: false,
  globalSetup: require.resolve('./test/e2e/global-setup.js'),
  webServer: {
    command: 'node test/serve.js',
    url: FAKE_CHAT_URL,
    reuseExistingServer: true,
    timeout: 30000
  },
  use: {
    baseURL: FAKE_CHAT_URL
  }
});
