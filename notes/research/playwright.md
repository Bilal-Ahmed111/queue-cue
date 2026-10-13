# Playwright for testing the Queue Cue extension (research)

Researched 2026-10-12. Labels: OFFICIAL = playwright.dev / developer.chrome.com. UNOFFICIAL = forums, mailing lists, GitHub issues, my reasoning.
Note on method: pages were read through a summarising fetch tool, so code below is as reported by the tool, not copy-pasted by eye. Re-check against the live page if a snippet misbehaves.

Latest Playwright shown on release notes: 1.64, bundling Chromium 156.0.8078.4 (OFFICIAL, https://playwright.dev/docs/release-notes). Release date not shown. Pin the version in package.json after install.

## 0. Does branded Chrome still accept --load-extension?
- OFFICIAL (Playwright): "Google Chrome and Microsoft Edge removed the command-line flags needed to side-load extensions"; use the bundled Chromium. https://playwright.dev/docs/chrome-extensions
- UNOFFICIAL but from the Chrome team (Chromium Extensions Google Group, April 2025): "Starting in Chrome 137, we will remove the ability to load extensions via the --load-extension command-line flag in official Chrome branded builds." Still works in Chromium and Chrome for Testing. https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ
- CONFIRMED: Chrome 137+ branded. Not found on developer.chrome.com (search found nothing there). Edge: Playwright docs say the same, no version given.
- Playwright 1.57+ uses Chrome for Testing builds for its Chromium (OFFICIAL release notes), which is why the flag still works.

## 1. Install on Windows
OFFICIAL: https://playwright.dev/docs/intro , https://playwright.dev/docs/browsers
- Node needed: latest 22.x, 24.x or 26.x. Node 24 is fine. Windows 11 supported.
- Docs' scaffold: `npm init playwright@latest` (asks about browsers, TypeScript/JS; creates playwright.config.ts). We probably do not want the scaffold's example tests.
- Manual route (the intro page does NOT list these two lines; the browsers page gives the install form). Commands:
  - `npm init -y`
  - `npm i -D @playwright/test`
  - `npx playwright install chromium`  (browsers page shows this form with `webkit`; `chromium` is the same pattern)
- Headless shell vs full Chromium (OFFICIAL, browsers page): Playwright ships a regular Chromium for headed and a separate "chromium headless shell" for headless. `npx playwright install chromium` downloads both. Headless-shell-only: `--only-shell`; skip shell: `--no-shell`. We need the FULL Chromium (extensions), so use `--no-shell` only if saving space is wanted.
- No `--with-deps` needed on Windows (that is for Linux system packages).
- Browser cache on Windows: `%USERPROFILE%\AppData\Local\ms-playwright`. Override with PLAYWRIGHT_BROWSERS_PATH.
- Config file: `playwright.config.ts` (or .js). Minimal (OFFICIAL, https://playwright.dev/docs/test-configuration):
  ```ts
  import { defineConfig } from '@playwright/test';
  export default defineConfig({
    testDir: 'test/e2e',
    workers: 1,          // see section 8
    use: {},
  });
  ```
  Only `testDir` is really needed. Our fixture launches its own context, so `projects` / `devices` are not needed.

## 2. Loading an unpacked extension
OFFICIAL: https://playwright.dev/docs/chrome-extensions
- "Extensions only work in Chromium when launched with a persistent context." Custom args are "at your own risk".
- Must use `chromium.launchPersistentContext(userDataDir, { channel: 'chromium', args: [...] })`.
- Headless: the page says the `chromium` channel "allows to run extensions in headless mode" (that is Chromium's NEW headless mode). Headed is the alternative. The default old headless shell cannot load extensions (developer.chrome.com says old headless "does not support loading extensions": https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing). So: headless works only with `channel: 'chromium'`.
- Official example:
  ```js
  const { chromium } = require('playwright');
  const pathToExtension = require('path').join(__dirname, 'my-extension');
  const userDataDir = '/tmp/test-user-data-dir';
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`
    ]
  });
  let [serviceWorker] = browserContext.serviceWorkers();
  if (!serviceWorker)
    serviceWorker = await browserContext.waitForEvent('serviceworker');
  await browserContext.close();
  ```
- Official fixtures.ts (abbreviated by the fetch; args elided in the doc as shown):
  ```ts
  import { test as base, chromium, type BrowserContext } from '@playwright/test';
  export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
    context: async ({ }, use) => {
      const context = await chromium.launchPersistentContext('', {   // '' = temp profile
        channel: 'chromium',
        args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
      });
      await use(context);
      await context.close();
    },
    extensionId: async ({ context }, use) => {
      let [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
      await use(serviceWorker.url().split('/')[2]);
    },
  });
  ```
  Tests then `import { test, expect } from './fixtures'`.
- Playwright 1.55 dropped MV2 extension support; MV3 only (OFFICIAL release notes). Fine for us.
- Gotcha: the official "args" in the doc's fixture are elided by my fetch; the exact pair `--disable-extensions-except=<path>` + `--load-extension=<path>` is from the first example.

## 3. Service worker, extension ID, worker.evaluate
OFFICIAL: https://playwright.dev/docs/chrome-extensions , https://playwright.dev/docs/api/class-browsercontext , https://playwright.dev/docs/api/class-worker
- `context.serviceWorkers()` -> Worker[] ("All existing service workers in the context", Chromium only).
- `context.waitForEvent('serviceworker')` / event `'serviceworker'` -> Worker.
- Extension ID = `serviceWorker.url().split('/')[2]` (URL looks like `chrome-extension://<id>/background.js`).
- `worker.evaluate(pageFunction, arg?)` -> Promise<Serializable>; awaits a returned promise; non-serializable results become `undefined`. Also `evaluateHandle`, `url()`.
- Reading our dev-mode log (pattern; my adaptation, untested):
  ```ts
  const log = await sw.evaluate(async () => {
    const r = await chrome.storage.session.get('debugLog');   // key name is ours to choose
    return r.debugLog ?? [];
  });
  ```
  The worker's global scope is the extension's, so `chrome.*` is available. The Worker class docs say nothing about service workers; the chrome-extensions page confirms evaluate works on them.
