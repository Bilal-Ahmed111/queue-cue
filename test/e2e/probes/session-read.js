// Test-only probe, never part of the real extension. Registered by a reviewer test as an ISOLATED-world
// content script. It tries to read the dev-mode alert log from chrome.storage.session and writes what
// happened onto the page's <html> element, where the test can see it. Content scripts should NOT be
// able to read session storage (Chrome's default access level is "trusted contexts only").
(async function () {
  var result;
  try {
    var stored = await chrome.storage.session.get('debugLog');
    result = 'read:' + JSON.stringify(stored);
  } catch (error) {
    result = 'blocked:' + String(error && error.message);
  }
  document.documentElement.setAttribute('data-qc-session-probe', result);
})();
