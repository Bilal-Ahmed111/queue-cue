// Phase 3, step 1: the popup's "Watch chats on this site" and "Stop watching this site" buttons, and
// the service worker's list of watched sites (src/background/sites.js). Fake chat page only.
// Tests can't click Chrome's "Allow access?" prompt, so the test copy has the fake chat's address
// granted up front (global-setup.js): chrome.permissions.request then resolves true at once.
// The real prompt, and the popup reading the real tab's address through activeTab, are manual checks.
const { test, expect, inServiceWorker } = require('./fixtures');
const { FAKE_CHAT_URL } = require('../fake-chat-config');

const SITE = 'http://127.0.0.1/*';

// Opens the popup page in a tab. A real popup reads the tab it was opened on (activeTab); opened as
// a tab it would read itself, so chrome.tabs.query is pointed at the page under test instead.
async function openPopup(context, extensionId, pageUrl) {
  const popup = await context.newPage();
  await popup.addInitScript((url) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info) => (info && info.active ? Promise.resolve([{ id: -1, active: true, url }]) : query(info));
  }, pageUrl);
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  return popup;
}

function siteState(serviceWorker) {
  return inServiceWorker(serviceWorker, async () => ({
    list: await QueueCue.sites.readList(),
    scripts: (await chrome.scripting.getRegisteredContentScripts())
      .map((s) => ({ id: s.id, matches: s.matches, js: s.js, world: s.world, runAt: s.runAt, allFrames: s.allFrames }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }));
}

const REGISTERED = [
  { id: `qc-main|${SITE}`, matches: [SITE], js: ['src/content/hook.js', 'src/detectors/tawk.js'], world: 'MAIN', runAt: 'document_start', allFrames: false },
  { id: `qc-relay|${SITE}`, matches: [SITE], js: ['src/content/relay.js'], world: 'ISOLATED', runAt: 'document_start', allFrames: false }
];

function hookLoaded(page) {
  return page.evaluate(() => Object.prototype.hasOwnProperty.call(window, '__queueCue'));
}

test('the popup names the site and offers to watch it', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId, FAKE_CHAT_URL);
  await expect(popup.locator('#status')).toHaveText('Not watching this site.');
  await expect(popup.locator('#site')).toHaveText('127.0.0.1');
  await expect(popup.getByRole('button', { name: 'Watch chats on this site' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Stop watching this site' })).toBeHidden();
});

test('Watch registers the hook and relay for the site, and the hook runs from the next page load', async ({ context, extensionId, serviceWorker }) => {
  const chat = await context.newPage();
  await chat.goto(FAKE_CHAT_URL);
  expect(await hookLoaded(chat)).toBe(false);

  const popup = await openPopup(context, extensionId, chat.url());
  await popup.getByRole('button', { name: 'Watch chats on this site' }).click();
  await expect(popup.locator('#status')).toHaveText('Watching chats on this site.');
  await expect(popup.locator('#note')).toHaveText('Now refresh this page. Queue Cue starts watching from the next page load.');
  await expect(popup.getByRole('button', { name: 'Stop watching this site' })).toBeVisible();

  expect(await siteState(serviceWorker)).toEqual({ list: [SITE], scripts: REGISTERED });

  // Registration doesn't reach pages that are already open: that's why the popup says to refresh.
  expect(await hookLoaded(chat)).toBe(false);
  await chat.reload();
  expect(await hookLoaded(chat)).toBe(true);

  // The whole site is watched, not just the page the popup was opened on.
  const other = await context.newPage();
  await other.goto(new URL('/no-vendor.html', FAKE_CHAT_URL).href);
  expect(await hookLoaded(other)).toBe(true);

  // Reopening the popup shows the site as watched.
  const again = await openPopup(context, extensionId, chat.url());
  await expect(again.locator('#status')).toHaveText('Watching chats on this site.');
});

test('Stop watching removes the scripts and the site, and the next page load has no hook', async ({ context, extensionId, serviceWorker }) => {
  const chat = await context.newPage();
  await chat.goto(FAKE_CHAT_URL);
  const popup = await openPopup(context, extensionId, chat.url());
  await popup.getByRole('button', { name: 'Watch chats on this site' }).click();
  await expect(popup.locator('#status')).toHaveText('Watching chats on this site.');
  await chat.reload();
  expect(await hookLoaded(chat)).toBe(true);

  await popup.getByRole('button', { name: 'Stop watching this site' }).click();
  await expect(popup.locator('#status')).toHaveText('Not watching this site.');
  await expect(popup.locator('#note')).toHaveText('Refresh this page to switch Queue Cue off here.');
  expect(await siteState(serviceWorker)).toEqual({ list: [], scripts: [] });

  await chat.reload();
  expect(await hookLoaded(chat)).toBe(false);
});

test('pages that are not websites get a plain message and no buttons', async ({ context, extensionId }) => {
  for (const url of ['chrome://extensions/', 'file:///C:/chat.html', undefined]) {
    const popup = await openPopup(context, extensionId, url);
    await expect(popup.locator('#status')).toHaveText('Queue Cue only works on websites (addresses starting with http or https).');
    await expect(popup.getByRole('button')).toHaveCount(0); // counts visible buttons only
    await expect(popup.getByRole('button', { name: 'Watch chats on this site' })).toBeHidden();
    await expect(popup.getByRole('button', { name: 'Stop watching this site' })).toBeHidden();
    await popup.close();
  }
});

test('opening the popup repairs missing scripts, drops sites without access and removes leftovers', async ({ context, extensionId, serviceWorker }) => {
  await inServiceWorker(serviceWorker, async (site) => {
    await QueueCue.sites.watch(site);
    // Behind our back: the watched site's scripts vanish, a site without access is on the list,
    // and a registration for a site that isn't on the list is left over.
    await chrome.scripting.unregisterContentScripts();
    await chrome.storage.local.set({ watchedSites: [site, 'https://not-granted.example/*'] });
    await chrome.scripting.registerContentScripts([{ id: 'qc-main|https://leftover.example/*', matches: ['https://leftover.example/*'], js: ['src/content/hook.js'], world: 'MAIN', runAt: 'document_start' }]);
  }, SITE);

  const popup = await openPopup(context, extensionId, FAKE_CHAT_URL);
  await expect(popup.locator('#status')).toHaveText('Watching chats on this site.');
  expect(await siteState(serviceWorker)).toEqual({ list: [SITE], scripts: REGISTERED });
});

test('a grant reported by Chrome starts watching, and removed access stops it', async ({ serviceWorker }) => {
  // These are what chrome.permissions.onAdded and onRemoved call; tests can't make Chrome fire them.
  await inServiceWorker(serviceWorker, (site) => QueueCue.sites.onPermissionsAdded({ origins: [site, 'https://*/*', 'http://*/*'] }), SITE);
  expect(await siteState(serviceWorker)).toEqual({ list: [SITE], scripts: REGISTERED });

  await inServiceWorker(serviceWorker, (site) => QueueCue.sites.onPermissionsRemoved({ origins: [site] }), SITE);
  expect(await siteState(serviceWorker)).toEqual({ list: [], scripts: [] });
});

test('the popup and Chrome reporting the same grant at once still give one entry', async ({ serviceWorker }) => {
  await inServiceWorker(serviceWorker, (site) => Promise.all([
    QueueCue.sites.watch(site),
    QueueCue.sites.onPermissionsAdded({ origins: [site] }),
    QueueCue.sites.watch(site)
  ]), SITE);
  expect(await siteState(serviceWorker)).toEqual({ list: [SITE], scripts: REGISTERED });
});

test('a site Chrome has not granted is never watched', async ({ serviceWorker }) => {
  const result = await inServiceWorker(serviceWorker, () => QueueCue.sites.watch('https://not-granted.example/*'));
  expect(result).toBe(false);
  expect(await siteState(serviceWorker)).toEqual({ list: [], scripts: [] });
});

test('page addresses become whole-site patterns; anything else is refused', async ({ serviceWorker }) => {
  const result = await inServiceWorker(serviceWorker, () => {
    const urls = ['https://www.example.com:8443/chat?x=1#y', 'http://127.0.0.1:9000/', 'https://[::1]:8080/a',
      'chrome://extensions/', 'file:///C:/chat.html', 'about:blank', 'not a url', '', null, undefined];
    const patterns = ['https://a.example/*', 'https://*/*', 'https://a.example/chat/*', '<all_urls>', 'https://a.example/', 'ftp://a.example/*', 42];
    return {
      patternFor: urls.map((u) => QueueCue.sites.patternFor(u)),
      isSitePattern: patterns.map((p) => QueueCue.sites.isSitePattern(p))
    };
  });
  expect(result.patternFor).toEqual(['https://www.example.com/*', 'http://127.0.0.1/*', 'https://[::1]/*',
    null, null, null, null, null, null, null]);
  expect(result.isSitePattern).toEqual([true, false, false, false, false, false, false]);
});