- Caveat: `chrome.storage.session` is by default NOT readable from content scripts, but the service worker can read it. Fine here.
- UNCERTAIN: whether `serviceWorkers()` may include other extension/service workers (e.g. site service workers). Filter by `url().startsWith('chrome-extension://')` to be safe (my suggestion).

## 4. Extension pages
OFFICIAL example: `await page.goto(\`chrome-extension://${extensionId}/popup.html\`)`. Same for options (`/options.html` or whatever path we use in the manifest).
- Opened as a normal tab, so it is NOT the real toolbar popup. Consequences (my reasoning, unofficial): `chrome.tabs.query({active:true,currentWindow:true})` inside it returns the popup tab itself, not the chat tab. Design popup code so the target tab can be passed (e.g. a `?tabId=` query param, or query by URL) or tests will check the wrong tab. This is also a "pop-out/window" gotcha.
- Real toolbar popup cannot be opened by Playwright (no official API; unofficial).

## 5. Granting optional host permissions in tests
Facts:
- OFFICIAL: chrome.permissions.request must run inside a user gesture; returns Promise<boolean> (Chrome 96+); Chrome prompts if it adds new warnings. Docs say nothing on bypassing or on tests. https://developer.chrome.com/docs/extensions/reference/api/permissions
- OFFICIAL: `context.grantPermissions()` only covers web-platform permissions (geolocation, notifications, clipboard...). The page does not mention extension permissions. https://playwright.dev/docs/api/class-browsercontext . It will NOT grant optional_host_permissions (inferred from the list; test to be sure).
- UNOFFICIAL: Playwright feature request "respond to optional permission requests" was closed by a maintainer on 2024-09-23 as "out of scope", no workaround given. https://github.com/microsoft/playwright/issues/32755
- UNOFFICIAL: the prompt is browser UI, not a page dialog; `page.on('dialog')` does not see it (GitHub issue 38670 and general reports).
- I found NO documented switch, policy or API in Chromium that auto-accepts a chrome.permissions.request prompt. Not found does not mean it does not exist.

