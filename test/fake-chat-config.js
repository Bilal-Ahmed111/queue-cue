// Where the test server serves the fake chat. Shared by test/serve.js, playwright.config.js and the tests.
// An unusual port, so the tests never quietly talk to some other local dev server (Vite uses 4173).
const FAKE_CHAT_PORT = 47813;

module.exports = {
  FAKE_CHAT_PORT,
  FAKE_CHAT_URL: `http://127.0.0.1:${FAKE_CHAT_PORT}/`
};
