// Smoke test (Phase 3, step 0): how Playwright's Chromium reports "tab visible" and "tab focused".
// Observed 2026-10-13 (Chromium 156): inside the page, EVERY tab says visibilityState "visible" and
// hasFocus() true, even tabs in the background, so tests can't use the page's own view of focus.
// The browser's view is realistic: chrome.tabs "active" follows page.bringToFront().
// So the alert tests check the quiet rule through the browser's view; the page's view is a manual check.
// If this test starts failing, Playwright's behaviour changed: revisit the alert tests.
const { test, expect, inServiceWorker } = require('./fixtures');

function pageState(page) {
  return page.evaluate(() => ({ visibility: document.visibilityState, hasFocus: document.hasFocus() }));
}

function activeTabIds(serviceWorker) {
  return inServiceWorker(serviceWorker, async () => {
    const win = await chrome.windows.getLastFocused();
    const tabs = await chrome.tabs.query({ windowId: win.id, active: true });
    return { focused: win.focused, active: tabs.map(t => t.id) };
  });
}

function tabIdOf(serviceWorker, url) {
  return inServiceWorker(serviceWorker, async (u) => {
    const tabs = await chrome.tabs.query({});
    // No "tabs" permission: url is only readable for granted hosts (the fake chat's address is granted in the test copy).
    return tabs.filter(t => t.url === u).map(t => t.id);
  }, url);
}

test('pages always claim focus under Playwright, but chrome.tabs knows which tab is in front', async ({ context, serviceWorker }) => {
  const first = await context.newPage();
  await first.goto('/');
  const second = await context.newPage();
  await second.goto('/no-vendor.html');

  const [firstId] = await tabIdOf(serviceWorker, first.url());
  const [secondId] = await tabIdOf(serviceWorker, second.url());
  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();

  await first.bringToFront();
  expect(await pageState(first)).toEqual({ visibility: 'visible', hasFocus: true });
  expect(await pageState(second)).toEqual({ visibility: 'visible', hasFocus: true });
  expect(await activeTabIds(serviceWorker)).toEqual({ focused: true, active: [firstId] });

  await second.bringToFront();
  expect(await pageState(first)).toEqual({ visibility: 'visible', hasFocus: true });
  expect(await activeTabIds(serviceWorker)).toEqual({ focused: true, active: [secondId] });
});