Options, each labelled:
A. Test-only manifest copy (UNOFFICIAL, my suggestion, no extension code change). A build/test setup script copies the extension to a temp folder and edits manifest.json so the site pattern(s) move from optional_host_permissions to host_permissions (granted at install). Tests load that copy. Pros: no test-only code in src/. Cons: the real request-then-register flow is not exercised; popup's chrome.permissions.request would resolve true immediately (already granted) - should still work. Needs to be flagged in the manual checklist: real prompt = Bilal only.
B. Stub in the page (UNOFFICIAL). In the extension popup tab opened by URL, `page.addInitScript` (or evaluate) replaces `chrome.permissions.request` with a function resolving true. Does NOT actually grant, so chrome.scripting.registerContentScripts would then fail without real host access -> only tests the popup's UI logic. No extension code change. Combine with A for the rest.
C. Test hook inside the extension (e.g. a dev-mode message "grant for tests" that registers scripts directly). Requires test-only code in the extension, and registerContentScripts still needs host permission, so it needs A anyway. Not recommended.
D. Click-through with real gesture (Playwright clicks are trusted input, so the gesture requirement is satisfied) but the browser prompt then appears and cannot be clicked by Playwright. Could possibly be driven by OS-level automation (UNVERIFIED, fragile). Not recommended.
E. Enterprise policy (ExtensionSettings) pre-granting host access: UNVERIFIED, nothing found. Unknown whether policy can grant optional host permissions on Windows without domain join. Not recommended without a test.
F. chrome.permissions.addHostAccessRequest (Chrome 133+) is a different, user-approval flow; not useful for automation.
Gotcha (OFFICIAL, permissions page): if an origin is both an optional permission and a content-script match, `permissions.contains()` returns false unless both are granted.
Quick test to settle the unknowns: launch the extension, open popup via URL, call `chrome.permissions.request({origins:['https://example.com/*']})` after a `page.click` on a button; observe whether it hangs, rejects, or resolves. Also test whether `context.grantPermissions(['geolocation'], {origin})` has any effect (expected: none).
Also: since the plan is A, confirm host_permissions match (e.g. `http://localhost/*` or `http://127.0.0.1/*`) for the local test page; non-https hosts need explicit patterns.

## 6. Observing chrome.notifications / OS notifications
- OFFICIAL: no built-in support found. Playwright docs list a 'notifications' string only for context.grantPermissions (web Notification API permission), which is a different thing from chrome.notifications. Nothing in the chrome-extensions page about notifications.
- Plan stands: rely on our own debug log in chrome.storage.session. Alternative (UNOFFICIAL, my reasoning): in the service worker, wrap chrome.notifications.create to record calls; but this needs the wrap to be installed before the call and is lost on worker restart. Using the extension's own log is more robust.
- A Playwright-only trick not needed: `chrome.notifications.getAll()` inside `sw.evaluate` can list currently-existing notification IDs (chrome API, OFFICIAL on developer.chrome.com notifications page, not re-fetched here). Unverified in headless; test it if wanted.

## 7. Serving a local test page
OFFICIAL: https://playwright.dev/docs/test-webserver
- Config:
  ```ts
  webServer: {
    command: 'node test/serve.js',      // our own tiny static server, or similar
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,                     // default 60000
    stdout: 'pipe',
  },
  ```
  Fields: command, url (port is deprecated), cwd (default: config file dir), env, reuseExistingServer, timeout (default 60 s), stdout (default 'ignore'), stderr (default 'pipe'), gracefulShutdown (ignored on Windows), name, wait.
- Alternative with no server (OFFICIAL API, https://playwright.dev/docs/network): `page.route('https://fake-chat.test/**', route => route.fulfill({ body: html, contentType: 'text/html' }))` serves any URL. Useful: gives a fake https hostname that matches an https host permission. UNVERIFIED: whether content scripts register/inject on routed pages in a persistent context with the extension. NOTE: routes on the context (`context.route`) are safer than page.route. Test it.
- Windows gotchas (all UNOFFICIAL / my reasoning, untested):
  - Folder "C:\Users\Bilal\Documents\Live Chat Notifier" has spaces. Pass the extension path via `path.resolve(...)` in the args array; Playwright launches Chromium by spawn with an args array (no shell), so spaces should be fine, but confirm with a smoke test. Do not put it in a shell string.
  - `webServer.command` runs through a shell; any path with spaces in it must be quoted (`node "test/serve.js"` is fine since it is relative and cwd is the config dir; avoid absolute paths in the command).
  - If package.json has `"type": "module"`, `__dirname` is undefined in config/tests; use `import.meta.dirname` (Node 24) or `path.dirname(fileURLToPath(import.meta.url))`. In CommonJS `__dirname` works (as in the official example).
  - Use `127.0.0.1` rather than `localhost` in url to avoid IPv6 (::1) vs IPv4 mismatch (unofficial, commonly reported).
  - Use backslash-safe paths: build with `path.join`, never string concatenation with '/'.
  - Playwright's own repo has no guidance on spaces; test/fake-chat/ is under the spaced path, so the smoke test above matters.
- `userDataDir: ''` gives a temp profile (official fixture), avoiding paths altogether.

## 8. Pitfalls for MV3 + Playwright
- Service worker idle suspension (OFFICIAL, chrome-extensions page, "Service worker idle suspension (MV3)"): ~30 s inactivity suspends it; Playwright keeps the SAME Worker object, no new 'serviceworker' event fires; new `evaluate()` calls made during restart wait; an `evaluate()` in flight at the moment of suspension throws "Service worker restarted". So: never wait for a second 'serviceworker' event; retry reads that throw that error.
  - Official snippet: `const sw = await context.waitForEvent('serviceworker'); ... await sw.evaluate(() => sendMessage({type:'ping'})); // just works`
  - Note: this behaviour is stated by the doc; I could not confirm it by experiment. A summariser flagged it as unfamiliar, so run the test below.
  - Test to settle it: start the fixture, wait ~45 s idle (or use chrome://serviceworker-internals / DevTools stop), then run `sw.evaluate(() => 1)`; check it resolves with the same Worker object.
  - Also: keep the debug log in chrome.storage (as the project rules say), not a global; a restarted worker resets globals.
  - UPDATE 2026-10-13: our own run showed no idle stop in 40 s (section 9), and section 10 below explains the likely reason and gives forced-stop methods.
- Race when getting the worker (my reasoning, UNOFFICIAL, partly corroborated by the doc's own check-then-wait pattern): the official pattern `serviceWorkers()` then `waitForEvent` has a theoretical gap if the worker is created between the two calls. Safer: register `const p = context.waitForEvent('serviceworker')` BEFORE launching/loading, or after launch check list again. Also the SW can start later than launch; wait for it before opening pages that expect the extension.
- Another race: content scripts registered by registerContentScripts apply to pages loaded AFTER registration; reload the page in tests (matches the project's "refresh the chat page" rule).
- Parallel runs (UNOFFICIAL, reasoning; docs say workers are separate OS processes that each start their own browser: https://playwright.dev/docs/test-parallel): every launchPersistentContext must have its own user data directory (`''` gives a fresh temp dir) and the extension ID will be the same across them (unpacked ID derives from path), fine as profiles are separate. Real cost is CPU/RAM and focus/visibility: tests about "tab visible and focused" may behave differently when several headed windows compete. Recommended: `workers: 1` and `fullyParallel: false` for extension tests (OFFICIAL way: `workers: 1` or `--workers=1`).
- Focus/visibility (UNOFFICIAL, reasoning): our rule "stay quiet only when the chat tab is visible AND focused" depends on document.visibilityState and focus. In headless, window focus semantics may differ; tests for this need `page.bringToFront()` and a second page for the 'hidden' case. Verify by logging `document.visibilityState` and `document.hasFocus()` in a smoke test.
- Chromium old headless cannot load extensions; do not set `headless` to use the headless shell. Use `channel: 'chromium'` (works headless or headed).
- Playwright docs warn custom args can break Playwright. Keep args minimal.
- A closed context leaves the temp profile; harmless.
- chrome.power and chrome.notifications calls under test run for real in the browser but have no visible effect we can observe; log them.

## Open questions / recommended smoke tests (one small spec could cover all)
1. Fixture launches with path containing spaces (the real project path) in `channel:'chromium'`, headless: does the SW appear, what is the extension ID?
2. Idle >30 s then `sw.evaluate` still works on the same Worker (section 8).
3. Real popup flow: `chrome.permissions.request` from an extension page after a Playwright click: hang, reject or resolve?
4. Does `context.route()` on a fake https host get content scripts when host permission is in a modified manifest copy (option A in section 5)?
5. `document.visibilityState`/`hasFocus()` in headless for the chat tab and for a second tab.
6. Does `chrome.notifications.getAll()` work via `sw.evaluate` in headless? (optional)

## Sources
- https://playwright.dev/docs/chrome-extensions (OFFICIAL)
- https://playwright.dev/docs/intro (OFFICIAL)
- https://playwright.dev/docs/browsers (OFFICIAL)
- https://playwright.dev/docs/test-configuration (OFFICIAL)
- https://playwright.dev/docs/test-webserver (OFFICIAL)
- https://playwright.dev/docs/test-parallel (OFFICIAL)
- https://playwright.dev/docs/api/class-browsercontext (OFFICIAL)
- https://playwright.dev/docs/api/class-worker (OFFICIAL)
- https://playwright.dev/docs/release-notes (OFFICIAL)
- https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing (OFFICIAL)
- https://developer.chrome.com/docs/extensions/reference/api/permissions (OFFICIAL)
- https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ (UNOFFICIAL, Chrome team mailing list)
- https://github.com/microsoft/playwright/issues/32755 (UNOFFICIAL)
- https://github.com/microsoft/playwright/issues/38670 (UNOFFICIAL, via search summary only)

## 9. Results from our own setup (2026-10-13, Playwright 1.64, bundled Chromium 156.0.8078.4, Windows 11)
Observed in this project's test runs (test/e2e/extension.spec.js), not documented guarantees.
- Install problem on this PC: `npx playwright install chromium` put the browsers under `%LOCALAPPDATA%\ms-playwright`, but chrome.exe there would not start: Node reported `spawn UNKNOWN`, and Windows reported "side-by-side configuration is incorrect" (Application log, SideBySide event 33: dependent assembly `156.0.8078.4` not found). The headless shell started fine because it doesn't use that startup file.
  - Cause: `C:\Users\Bilal\AppData` carries an extra access rule for an app-container SID (`S-1-15-3-3557520199-...`), inherited by everything below it. The same three files copied to a folder without that rule started; copied to a sibling folder under ms-playwright (with the rule), they failed. Which app added the rule is unknown.
  - Fix used (no change to Windows settings): `PLAYWRIGHT_BROWSERS_PATH=0` keeps the browsers in `node_modules/playwright-core/.local-browsers`. It is set in test/playwright.env and read by `npm test` / `npm run install-browsers` (`node --env-file=...`). Playwright reads the variable once when it starts, so setting it in playwright.config.js would be too late. Always run the tests with `npm test`.
- The first launch of the freshly installed Chromium took more than 30 s once (probably Windows scanning the new program). Later launches took about 1 s.
- Smoke test 1: the extension loads headless with `channel: 'chromium'` from the spaced project path. The real project root (with node_modules inside) also loads as an unpacked extension.
- Smoke test 2: the service worker did NOT stop during 40 s idle under Playwright (a global set before the wait was still there). So we can't count on idle shutdown in tests. To test recovery after a restart, Phase 3 needs a forced stop, e.g. via chrome://serviceworker-internals or a CDP call. Research before relying on it. (Researched in section 10.)
- Smoke test 4 (partly): a dynamically registered content script injected into the fake chat at http://127.0.0.1:4173 with `host_permissions: ["http://127.0.0.1/*"]`. So a pattern without a port matched port 4173. `context.route` pages were not tried.
- Not yet tried: 3 (permissions.request from a page), 5 (visibility/focus in headless), 6 (notifications.getAll).

## 10. Forcing the extension service worker to stop (researched 2026-10-13, Playwright 1.64 / Chromium 156)

Labels: OFFICIAL = playwright.dev, developer.chrome.com, chromedevtools.github.io protocol definitions; SOURCE = Chromium source (main branch, read through a summarising fetch tool that decodes base64; quotes as reported); UNOFFICIAL = reasoning or secondary sources; UNKNOWN = needs the test at the end. NOTHING in this section has been run by me.

### 10.1 Why the worker did not stop after 40 s
- OFFICIAL, https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle (as recorded in chrome-mv3.md section 4): since Chrome 118 an active debugger session keeps the extension service worker alive. Chrome's eyeo write-up (https://developer.chrome.com/blog/eyeos-journey-to-testing-mv3-service%20worker-suspension , search summary) also says the worker is never suspended while DevTools is open or when using a ChromeDriver-based library.
- UNOFFICIAL inference: Playwright attaches a CDP session to extension service workers so that `Worker.evaluate` works (the Worker class needs a session). That attached session is a "debugger session", which would explain the missing idle shutdown. Not verified in Playwright's source. Consequence: waiting for idle will not work in tests; use a forced stop. (Playwright's page says a 30 s suspension happens and the same Worker object survives, https://playwright.dev/docs/chrome-extensions . That is stated, not demonstrated by us; our 40 s run contradicts "automatically suspended" at least for this setup.)

### 10.2 Method A (documented by Chrome for Puppeteer): close the worker target
- OFFICIAL, https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer : helper `stopServiceWorker(browser, extensionId)` finds `browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://' + extensionId))`, then `await (await target.worker()).close()`. The page's prose says this runs the CDP command `Target.closeTarget`, but the code calls Puppeteer's `worker.close()` (needs Puppeteer 22.1.0+). The two descriptions do not match exactly [docs inconsistent]. The page confirms the restart only indirectly: it clicks again and waits for the response, and the unfixed extension fails because in-memory state was lost.
- Playwright equivalent (my adaptation, UNTESTED): a BROWSER-level CDP session, then `Target.getTargets` (target `type` "service_worker", `url` starting with `chrome-extension://<id>/`) and `Target.closeTarget({targetId})`.
  - OFFICIAL, https://playwright.dev/docs/api/class-browser : `browser.newBrowserCDPSession()` returns a browser session (Chromium only). OFFICIAL, class-browsercontext: `browserContext.browser()` "Returns null if the context is created outside of normal browser, e.g. Android or Electron." Whether `context.browser()` is non-null for a `launchPersistentContext` context is NOT stated [UNKNOWN]; test it.
  - OFFICIAL, Target domain (https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Target.pdl , read through the fetch tool): `getTargets(filter?)` -> `targetInfos` (fields include `targetId`, `type`, `title`, `url`, `attached`); `attachToTarget(targetId, flatten?)` -> `sessionId`; `attachToBrowserTarget()` (experimental); `closeTarget(targetId)`. The listed type values do not include `service_worker` in that file's comments, but Puppeteer's own helper filters on `type() === 'service_worker'`, so that is the value.
  - Unknown: whether closing a service worker TARGET really terminates the version and whether the Playwright Worker then behaves as the doc says. Note `Target.closeTarget` on a worker target might only detach rather than stop. The Chrome page implies it stops it. [UNKNOWN; test.]

### 10.3 Method B (ServiceWorker domain): `ServiceWorker.stopWorker` / `stopAllWorkers`
- OFFICIAL protocol definition, https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/ServiceWorker.pdl (viewer: https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/ ):
  - The whole domain is marked EXPERIMENTAL (`experimental domain ServiceWorker`), `depends on Target`.
  - Commands: `enable`, `disable`, `stopWorker(versionId: string)`, `stopAllWorkers()`, `startWorker(scopeURL: string)`, `unregister(scopeURL)`, `updateRegistration(scopeURL)`, `skipWaiting(scopeURL)`, `setForceUpdateOnPageLoad`, `deliverPushMessage`, `dispatchSyncEvent`, `dispatchPeriodicSyncEvent`.
  - Events: `workerVersionUpdated(versions: ServiceWorkerVersion[])`, `workerRegistrationUpdated(registrations)`, `workerErrorReported`.
  - `ServiceWorkerVersion` fields: `versionId`, `registrationId`, `scriptURL`, `runningStatus` (enum `stopped | starting | running | stopping`), `status` (`new | installing | installed | activating | activated | redundant`), optional `scriptLastModified`, `scriptResponseTime`, `controlledClients`, `targetId`, router rules.
- Which session can send it? Playwright's `context.newCDPSession(page)` accepts only a `Page` or `Frame` (OFFICIAL, https://playwright.dev/docs/api/class-browsercontext). It does NOT accept a service worker `Worker`. So the ServiceWorker domain has to be driven from a PAGE session (any page in the same context) or from the browser session. Both are UNTESTED here.
- SOURCE, content/browser/devtools/protocol/service_worker_handler.cc (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/service_worker_handler.cc):
  - `SetRenderer` picks `context_` from the renderer process's STORAGE PARTITION (`storage_partition_->GetServiceWorkerContext()`); the frame argument is not used. So a session on a page sees the service workers of that page's storage partition. Extension service workers are expected to live in the same default storage partition of the profile [UNOFFICIAL inference, not verified in source]. Safest: use an extension page (e.g. `chrome-extension://<id>/popup.html` opened as a tab) for the session, since it certainly shares the extension's partition.
  - `Enable` must be called first: "domain not enabled" error otherwise; it starts a watcher that emits `workerVersionUpdated` for the context. Versions are not filtered by origin, so you will see the extension's `scriptURL` (`chrome-extension://<id>/...`) among any others.
  - `StopWorker(versionId)`: parses the id as int64 (error "Invalid version ID" if not), calls `context_->GetLiveVersion(id)` and, if a live version exists, `version->StopWorker(...)`. It returns success even if no live version was found, so a wrong versionId fails SILENTLY. Check the result with the events.
  - `StopAllWorkers()`: `context_->StopAllServiceWorkers(...)`; stops every service worker in that partition (in a test profile that is just ours, plus any site SWs).
- Does the stop override the "debugger attached keeps it alive" rule? That rule is about the idle timer; an explicit stop is a different path. UNOFFICIAL: the DevTools UI "Stop" button in Application > Service workers works while DevTools is attached. Not verified for this exact path [UNKNOWN].
- Sketch (UNTESTED, my adaptation):
  ```js
  // inside a test, context = persistent context, sw = extension worker, extId known
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);   // any extension page
  const cdp = await context.newCDPSession(page);
  const versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', e => versions.push(...e.versions));
  await cdp.send('ServiceWorker.enable');
  // wait until a version with scriptURL starting 'chrome-extension://<id>/' and runningStatus 'running' appears
  const v = versions.filter(x => x.scriptURL.startsWith(`chrome-extension://${extId}/`)).at(-1);
  await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  // then wait for an event with that versionId and runningStatus 'stopped'
  ```
  The `versions` array can hold several entries for one versionId over time; take the latest per versionId.

### 10.4 Method C: chrome://serviceworker-internals, and Method D: DevTools (manual only)
- UNOFFICIAL: chrome://serviceworker-internals lists registrations with Start/Stop/Unregister buttons per worker; `chrome://extensions` > the extension's "service worker" link > DevTools > Application > Service workers has a Stop button. Both are manual (good for Bilal's power test). Driving chrome://serviceworker-internals from Playwright (`page.goto('chrome://serviceworker-internals')`) is UNVERIFIED and fragile (WebUI DOM can change). Prefer CDP.

### 10.5 How to tell it really restarted
- Put a marker in the worker's global before the stop: `await sw.evaluate(() => { globalThis.__qcMarker = crypto.randomUUID(); return globalThis.__qcMarker; })`. After stop and restart, `await sw.evaluate(() => globalThis.__qcMarker)` returns `undefined` (a fresh global scope). Chrome's own docs confirm globals are lost when the worker shuts down (OFFICIAL lifecycle page).
- Optional second proof: record `performance.timeOrigin` in the worker before and after; it should change on a new worker start (UNOFFICIAL reasoning from the Performance API definition: time origin = creation of the global; not tested).
- Third proof: `ServiceWorker.workerVersionUpdated` events for that `versionId` go `runningStatus: 'stopping'` -> `'stopped'` -> `'starting'` -> `'running'` (OFFICIAL enum values; the exact sequence is not documented).
- Also check state survives: write to `chrome.storage.local` / `session` before the stop, read after.

### 10.6 Waking it up again, and what Playwright's Worker does
- After the stop nothing runs the worker until an event arrives. Ways: (1) an extension API event or message, e.g. from an extension page `chrome.runtime.sendMessage({type:'ping'})`, or a content script message, or an alarm; (2) CDP `ServiceWorker.startWorker({ scopeURL: 'chrome-extension://<id>/' })` (OFFICIAL command; passing the extension origin as scope is my inference [UNKNOWN]).
- OFFICIAL, https://playwright.dev/docs/chrome-extensions (quotes via fetch tool): "Playwright keeps the same Worker object alive - no new 'serviceworker' event is emitted"; new `evaluate()` calls issued during the restart window "are stalled until the new context is ready and then resume automatically"; calls already in flight at the moment of suspension "will throw with 'Service worker restarted'". So after a forced stop: keep using the SAME `sw` handle; do not wait for another 'serviceworker' event; expect a possible "Service worker restarted" error from any evaluate that was running.
- Not documented, UNKNOWN: whether `sw.evaluate()` issued while the worker is STOPPED (nobody has woken it) wakes it or hangs forever. Wake it explicitly first (a message from an extension page) and wrap the evaluate in a timeout. Also unknown whether the debugger session re-attaches after the restart and so makes the new worker immortal again (it probably does; irrelevant for the test).

### 10.7 Recommended test (about 20 lines, settles every UNKNOWN above)
1. Launch the fixture; get `sw`; `await sw.evaluate(() => { chrome.storage.local.set({k: 1}); globalThis.__m = 'before'; })`.
2. Try Method B (page session on an extension page; enable; find version; `stopWorker`). If it throws or the version never reaches `stopped`, try Method A (`context.browser()?.newBrowserCDPSession()` or, failing that, `cdp.send('Target.getTargets')` on the page session; `Target.closeTarget`).
3. Log the sequence of `runningStatus` values for that versionId.
4. From the extension page send `chrome.runtime.sendMessage({type:'ping'})` (or just call `sw.evaluate(() => globalThis.__m)` with a 10 s timeout) and assert: `__m` is `undefined`; `chrome.storage.local.get('k')` is `{k:1}`; `context.serviceWorkers()` still has exactly one extension worker and no new 'serviceworker' event fired (use a counter on `context.on('serviceworker')`).
5. Record which method worked and the Chromium version in this file. Put the working helper in test/e2e as `stopServiceWorker(context, page, extId)`.
- Alternative if neither CDP method works: reload the extension through `chrome.runtime.reload()` from the worker. That is NOT equivalent (it also clears `storage.session` and re-runs install logic), so it cannot test "state survives a restart" for session storage; treat only as a last resort.

### 10.8 Result (2026-10-14, Playwright 1.64, Chromium 156, our test run)
- Method B WORKS: a CDP session on an extension page (the popup opened as a tab), `ServiceWorker.enable`, find our version (`scriptURL` starting `chrome-extension://<id>/`, `runningStatus` "running"), `ServiceWorker.stopWorker({versionId})`, then wait for `runningStatus` "stopped".
- After the stop, a message from an extension page (or a content script) wakes the worker: in-memory globals are gone, chrome.storage.session and local are kept, the top-level start-up code runs again, Playwright keeps the same Worker object and no new 'serviceworker' event fires.
- Helper: test/e2e/service-worker-restart.js (`stopServiceWorker(context, extensionId)`), checked by test/e2e/service-worker-restart.spec.js. Method A was not needed.
