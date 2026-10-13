# Chrome MV3 APIs for Queue Cue

Researched 2026-10-12. Tag key: [OFFICIAL] = developer.chrome.com (or MDN where stated); [UNOFFICIAL] = forums, blogs, issue trackers, general knowledge; [UNKNOWN] = docs silent, needs a test.
Doc pages were read through a summarising fetch tool, so exact quotes are as reported by that tool. Re-check the original page before relying on a borderline detail.

Base URL for the API references: https://developer.chrome.com/docs/extensions/reference/api/<name>

---

## 1. Per-site permissions
Sources: /permissions, https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions

Manifest [OFFICIAL]:
- `"optional_host_permissions": ["https://*/*", "http://*/*"]` is the documented way to request hosts discovered at runtime. The declare-permissions page shows exactly this pattern. Required hosts go in `host_permissions`.
- Permission needed in manifest for the API itself: the docs do not list one for `chrome.permissions` (no `"permissions"` entry needed; the API is available to all extensions). [Not stated explicitly; inferred from the reference listing no permission. Confirm with a test.]
- Always-required `https://ntfy.sh/*` goes in `host_permissions`.
- Cannot be optional: debugger, declarativeNetRequest, devtools, geolocation, mdns, proxy, tts, ttsEngine, wallpaper.

Signatures [OFFICIAL, Chrome 96+ for the Promise forms]:
- `chrome.permissions.request(permissions: Permissions): Promise<boolean>`
- `chrome.permissions.contains(permissions: Permissions): Promise<boolean>`
- `chrome.permissions.remove(permissions: Permissions): Promise<boolean>`
- `chrome.permissions.getAll(): Promise<Permissions>`
- Events: `chrome.permissions.onAdded` and `onRemoved`, each passing a `Permissions` object. onAdded: "Fired when the extension acquires new permissions." onRemoved: "Fired when access to permissions has been removed from the extension."
- `Permissions` shape: `{ origins: string[], permissions: string[] }`. Example for one site: `{ origins: ["https://example.com/*"] }`.

Details [OFFICIAL]:
- Requested items must be in `optional_permissions` / `optional_host_permissions`, or be required permissions the user withheld.
- "Paths on origin patterns will be ignored." So asking for `https://example.com/chat/*` grants the whole origin. Use `https://example.com/*`.
- You can request a subset of the declared optional origins (so `https://*/*` declared, `https://example.com/*` requested is fine).
- Chrome only shows a prompt if the new permission changes the warning text the user has already accepted.
- On error the promise rejects.
- `remove()` returns false when you tried to remove required permissions. "Calling request() usually adds the permission back without prompting the user" (docs do not say when this is not so).
- The `origins` listed by `getAll()` also include hosts from content scripts.
- Host access requests (`addHostAccessRequest`, Chrome 133+) are a different feature; not needed.
- The reference page says request must be called "from inside a user gesture, like a button's" click handler.

User gesture and `await` [UNKNOWN in official docs]:
- Docs say nothing about whether the gesture survives an `await`. The HTML concept is "transient activation", which expires after a timeout and can be consumed (MDN https://developer.mozilla.org/en-US/docs/Web/Security/User_activation; MDN gives no duration, the spec leaves it to the browser).
- Safest design [our recommendation]: call `chrome.permissions.request(...)` as the first statement in the click handler, with no `await` before it. Work that needs `await` (tabs.query, storage) can't go before the request inside the handler, so do it when the popup opens: work out the site's origin then, keep it in a variable, and use it synchronously in the click handler.
- Firefox report (UNOFFICIAL, https://github.com/tianma-if/edgeever/issues/464): an `await` before the call lost user-input status. Firefox, not Chrome, but same principle.
- The service worker cannot make the request on the popup's behalf: user activation does not carry over via a message (UNOFFICIAL, search-result summary of a GitHub PR).
- Test to settle: in the popup, `await chrome.tabs.query(...)` then call `permissions.request` in the same handler; see if it throws "may only be called from a user gesture". Then repeat with the origin precomputed.

Popup closing while the prompt is open [UNOFFICIAL, not in the official docs]:
- Chromium issue "Programmatically requesting permissions closes popup after browser prompts user" https://issues.chromium.org/issues/40721470 (page requires sign-in, so I could not read its status or whether it is fixed; a search summary says it dates from ~2020 and was marked duplicate).
- Reported effect: the toolbar popup closes when the prompt appears, so the code after `await request()` never runs. Treat this as likely on Windows Chrome until tested.
- Design implication [our recommendation]: do NOT rely on the popup's code running after the grant. Instead listen to `chrome.permissions.onAdded` in the service worker (top level), and register the content scripts there when the origin is added. Also have the popup, on every open, call `permissions.contains` and, if granted but not registered, ask the service worker to register. Workarounds others use: do the request from a full extension tab or side panel.
- Test to settle: click the button on a real site in the target Chrome and see whether the popup survives and whether the `.then` runs.

Removing access [partly UNKNOWN]:
- Official docs do not say what happens to dynamically registered content scripts when the host permission is removed.
- UNOFFICIAL: chromium-extensions thread says "registerContentScripts() itself doesn't display any warning, but without host permission it doesn't work" (https://groups.google.com/a/chromium.org/g/chromium-extensions/c/k6EripOoHh4). A GitHub docs issue (https://github.com/GoogleChrome/developer.chrome.com/issues/5645) says registration succeeds without host permission but nothing gets injected. So: scripts without host access are not injected, but the registration record itself stays until we unregister it.
- Recommendation: unregister ourselves in `permissions.onRemoved` (use ids derived from the origin), and also reconcile at service-worker start: for each registered id, check `permissions.contains`, else unregister. Cheap and removes the doubt.
- Test: grant a site, register, call `chrome.permissions.remove({origins:[...]})` (or remove via chrome://extensions "Site access"), reload the page, check `getRegisteredContentScripts()` and whether the hook ran. Also test a user revoking via chrome://extensions UI, and check `onRemoved` fires in that case (docs imply it but do not say).

---

## 2. chrome.scripting dynamic content scripts
Source: /scripting and https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

Needs [OFFICIAL]: manifest permission `"scripting"` plus host permission for the pages (can be optional host permission once granted). Min Chrome 96 for register/get/update/unregister; `world` Chrome 102+; `matchOriginAsFallback` Chrome 119+. Gotcha: the reference page doesn't state explicitly that registration requires host access at register time. Community reports say the call succeeds without it but nothing injects.

Methods [OFFICIAL]:
- `chrome.scripting.registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>`. Atomic: any parse/file error or existing duplicate id means none are registered.
- `chrome.scripting.getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredContentScript[]>`. Only this extension's dynamic scripts.
- `chrome.scripting.updateContentScripts(scripts: RegisteredContentScript[]): Promise<void>`. Only included properties change. Atomic. Fails if id is not registered.
- `chrome.scripting.unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>`. No filter removes all dynamic scripts. Key point: it does NOT remove scripts already injected into open pages.

RegisteredContentScript fields [OFFICIAL]:
- `id` string, required. Must not start with `_`.
- `matches` string[]. Required for register.
- `excludeMatches` string[].
- `js` string[]: "injected in the order they appear in this array". Paths relative to extension root.
- `css` string[], same ordering.
- `runAt`: `"document_start" | "document_end" | "document_idle"`; default `document_idle`.
- `world`: `"ISOLATED"` (default) or `"MAIN"` (Chrome 102+). MAIN = environment shared with the page; page CSP applies.
- `allFrames` boolean, default false. Each frame URL checked independently.
- `persistAcrossSessions` boolean, default true. "Specifies if this content script will persist into future sessions."
- `matchOriginAsFallback` boolean (Chrome 119+). For frames with about:, data:, blob:, filesystem: URLs, match on the initiator's origin. (The content-scripts page shows only the manifest spelling `match_origin_as_fallback`, and says such scripts must have a path of `*`.) Not needed for Queue Cue unless the chat sits in a blob/about frame.

Questions asked:
- Several files in `js`: they inject in array order [OFFICIAL]. Whether they share one global scope: the docs do not say explicitly. Docs say variables of an extension's content scripts are not visible to the page or to OTHER extensions. [UNKNOWN] for same extension. Normal Chrome behaviour (UNOFFICIAL, from experience) is that scripts of one extension in the same world and same frame share a global scope; for MAIN world they share the page's global, so top-level `const`/`let` leakage and name clashes with the page are a risk. Our namespace-object rule already handles it. Test: file A sets `globalThis.__qc = {}`, file B reads it, in both worlds.
- Cross-world order: docs silent. Do not depend on ordering between the MAIN hook and the ISOLATED relay; make the relay tolerant of the hook posting before it listens (e.g. relay registered with `document_start` and hook posts after; or hook queues until a "ready" handshake). Test: log timestamps.
- MAIN world at `document_start`: the docs do not mention any restriction, and do not confirm it either. Chrome 102 introduced `world` for registerContentScripts and `document_start` is a general runAt value. UNOFFICIAL knowledge says it works. Settle with a test: register hook with `world:"MAIN", runAt:"document_start"` and have it set `window.__qcHookStartedBeforeScripts = document.scripts.length` to confirm it ran before page scripts.
- Persistence: `persistAcrossSessions` defaults to true ("future sessions"). The docs do not say what happens on extension update or reload. [UNKNOWN]. UNOFFICIAL: people commonly report registrations persist across restart; behaviour on update is less clear. Recommendation: at service worker start and in `onInstalled` (all reasons), reconcile: compare `getRegisteredContentScripts()` against `permissions.getAll().origins` and re-register or unregister as needed. Set `persistAcrossSessions: true` explicitly. Test: register, reload extension at chrome://extensions, call get; then restart the browser, call get.
- Dynamic scripts and file paths: when the extension is updated, files they reference may change; re-registering on `onInstalled` with reason `update` is the safe path.
- Static manifest `content_scripts` run before dynamically registered ones [OFFICIAL]; we have none.

---

## 3. MAIN to ISOLATED messaging, then runtime.sendMessage
Sources: content-scripts concepts page (above), https://developer.chrome.com/docs/extensions/develop/concepts/messaging, /runtime

postMessage [OFFICIAL for the pattern]:
- The content-scripts page says the page and content script share the DOM but not JS environments, and gives `window.postMessage()` as the way to talk, with the listener comment "We only accept messages from ourselves" (checks `event.source === window`).
- The docs do not give a full checklist. Our recommended checks [our recommendation]: (1) `event.source === window`; (2) `event.origin === window.location.origin` (note: `postMessage(msg, "*")` is fine from the sender because it is same window, but use `window.location.origin` as targetOrigin where possible; for sandboxed/opaque-origin frames origin is `"null"` and the targetOrigin would fail, so test); (3) `event.data` is a plain object with our marker (e.g. `__queueCue: true` and a version string); (4) validate fields and types of `type`, `platform`, `messageKey` against the allowed list. Remember the page's own scripts can also post matching messages, so the marker is NOT a secret and the relay must treat data as untrusted. Do not put message content in events.
- `isTrusted` is not a useful check here (page scripts calling postMessage produce a trusted-looking event of type message with the correct source).
- The content-scripts page also states the content scripts are less trusted and the service worker should validate input (messaging page says messages from content scripts may be crafted).

runtime.sendMessage [OFFICIAL]:
- `chrome.runtime.sendMessage(extensionId?, message, options?): Promise<any>` (Promise form Chrome 99+). From a content script the extension id is omitted: `chrome.runtime.sendMessage({ ... })`.
- Receiver: `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => ...)`. To respond asynchronously, return the literal `true` (not just truthy). Returning a Promise is supported from Chrome 148 only (gradual rollout), so use `return true` + `sendResponse`.
- Max message size 64 MiB. JSON-style serialisation (undefined becomes null).
- Gotchas: async listener functions always return a promise and can cause the sender to get `null` early; only the first responder counts. If the service worker is asleep, the message wakes it (this is the standard behaviour; listener must be at the top level of the script: events page https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events).
- If the extension is reloaded, old content scripts in already-open pages lose their connection: `chrome.runtime.sendMessage` throws "Extension context invalidated" [UNOFFICIAL, well-known]. Wrap in try/catch. This matches CLAUDE.md's "reload extension AND refresh page".

MessageSender [OFFICIAL, /runtime]. All fields optional:
- `tab`: Tab object; "only present when the connection was opened from a tab (including content scripts)".
- `frameId`: 0 = top frame, positive = child frame; set only when `tab` set.
- `documentId`: UUID of the document (Chrome 106+).
- `url`: URL of the page or frame that sent it (for iframes it's the iframe's URL).
- `origin`: origin of the sender (Chrome 80+), can be opaque.
- `id`: extension id of sender.
- `tlsChannelId`: not relevant.
- `sender.tab.url`/`title` only present with `tabs` permission or host permission for that page (tabs page). Since the site is granted via optional host permission, `tab.url` should be present for watched sites; test it.
- Use `sender.tab.id` and `sender.frameId` to key per-chat state, and `sender.tab.windowId` for focusing.

---

## 4. Service worker lifetime
Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

[OFFICIAL]
- Idle timeout: terminated "after 30 seconds of inactivity".
- Timer reset by: receiving an event, or calling an extension API (Chrome 110+). Chrome 114+: opening a port no longer resets timers, but long-lived messaging keeps it alive. Chrome 116+: active WebSocket connections extend lifetime. Chrome 118+: active debugger session keeps it alive. Chrome 109: messages from an offscreen document reset timers. Chrome 105: native messaging connectNative keeps it alive.
- Max single request time: 5 minutes ("a single request, such as an event or API call, takes longer than 5 minutes"). Chrome 116+ lets some user-prompt APIs (permissions.request, identity.launchWebAuthFlow) exceed it.
- fetch(): terminated if a response takes more than 30 seconds to arrive.
- Globals: "Any global variables you set will be lost if the service worker shuts down." Store in chrome.storage, IndexedDB or CacheStorage. Web Storage (localStorage) is unavailable.
- Listeners must be registered synchronously at top level of the script so they exist when the worker is woken for an event.
- setTimeout/setInterval: the lifecycle and events pages do NOT mention them [docs silent]. Consequence is implied by the above: a pending timer does not by itself keep the worker alive; when the worker is terminated, the timer is gone and its callback never runs. (Inference from the lifecycle rules, not an explicit doc statement; CLAUDE.md rule to use chrome.alarms for waits over a few seconds is consistent with it.)
- Keeping alive is not a goal; use alarms.

---

## 5. chrome.alarms
Source: /alarms

- Permission: `"alarms"` in `permissions` [OFFICIAL].
- `chrome.alarms.create(name?: string, alarmInfo: AlarmCreateInfo): Promise<void>` (Promise Chrome 111+). Same name replaces the existing alarm.
- AlarmCreateInfo: `delayInMinutes`, `periodInMinutes`, `when` (ms since epoch; not with delayInMinutes), `persistAcrossSessions` (Chrome 150+, default true but docs say set it explicitly), and a `name` field listed as Chrome 152+.
- Minimum: 30 seconds (0.5 minute), since Chrome 120. Values below 0.5 for delay/period are ignored with a warning. `when` less than 30 s ahead still will not fire before 30 s. May fire later than scheduled. Unpacked extensions are exempt from the frequency limit (dev only; do not test timing with the unpacked build alone).
- Persistence: with `persistAcrossSessions: true`, lasts until extension update. With false: cleared on reload, restart and any update. The docs do not describe service worker shutdown at all [docs silent], but the standard model is that alarms are owned by the browser, not the worker, and wake it. Docs advice: at service worker start, `alarms.get()` and recreate any missing important alarm.
- Behaviour before Chrome 150 "can be unpredictable" per the docs. Note the version the user's Chrome and Playwright's bundled Chromium have; if Playwright Chromium is older than 150, expect differences in tests.
- Sleep: alarms do not wake the PC; missed alarms fire on wake; repeating alarms fire at most once on wake.
- Gotcha for our 'nudge timing' and 60-minute keep-awake timeout: update/reload deletes alarms with persistAcrossSessions false, and an extension update clears even persisted ones. Re-derive from storage on `onInstalled`/startup.
- Listener: `chrome.alarms.onAlarm.addListener((alarm) => ...)` at top level.

---

## 6. chrome.storage.session vs local
Source: /storage

- Permission: `"storage"` [OFFICIAL].
- session: 10 MB (`QUOTA_BYTES` 10485760; was 1 MB in Chrome 111 and earlier). In memory. Chrome 102+. Cleared "if the extension is disabled, reloaded, updated, and when the browser restarts".
- local: 10 MB (5 MB in Chrome 113 and earlier); `unlimitedStorage` permission lifts it. Persists.
- sync ~100 KB, 8 KB per item, 512 items (not needed).
- Content script access: local, sync, managed exposed by default. session NOT exposed to content scripts by default. `chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })` opens it (Chrome 102+). Docs summary showed the call without full signature; the usual form takes an object with `accessLevel`. Not needed for us, since content scripts only message the worker. Keep the default: content scripts run alongside untrusted web pages, so exposing session storage to them would be a needless risk.
- `chrome.storage.onChanged` callback: `(changes, areaName)`. Per-area events also exist (`chrome.storage.session.onChanged`).
- Gotcha: because session storage is wiped on extension reload/update, any "already alerted this messageKey" dedupe stored only in session is lost then; page reload is a new baseline anyway. Settings (ntfy topic) must go in local.

---

## 7. chrome.power
Source: /power

- Permission: `"power"` [OFFICIAL].
- `chrome.power.requestKeepAwake(level: "system" | "display"): void`
- `chrome.power.releaseKeepAwake(): void`
- `reportActivity()` is ChromeOS 113+ only.
- `"system"`: prevents sleep from user inactivity. `"display"`: also keeps the display from turning off/dimming. "display" takes precedence over "system" across extensions.
- Calling twice: "If a request previously made by the same app is still active, it will be replaced by the new request." So repeated calls are safe, and one `releaseKeepAwake()` releases it.
- After service worker stops: docs silent [UNKNOWN]. Similarly for extension reload/unload: the page only discusses another app being unloaded ("until app B is unloaded or releases its request"), which implies requests go away when the owner is unloaded, but does not state it for reload. Settle with a test.
- Test: request "system", let the worker idle out (30+ s, watch chrome://serviceworker-internals or the extensions page), then check Windows `powercfg /requests` (in an admin prompt) to see if Chrome still holds a request; then reload the extension and re-check. Needs Bilal/real machine (CLAUDE.md lists this as manual).
- Design implication: keep the 60-minute safety release on an alarm and keep state "keepAwakeActive + lastActivity" in storage. On worker start, re-assert or release according to stored state.
- (Updated 2026-10-13: Chromium source now read, see "Phase 3 research" Q4 below. Short version: a worker stop does NOT release the request; unload/reload/disable does.)

---

## 8. chrome.notifications
Source: /notifications

- Permission: `"notifications"` [OFFICIAL].
- `chrome.notifications.create(notificationId?: string, options: NotificationOptions): Promise<string>` (Promise Chrome 116+). If id matches an existing one, that one is cleared first. Id max 500 chars. Use a stable id per chat (e.g. `qc:<tabId>`) to avoid piling up, but beware that replacing may not re-alert [test].
- Required for `create`: `type` ("basic" | "image" | "list" | "progress"), `iconUrl`, `title`, `message`. Yes, `iconUrl` is required. It accepts an extension-relative path, a data URL or a blob URL.
- `requireInteraction` (Chrome 50+): stays visible until the user acts. Default false. `silent` (Chrome 70+): suppresses sound; CLAUDE.md says no custom sounds, so leave OS default or set silent per Bilal's preference (ask).
- `priority` -2..2; on Windows, Linux and Mac -2 and -1 cause an error (notification never shown). Use 0 or higher.
- `chrome.notifications.onClicked.addListener((notificationId) => ...)` fires on a click in a non-button area. `onClosed(notificationId, byUser)`, `onButtonClicked(notificationId, buttonIndex)`.
- `chrome.notifications.clear(notificationId): Promise<boolean>` (Chrome 116+).
- Notification ids/tab mapping: notifications carry no custom data, so store a map notificationId to tabId/windowId in chrome.storage.session (the worker may have restarted by click time). Top-level `onClicked` registration wakes the worker.
- Windows-specific: the official page lists no Windows behaviours other than the priority note. Anything about Windows Focus Assist / Do Not Disturb / notification centre / Chrome notification settings is not covered [docs silent]. Manual check on Bilal's PC. (Updated 2026-10-13: see Phase 3 research Q3 below.)
- Deprecated and ignored: `isClickable` (Chrome 67), `appIconMaskUrl`, `imageUrl`, button `iconUrl` (Chrome 59). `onPermissionLevelChanged` only fires on ChromeOS UI.

Bringing the chat tab forward [OFFICIAL, /tabs and /windows]:
- `chrome.tabs.update(tabId, { active: true })` returns `Promise<Tab | undefined>`. It "does not affect whether the window is focused".
- `chrome.windows.update(windowId, { focused: true })` returns `Promise<Window>`: "brings the window to the front". Cannot combine with `state: "minimized"`. If the window is minimized, set `{ focused: true, state: "normal" }` (separate use of state is allowed; combination limits are only for position/size fields).
- Sequence: `const tab = await chrome.tabs.get(tabId); await chrome.tabs.update(tabId, {active:true}); await chrome.windows.update(tab.windowId, {focused:true});`
- `windows.update` `drawAttention: true` flashes the window without changing focus (fallback if the OS blocks focus stealing) [OFFICIAL].
- Permissions: no permission needed for tabs.update/windows.update/tabs.get. The `tabs` permission or host permission is only needed to read `url`/`title`.
- Pitfall [UNKNOWN]: whether Windows allows Chrome to take foreground when the user is in another app. Notification click gives Chrome foreground rights normally, but test it on Bilal's Windows 11. If the tab was closed, `tabs.get` rejects; handle and clear the notification.

---

## 9. Is the chat tab visible AND focused
Sources: /tabs, /windows

From the service worker [OFFICIAL]:
- `chrome.tabs.get(tabId)` gives `tab.active` (active in its window) and `tab.windowId`. `tab.active` "does not necessarily mean the window is focused".
- `chrome.windows.get(windowId)` / `chrome.windows.getLastFocused(queryOptions?)` return a Window with `focused` ("Whether the window is currently the focused window") and `state` (normal/minimized/maximized/fullscreen). getLastFocused returns "the window most recently focused", which can still be a window of Chrome after the user switched to another app.
- `chrome.windows.onFocusChanged` passes `windowId`; `chrome.windows.WINDOW_ID_NONE` (-1) when all Chrome windows have lost focus. On some Linux window managers NONE is emitted briefly during switches (not relevant on Windows).
- Combine: `tab.active && win.focused && win.state !== "minimized"`.
- Pitfall: the docs do not say whether `Window.focused` becomes false when another application (not Chrome) has OS focus. The onFocusChanged text implies it does (NONE when "all Chrome windows have lost focus"), but this is not explicit for `focused` on get/getLastFocused. [UNKNOWN] Test it: focus Notepad, call `windows.getLastFocused()` from the service worker, log `focused`.
- Other pitfalls: a popup window or DevTools or the extension popup being focused counts as another window; Chrome windows covered by other windows are still "focused" false only if not the OS foreground, but `active` plus not occluded is not detectable via these APIs (there's no occlusion info, UNOFFICIAL; the page API below does handle occlusion on some platforms).

From the page (content script, or the hook) [UNOFFICIAL/standard web platform, MDN not fetched]:
- `document.visibilityState === "visible"` is false for background tabs and minimized windows; Chrome also marks fully occluded windows as hidden on Windows/macOS in recent versions (UNOFFICIAL, from experience, test).
- `document.hasFocus()` is true only if the document (and its frame) has focus; false when another app or the address bar/devtools has focus.
- Best combined signal [our recommendation]: relay reports `visibilityState === "visible" && document.hasFocus()` along with each event (so the worker doesn't need the windows APIs), and the worker may cross-check with `windows.getLastFocused`. Treat "both say focused" as quiet, anything else as alert. Chat widgets in iframes: `document.hasFocus()` in the top document returns true when an iframe inside has focus (standard behaviour), test to confirm with the Tawk.to iframe.
- Test: with a page logging both values, switch to another app, switch tab, minimize, and cover the window; record visibilityState/hasFocus/windows.focused.

---

## 10. fetch to ntfy.sh, crypto.randomUUID, onInstalled
Sources: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests, /runtime, MDN randomUUID https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID

fetch + host permission + CORS [OFFICIAL]:
- Extension service workers and extension pages "can talk to remote servers outside of [their] origin", but "Cross-origin access must be declared in the manifest's `host_permissions`". Scheme matters: https and http are separate. So `"host_permissions": ["https://ntfy.sh/*"]` is needed and is enough for fetches to `https://ntfy.sh/<topic>` from the service worker; with it, normal CORS enforcement does not block the extension's own fetch (the page describes extensions as not bound by same-origin limits when they hold the host permission).
- Content scripts are the opposite: their requests are always treated as cross-origin even with host permissions. So all ntfy calls go from the service worker, never the content script (matches CLAUDE.md).
- Docs do not spell out the CORS preflight details. UNOFFICIAL practical note: ntfy accepts a plain `fetch("https://ntfy.sh/<topic>", { method: "POST", body: "text" })`; with the host permission no preflight issue is expected, but test for a non-simple header such as `Title` (ntfy header) or `Priority`. Test: send with and without custom headers from the service worker and watch the response/console. ntfy publishing format itself should be checked at docs.ntfy.sh (separate research item).
- fetch must start responding within 30 s or the worker is terminated.
- Is the request made while the user has not granted ntfy: since it's a required host permission, it's granted at install.

crypto.randomUUID() [MDN, partial]:
- MDN: `crypto.randomUUID()` generates a v4 UUID, secure contexts only, "also available in Web Workers", Baseline widely available since March 2022. MDN text did not state the Chrome version; Chrome 92 is my recollection (UNOFFICIAL).
- The Chrome extension docs do not state that `crypto.randomUUID` exists in extension service workers. An extension origin (chrome-extension://) is treated as a secure context in practice (UNOFFICIAL). Quick test: run `crypto.randomUUID()` in the service worker DevTools console. Expected to work.
- Note: a UUID is a v4 random value, ~122 bits, fine as an unguessable ntfy topic. Prefix it (e.g. `queuecue-<uuid>`).

chrome.runtime.onInstalled [OFFICIAL, /runtime]:
- `chrome.runtime.onInstalled.addListener((details) => ...)`, `details.reason` is one of `"install"`, `"update"`, `"chrome_update"`, `"shared_module_update"`. `details.previousVersion` only for `update`. `details.id` only for `shared_module_update`.
- Fires on first install, extension update to a new version, and Chrome update. (Dev reloads of an unpacked extension: UNOFFICIAL, usually reported as `update`; the docs don't say. Test it, because the "generate topic on install" code must be idempotent.)
- Recommendation: generate the topic when `reason === "install"` OR when no topic exists in chrome.storage.local (covers a missed install event and unpacked reloads); never overwrite an existing topic. Register the listener at top level.
- It does not fire on every worker start; use top-level startup code or `chrome.runtime.onStartup` for reconciliation.

---

## Open questions and recommended tests (summary)
1. Does `permissions.request` work after an `await` in Chrome, and does the popup close during the prompt (Chromium issue 40721470, status unreadable)? Test on real Chrome; design around it with `permissions.onAdded` in the worker.
2. Are registered scripts left over after `permissions.remove`/user revocation, and does `onRemoved` fire for UI revocation? Test; unregister ourselves anyway.
3. MAIN world + `document_start` via `registerContentScripts`: docs silent. Test.
4. Do multiple `js` files in one registration share one global scope, and do the registrations survive extension reload/update/browser restart? Test.
5. Does `chrome.power` keep-awake survive worker shutdown and reload? Test with `powercfg /requests` (Bilal-only).
6. Does `Window.focused` go false when a non-Chrome app has focus on Windows? Does `windows.update focused:true` actually raise Chrome from a notification click? Test (Bilal-only for the real OS part).
7. `crypto.randomUUID` in the worker, and ntfy POST with custom headers (CORS): quick console tests.
8. Alarm minimum and `persistAcrossSessions` need Chrome 120+ and 150+ respectively; check version of Playwright's bundled Chromium and Bilal's Chrome (chrome://version).

## Results from our own tests (2026-10-13, Playwright's Chromium 156, fake chat page)
Observed in test/e2e/extension.spec.js. This was the fake page, not a real vendor site.
- Open question 3 (MAIN world + document_start via registerContentScripts): WORKS. A script registered with `world: "MAIN", runAt: "document_start"` ran before any of the page's scripts. At that point `document.scripts.length` was 0, `window.Tawk_API` was undefined and `document.readyState` was "loading". Its global was visible to the page, which confirms MAIN world. Registration applied to the next page load.
- Match pattern `http://127.0.0.1/*` in host_permissions covered http://127.0.0.1:4173, so a pattern without a port matched a page on a port.
- Unpacked extension: loading the project root works even with node_modules inside it.

---

# Phase 3 research, 2026-10-13

Chrome targets: Bilal's Chrome 154.0.8037.98 (Windows 11 Stable); tests use Playwright 1.64.0's Chromium 156.
Method and caveat: pages were read through a summarising fetch tool. Chromium source files were fetched as base64 text from chromium.googlesource.com (`?format=TEXT`, `refs/heads/main`, so they show the CURRENT tip of main, which is newer than Chrome 154; behaviour could differ slightly) and decoded/summarised by the tool, so quoted lines are as reported by the tool. Labels: OFFICIAL = developer.chrome.com / MDN / tc39.es / learn.microsoft.com; SOURCE = Chromium source (primary evidence of behaviour, not documentation, and from main not from 154); UNOFFICIAL = blogs, forums, search summaries, general knowledge; UNKNOWN = needs a test.
Question 2 (forcing a service worker stop in Playwright) is in notes/research/playwright.md section 10.

## P3-Q1. activeTab and the popup

Short answer: YES, with `activeTab` alone the popup should be able to read `tab.url` of the current tab, and `activeTab` adds NO install warning. Confidence: medium-high (the source shows the grant happens on the toolbar click even when a popup opens; the docs never say "popup" explicitly).

- OFFICIAL, https://developer.chrome.com/docs/extensions/develop/concepts/activeTab : activeTab "gives an extension temporary access to the currently active tab when the user invokes the extension". Invocations listed: executing an action, executing a context menu item, executing a keyboard shortcut from the commands API, accepting an omnibox suggestion. With it you can "get the URL, title, and favicon for that tab" and (with `scripting`) inject scripts. The page does NOT mention popups and does not say whether opening an action's `default_popup` counts as "executing an action" [docs silent].
- OFFICIAL, https://developer.chrome.com/docs/extensions/reference/api/tabs : `url`, `pendingUrl`, `title`, `favIconUrl` are "only present if the extension has the "tabs" permission or has host permissions for the page". The page says activeTab "grants an extension temporary host permission for the current tab in response to a user invocation" but does not spell out that this makes those four properties readable [docs slightly indirect; the activeTab page does say URL/title/favicon become readable].
- SOURCE, chrome/browser/extensions/extension_action_runner.cc (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/extension_action_runner.cc ; header https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/extension_action_runner.h): `ExtensionActionRunner::RunAction(extension, grant_tab_permissions)` calls `GrantTabPermissions` BEFORE it checks `HasPopup(tab_id)` and returns `ShowAction::kShowPopup`. So the grant happens on the toolbar click even when a popup is then shown. Exception: if the extension has "blocked actions" (withheld host access with a pending script run), `RunAction` grants and returns early WITHOUT showing the popup; that does not apply to us (we have no content scripts that are withheld on click). Header comment: the grant "may not happen in all cases (such as when showing a side panel)".
- SOURCE, active_tab_apitest.cc (https://chromium.googlesource.com/chromium/src/+/a753229/chrome/browser/extensions/active_tab_apitest.cc, older revision, via search summary): test comments say that without the grant the extension has no access to `tab.url`; after the grant it has.
- Install warning: OFFICIAL, https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings says activeTab "does not display a permission warning"; https://developer.chrome.com/docs/extensions/reference/permissions-list shows no warning for activeTab, `scripting`, `power`, `alarms`, `storage`. `tabs` would show "Read your browsing history." (do not use it). Required host permission `https://ntfy.sh/*` will almost certainly show a host-access warning (UNOFFICIAL inference; the permission-warnings page was only partly readable, check the install dialog or the Web Store listing preview). Whether `optional_host_permissions` show a warning at install: the page does not say explicitly [docs silent]; by design they are only prompted at request time.
- Lost on navigation (OFFICIAL, activeTab page): access "is revoked when the user navigates away or closes the tab". Navigating within the same site keeps it; to a different site revokes it. Restricted pages (chrome://, Web Store) are never granted.
- Gotchas:
  1. The grant is per invocation on the tab that was active at click time. Read the URL once when the popup opens; don't re-query later (if the user navigates cross-site while the popup is open, `url` may become undefined).
  2. If the tab is chrome://, about:, the Web Store, or a PDF viewer etc., `url` is undefined or a restricted scheme. Show "Can't watch this page".
  3. `chrome.tabs.query({active:true,currentWindow:true})` from the popup: the popup is not a tab, so this returns the browser tab under it. Fine. (In Playwright's "popup opened as a tab" test setup it returns the popup tab itself; see playwright.md section 4.)
  4. Opening the extension from `chrome://extensions` or via the puzzle-piece menu still counts as invoking the action (SOURCE for the toolbar path; the puzzle-piece/menu path is not separately verified).
  5. Once the user grants `<origin>/*` via `permissions.request`, host permission exists for that origin, so `url` stays readable there without activeTab.
  6. Chrome's site-access setting "On click" for host permissions is irrelevant here (that governs content-script injection, not activeTab).
- Better alternatives without a warning? None found. Options considered: `tabs` permission (warns), a content script (can't exist before permission), `chrome.action.onClicked` (not available when `default_popup` is set), `scripting.executeScript` (needs host or activeTab anyway). activeTab is the documented low-friction way.
- Design implication: add `"activeTab"` to `permissions`. In the popup's startup code: `const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); const url = tab?.url;` parse with `new URL(url)`, accept only http/https, compute `origin + "/*"`, keep in a variable for the click handler (no `await` before `permissions.request`). Also call `permissions.contains` at startup to show "Watching" vs "Not watching".
- Test (cheap, in real Chrome; Playwright can't open the real toolbar popup): load unpacked with `activeTab`, no host permission, click the toolbar icon on https://example.com, log `tab.url` in the popup; repeat on chrome://extensions (expect undefined). Also confirm no warning in the Web Store listing/dialog later.

## P3-Q3. chrome.notifications on Windows 11 / Chrome 154

Short answer: `requireInteraction: true` should keep the toast until dismissed on Windows 10 RS4+/11 (Chrome maps it to the Windows "reminder" scenario and adds a Close button), but this is source evidence only, not documented; Do Not Disturb / Focus Assist will suppress the pop-up banner and nothing in Chrome overrides it; raising Chrome from a click is UNKNOWN until tested. Confidence: medium on requireInteraction, low on DND and foreground.

requireInteraction:
- OFFICIAL, /notifications : `requireInteraction` (Chrome 50+) "Indicates that the notification should remain visible on screen until the user activates or dismisses the notification." Default false. No Windows-specific caveat in the docs.
- SOURCE, chrome/browser/extensions/api/notifications/notifications_api.cc (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/notifications/notifications_api.cc): `notification.set_never_timeout(options->require_interaction && *options->require_interaction);` applied in Create; the summary says Update does not re-apply it (so set it on `create`, don't rely on `notifications.update`).
- SOURCE, chrome/browser/notifications/win/notification_template_builder.cc (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/notifications/win/notification_template_builder.cc): `else if (notification.never_timeout()) { ... AddAttribute(kScenario, kReminder) }`. A comment says Windows ignores the reminder scenario unless there is a button, so `EnsureRemindersHasButton` adds a background-dismiss action (`IDS_APP_CLOSE`, a "Close" button) when a never-timeout notification has no buttons. So the toast will show a Close button. Silent maps to `<audio silent="true">`.
- OFFICIAL, Microsoft, https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-content : reminder scenario "the notification will stay on screen until the user dismisses it or takes action... You must provide at least one button... Otherwise, the notification will be treated as a normal notification." (consistent with the Chromium comment).
- Which path do extension notifications take on Windows? SOURCE, notification_platform_bridge_delegator.cc (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/notifications/notification_platform_bridge_delegator.cc): "Prefer the system bridge if available and it can handle |type|"; on Windows before 10 RS4 always the message center; on RS4+ system (native) notifications by default, falling back to the message center if initialisation fails. `NotificationPlatformBridge::CanHandleType` header comment: "some platforms can't handle TRANSIENT notifications"; extension notifications use handler type `EXTENSION` (extension_notification_display_helper.cc), not TRANSIENT, so they are expected to use the native Windows toast. I did NOT find the Windows `CanHandleType` body (the Windows bridge file path 404'd), so "extension notifications are native on Windows" is an inference [UNOFFICIAL].
- If it falls back to Chrome's own message-center balloon, requireInteraction would still be honoured by that UI (UNKNOWN, not checked).
- Test: create a notification with `requireInteraction: true`, leave it 2 minutes; and one without, to compare (default toasts disappear after about 5 s into the Notification Center). Bilal-only.

Do Not Disturb / Focus Assist:
- SOURCE: `notification_template_builder.cc` contains nothing about DND or Focus Assist; Chrome does not override it.
- OFFICIAL (Microsoft, same app-notifications-content page): only the "urgent" scenario can break through Focus Assist ("Do not Disturb"), needs Windows Insider build 22546 or later when written, and the user controls it in notification settings. Reminder is not described as bypassing it. Chromium never sets the `urgent` scenario for extension notifications (SOURCE: only reminder and incomingCall appear in the builder, as reported).
- Where suppressed toasts go (Notification Center?) is not confirmed in the docs I could read [UNKNOWN; widely believed to be the Notification Center, which Bilal can check].
- Also needed: Windows Settings > System > Notifications must allow "Google Chrome", and Chrome's own site settings are not involved for extension notifications (UNOFFICIAL).
- Design implication: DND silences the banner, so the phone alert (ntfy) is the backstop; mention in the manual checklist.

Install warning for `notifications`: OFFICIAL, https://developer.chrome.com/docs/extensions/reference/permissions-list lists "notifications" with the warning "Display notifications." (as reported by the fetch tool). Unpacked installs show no install dialog, so this can only be seen in the Web Store/permission dialog. `power`, `alarms`, `storage`, `scripting`, `activeTab`: no warning. Test later in Phase 8 (low priority). [My recollection is that Chrome shows nothing for notifications in the install dialog; this contradicts the list, so treat the doc as authoritative until seen.]

iconUrl:
- OFFICIAL, /notifications : `iconUrl` "A URL to the sender's avatar, app icon, or a thumbnail for image notifications." Accepts "a data URL, a blob URL, or a URL relative to a resource within this extension's .crx file." Required for `create`. The page states NO size or format requirement [docs silent].
- SOURCE, notifications_api.cc: Chrome does not fetch `iconUrl` itself in this file; the bitmap arrives decoded (`options->icon_bitmap`). It is rejected if wider than target size times max scale ("const int max_device_pixel_width = target_size_dips.width() * max_scale;") or if its RGBA length does not match its size; error text "Unable to successfully use the provided image." Missing field text: "Some of the required properties are missing: type, iconUrl, title and message."
- Windows toast image: Microsoft says the app-logo image area is 48x48 px at 100% scale, with 125/150/200/400% variants recommended (same Microsoft page); in Windows 11 the app logo itself sits in the attribution area and the extension icon goes into the appLogoOverride square (SOURCE: `kPlacementAppLogoOverride`, "only written if the icon is not empty").
- Packaged? A packaged PNG relative path is the documented, simplest form. Remote https URLs are not listed as allowed. PNG recommended (format not specified by docs [UNKNOWN]).
- Recommendation [ours]: ship `icons/icon-128.png` (a real PNG, opaque or transparent) and use `iconUrl: chrome.runtime.getURL("icons/icon-128.png")` or the relative path `"icons/icon-128.png"`. Test: 48, 128 and a 16 px version to see which looks right and whether any errors are raised in the service worker console.

Clicking a toast and bringing Chrome forward:
- OFFICIAL, /windows: `windows.update(id, {focused:true})` "brings the window to the front"; `drawAttention: true` flashes without changing focus. No statement about OS foreground rules [docs silent].
- SOURCE/UNOFFICIAL: Chromium routes Windows toast activation through `notification_helper` (a COM server) which launches or signals chrome.exe with the notification launch id (https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/notification_helper/notification_activator.h , search summary; this launches a process only when Chrome is not already handling it). A blog (UNOFFICIAL, https://dev.to/randomengy/allowsetforegroundwindow-quirks-12og) reports that apps activated from notification protocol strings often fail `AllowSetForegroundWindow` and says "Chromium worked around this issue by sending a dummy keypress event". I could not find that Chromium commit, so whether Chrome has the right to take foreground at the moment our service worker calls `windows.update` is UNKNOWN.
- Windows rule of thumb (UNOFFICIAL): the process that receives a notification click usually gets foreground rights, but a service worker call a few ms later in a background process is not guaranteed.
- Design implication: in `onClicked`: `tabs.update(tabId,{active:true})` then `windows.update(windowId,{focused:true, state: minimized ? "normal" : undefined})`; then `windows.get(windowId)` and if `focused` is still false call `windows.update(windowId,{drawAttention:true})` as fallback. Clear the notification (`notifications.clear`).
- Test (Bilal-only, real OS): put another app (e.g. Notepad, maximised) in front, fire a test notification, click it. Check: does Chrome come to the front, is the chat tab the active tab, what if Chrome was minimised, what if the chat is in another Chrome window.

## P3-Q4. chrome.power

Short answer: a service-worker stop does NOT release the keep-awake request (it is held by the browser process per extension id); unloading the extension (reload, disable, uninstall) DOES release it; browser exit obviously does. Confidence: medium-high for unload (source), medium for worker stop (absence of any hook in the source). Plus a Windows caveat that matters.

- SOURCE, extensions/browser/api/power/power_api.cc and .h (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/extensions/browser/api/power/power_api.cc , .../power_api.h):
  - One `PowerAPI` instance per profile ("requests are tracked by extension ID"; regular and incognito share it). Requests live in `extension_levels_` (map extension id to level), comment "Outstanding requests."; `requestKeepAwake` does `extension_levels_[extension_id] = level` (so a repeat call replaces, matching the docs), `releaseKeepAwake` erases the entry.
  - `PowerAPI` is an `ExtensionRegistryObserver`; `OnExtensionUnloaded` runs `RemoveRequest(extension->id())` then `UpdateWakeLock()`; `reason` is ignored, so every unload reason (reload, disable, uninstall, update) clears it.
  - No hook for background/service-worker stop appears in the file (the summary says no service worker or background host lifecycle code). So a stopped worker keeps its request. [Absence of evidence in two files; the exact worker-stop path elsewhere was not searched.]
  - Level mapping: "system" -> wake lock type `kPreventAppSuspension`; "display" -> `kPreventDisplaySleep` ("display" wins when any extension asks for it).
- SOURCE, services/device/wake_lock/power_save_blocker/power_save_blocker_win.cc (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/services/device/wake_lock/power_save_blocker/power_save_blocker_win.cc): on Windows `kPreventAppSuspension` creates a request of type `PowerRequestExecutionRequired` (`RequestType()` returns `PowerRequestDisplayRequired` only for the display types, otherwise `PowerRequestExecutionRequired`). The reason string is the `description_` passed by the caller (I did not find what text chrome.power passes).
- OFFICIAL (Microsoft, POWER_REQUEST_TYPE, https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/ne-wdm-_power_request_type and PowerSetRequest https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest , read through a search-result summary): ExecutionRequired (Windows 8+, apps only) "implies PowerRequestSystemRequired when active"; "Except for PowerRequestAwayModeRequired on Traditional Sleep (S3) systems, power requests are terminated upon user-initiated system sleep entry (power button, lid close or selecting Sleep from the Start menu)"; "On Modern Standby systems on DC power, system and execution required power requests are terminated 5 minutes after the system sleep timeout has expired." Re-verify these three sentences on the original pages before telling Bilal.
- Gotcha for the product (matters): on a Modern Standby laptop running on battery, `requestKeepAwake("system")` will stop working about 5 minutes after the sleep timeout. On AC power, or a desktop, it should hold. Lid-close/sleep button always win. Put this under Known limitations.
- Design implication: keep the plan (alarm for the 60-minute safety release, state in storage). Because the request survives worker restarts, the worker must not assume "no request" after a restart: on startup read stored state and either call `releaseKeepAwake()` (if no chat is active) or `requestKeepAwake("system")` again (harmless, replaces). Never rely on worker shutdown to release.
- Checking on Windows: `powercfg /requests` is documented as "Enumerates application and driver Power Requests" (OFFICIAL, https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options). That page says administrator rights only for `/systemsleepdiagnostics` and `/systempowerreport`; it says NOTHING about `/requests` [docs silent]. In practice (UNOFFICIAL, from experience) it needs an elevated prompt and otherwise prints an "administrator" error. Tell Bilal: right-click Start, "Terminal (Admin)" (or PowerShell as administrator), run `powercfg /requests`. Because Chrome uses ExecutionRequired, look for a chrome.exe entry under the "EXECUTION:" heading (and possibly "SYSTEM:"). Other Chrome features (video playback, Meet) also create requests, so close all other Chrome tabs/windows and compare the output before and after.
- Manual test sequence (Bilal): (1) baseline `powercfg /requests`; (2) trigger keep-awake; run again: chrome.exe listed; (3) wait 60+ s with chrome://extensions open on the extension's service worker so you can see it go "inactive" (or force-stop it from the service worker's DevTools Application panel); run again: still listed (expected); (4) reload the extension; run again: gone (expected).

## P3-Q5. Accessor property on window for "Tawk_API" and the page's `var Tawk_API = Tawk_API || {}`

Short answer: the `var` declaration KEEPS our accessor (it does not replace or redefine it), the initialiser READS through our getter, and if the getter returns a falsy value the `{}` is assigned through our SETTER. Same for `window.Tawk_API = window.Tawk_API || {}`. Confidence: high (spec text read; Chrome follows it for this case; one real-page test recommended).

Spec: ECMA-262 (current draft, https://tc39.es/ecma262/ , multipage https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html and .../ecmascript-language-scripts-and-modules.html). Section numbers are for the current draft (they shift between editions). All OFFICIAL.
1. 16.1.7 GlobalDeclarationInstantiation (script, env). For each var name: "If HasLexicalDeclaration(envRecord, name) is true, throw a SyntaxError". (No such lexical binding exists for our property.) Then for non-function var names it checks "CanDeclareGlobalVar" (TypeError if false) and records the name; at the end it performs "? CreateGlobalVarBinding(envRecord, variableName, false)" for each. (Steps paraphrased by the fetch tool; the three quoted fragments are from it.) Note `HasRestrictedGlobalProperty` is only used for let/const/class names, not var.
2. 9.1.1.4.14 CanDeclareGlobalVar(envRecord, name): `hasProperty = ? HasOwnProperty(globalObj, name)`; "If hasProperty is true, return true"; otherwise `? IsExtensible(globalObj)`. Our accessor is an own property of the global object, so it returns true. No attribute check, so accessor vs data does not matter, and configurable or not does not matter.
3. 9.1.1.4.16 CreateGlobalVarBinding(envRecord, name, deletable): `hasProperty = HasOwnProperty`, `extensible = IsExtensible`; ONLY "If hasProperty is false and extensible is true" does it create the binding (CreateMutableBinding + InitializeBinding(name, undefined)). Since the property exists, nothing happens: no redefinition, our accessor stays exactly as it is and is NOT reset to undefined.
4. Evaluating `var Tawk_API = Tawk_API || {}`: the declaration with initialiser behaves like an assignment (14.3.2 VariableStatement evaluation: ResolveBinding then PutValue, not quoted from the spec by me [the 14.3.2 text was not read]). The right-hand `Tawk_API` is resolved in the global environment; Object Environment Record 9.1.1.2.6 GetBindingValue: "Let value be ? HasProperty(bindingObj, name)... Return ? Get(bindingObj, name)" , and `Get` on an accessor property calls our getter (this = the global). If the getter returns a truthy object, `||` keeps it and the assignment writes the same object back via 9.1.1.2.5 SetMutableBinding: "Let stillExists be ? HasProperty(bindingObj, name)... Perform ? Set(bindingObj, name, value, strict)", and `Set` on an accessor calls our SETTER (so the setter is called in both the "falsy" and "truthy" cases, with the same or a new object). If there is no setter, the write is silently ignored in sloppy mode and throws a TypeError in strict mode.
5. `window.Tawk_API = window.Tawk_API || {}`: plain property Get (our getter) then Set (our setter); same semantics. Reading `Tawk_API` as a bare identifier somewhere else, or `typeof Tawk_API`, also goes through the getter. `delete window.Tawk_API` works if the accessor is configurable (and `var`-created properties are non-deletable only because CreateGlobalVarBinding creates them that way; ours is not created by it).
- Consequences for the design:
  - Install with `Object.defineProperty(window, "Tawk_API", { configurable: true, enumerable: true, get, set })` at document_start in the MAIN world. Getter returns the stored value (initially `undefined`); setter stores the value and may wrap it.
  - On sites without Tawk.to nothing ever calls the setter and `window.Tawk_API` stays `undefined`, but `"Tawk_API" in window` and `Object.keys(window)` now show the property (a small detectable footprint; fine).
  - Tawk's embed does `var Tawk_API = Tawk_API || {}` first (test-site/index.html line 14): getter returns `undefined`, `{}` is created by the page, setter receives it. Later the Tawk script (embed.tawk.to) reads and mutates `window.Tawk_API` through the getter (expected; verify). Our setter should wrap or define the callbacks on that object, and ALSO handle the site re-assigning `Tawk_API = {...}` later (the setter is called again; wrap the new object).
  - Optional clean-up: once the page has set a real object, redefine `Tawk_API` as a plain data property holding that object, so later reads/writes bypass our code. But then later full re-assignments by the site would no longer reach us; decide per test results.
  - A page that declares `let Tawk_API` or `const Tawk_API` at script top level: allowed because our property is configurable (HasRestrictedGlobalProperty returns false for configurable properties); it would shadow our accessor. Unlikely with the real snippet.
  - `function Tawk_API(){}` declarations would redefine the property (CreateGlobalFunctionBinding) and drop our accessor if it is configurable. Unlikely.
  - Making the accessor non-configurable would make `function Tawk_API` / `let` throw on the host page: do NOT do that (breaks the host site).
- Test (fake and real, 5 minutes): in the MAIN-world hook define the accessor with console logs in get/set; load test-site/index.html (real snippet) and the fake chat; check (a) set is called once with an object after the `var` line, (b) `Object.getOwnPropertyDescriptor(window,'Tawk_API')` is still an accessor afterwards, (c) the Tawk widget loads and our wrapped callbacks fire, (d) a blank page: `window.Tawk_API` is `undefined` and no error. Also run the 2-line spec check in the console: `Object.defineProperty(window,'X',{configurable:true,get(){console.log('get');return window.__x},set(v){console.log('set',v);window.__x=v}}); (0,eval)('var X = X || {}')` -> expect "get" then "set {}" and `Object.getOwnPropertyDescriptor(window,'X').get` still defined.

## P3-Q6. Version check for Chrome 154 (Bilal) and 156 (Playwright)

Everything planned is available in both 154 and 156. Nothing in the docs I could read is newer than 154 except two things we should not use. No documented 154 vs 156 difference was found. Confidence: high for versions the docs state; the docs give no version for some items (marked).

| API / feature | Min Chrome (OFFICIAL, source page) | In 154 / 156? |
|---|---|---|
| `scripting.registerContentScripts`, `getRegisteredContentScripts`, `updateContentScripts`, `unregisterContentScripts` | 96 (/scripting) | yes |
| `world: "MAIN"` | 102 (/scripting) | yes |
| `runAt: "document_start"` | no version given; general runAt value | yes; our own test (Chromium 156) shows MAIN + document_start runs before page scripts. Not yet run on real Chrome 154. |
| `persistAcrossSessions` for content scripts | no version label on the page | semantics for update/reload not documented (UNKNOWN); set explicitly to true |
| `matchOriginAsFallback` | 119 | yes (not needed) |
| `permissions.request/contains/remove/getAll` (Promise) | 96 (/permissions) | yes |
| `permissions.onAdded/onRemoved` | no version label on the page | older than 154 in practice (they date from the MV2 era) [UNOFFICIAL]; yes |
| `alarms.create` Promise | 111 | yes |
| alarms 30 s minimum | 120 (existing notes; the current page states the rule with no version) | yes |
| `AlarmCreateInfo.persistAcrossSessions` / `Alarm.persistAcrossSessions` | 150 (/alarms) | yes in both (154, 156); before 150 behaviour "can be unpredictable" |
| `AlarmCreateInfo.name` | 152 | yes in both; NOT needed, keep using the positional name argument |
| alarm names over 1024 bytes throw TypeError | 150 (https://developer.chrome.com/docs/extensions/whats-new) | yes; keep names short |
| `storage.session` | 102; quota 10 MB (1 MB in 111 and earlier) (/storage) | yes |
| `storage.session.setAccessLevel` | 102 | yes (not needed) |
| `notifications.create/clear` (Promise forms) | 116 (/notifications) | yes |
| `requireInteraction`, `silent` | 50, 70 | yes |
| `notifications.onClicked` | no version label | yes |
| `chrome.power.requestKeepAwake/releaseKeepAwake` | no version label ("available from Chrome 148" shown on the page is for the `browser.*` namespace, not for `chrome.power`) | yes |
| `runtime.onMessage` + `return true` + `sendResponse` | works in all MV3 versions; messaging page says "return a literal true" | yes |
| `onMessage` listener returning a Promise | Chrome 148, gradual rollout (messaging page) | AVAILABLE BUT NOT UNIFORM across 154/156. Do not use; keep `return true`. Do not mix async listeners with `sendResponse`. |
| `runtime.sendMessage` Promise | 99 | yes |
| `action` toolbar icon pinned to top-level toolbar experiment | 153 (whats-new), Canary experiment | irrelevant |

- Other notes: the whats-new page (as read by the tool) lists items only for 150 and 153 among 150-156, and none in 151, 152, 154, 155, 156 for our APIs. The page may be incomplete. Release notes of Chrome 155/156 were not checked individually.
- Chromium 156 is Playwright's Chrome-for-Testing build; Bilal's 154 is branded Chrome. Source-level behaviours I cite are from main (newer than both).
- Test: add a one-line `chrome://version` check to the manual checklist, and when we first run on real Chrome 154 repeat: MAIN+document_start ordering, `permissions.onAdded`, alarms persistence (create alarm, reload extension, `alarms.getAll`).

## P3-Q7. permissions.request from the popup: popup closing, onAdded, onRemoved

Short answers. Confidence: low-medium; all three need one real-Chrome test.
(a) Does the popup close when the permission prompt appears? UNOFFICIAL reports (issue 40721470, unreadable) say yes; official docs are silent. Likely on Windows because extension popups close when they lose focus (UNOFFICIAL general behaviour) and the prompt takes focus.
(b) If it closes, does the grant still happen and does `onAdded` fire in the service worker? Probably yes. SOURCE, extensions/browser/api/permissions/permissions_api.cc (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/extensions/browser/api/permissions/permissions_api.cc): `PermissionsRequestFunction` does not attach the prompt to the popup's web contents. It uses `GetNativeWindowForFunction(*this)` (a native browser window), `CreateInstallPromptForNativeWindow(... PERMISSIONS_PROMPT)` and `install_ui_->ConfirmPermissions(...)`, with `OnInstallPromptDone` doing the grant (`GrantOptionalPermissions` or `GrantRuntimePermissions`) after acceptance. The source has no handling for "web contents destroyed", so I found nothing that would cancel the prompt when the popup closes. The promise result is then lost (nobody is listening), but the grant itself is a browser-side operation.
   - `onAdded` firing: the older `permissions_updater.h` comment says `NotifyPermissionsUpdated` "sends the EXTENSION_PERMISSIONS_UPDATED notification, the UpdatePermissions message, and fires the onAdded/onRemoved events in the extension" (SOURCE via search summary of old revisions: https://chromium.googlesource.com/chromium/src/+/57f212f/chrome/browser/extensions/permissions_updater.h ). Older `AddPermissions` called `NotifyPermissionsUpdated(ADDED, ...)` and `RemovePermissionsUnsafe` called it with REMOVED. I could not read the current `permissions_updater.cc` (404 at the paths tried), so whether `GrantOptionalPermissions`/`GrantRuntimePermissions` dispatch the event today is inferred. The event goes through the extension event router, which wakes a stopped service worker if the listener is registered at the top level of the script (standard MV3 behaviour, OFFICIAL events page).
   - Official docs for /permissions say nothing about the popup or about when onAdded fires.
(c) Does `onRemoved` fire when the user removes site access in chrome://extensions > Details > Site access? UNKNOWN. SOURCE, Chromium docs extensions/docs/permissions.md (https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/permissions.md): users can grant runtime host permissions through chrome://extensions and the context menu; these are "runtime-granted permissions stored within extension preferences"; the doc does not mention the events. The old `permissions_updater.h` comments say `RevokeRuntimePermissions` "notifies observers", but I could not confirm that this means the JS event. Also an important distinction from the same doc: `chrome.permissions.remove()` removes from ACTIVE permissions but not from GRANTED permissions, so a later `request()` does not prompt again ("usually adds the permission back without prompting"). How the chrome://extensions site-access toggle interacts with an origin granted through `optional_host_permissions` (revoked or just withheld?) is not documented.
- Design implication:
  - Treat `onAdded`/`onRemoved` as hints only. Source of truth = `permissions.contains({origins:[origin]})`. Reconcile (register missing, unregister revoked) in all of: service worker startup, `onAdded`, `onRemoved`, popup open, and on each tab navigation we care about if cheap. A script registered for an origin without host access injects nothing anyway (UNOFFICIAL), so a missed `onRemoved` leaves harmless residue.
  - Popup: don't await the request result for anything essential. After the click, the UI should say "Check your browser's permission prompt"; on every popup open re-run `contains` and show the right state.
  - If the test shows the popup closes AND the grant is lost or `onAdded` doesn't fire: move the request to a small extension page opened in a tab/window (`chrome.tabs.create({url: chrome.runtime.getURL("grant.html?origin=...")})`) where a button click calls `permissions.request`; tabs don't close on focus loss. Extension pages get the user gesture from a real click.
- Test (one 5-minute manual test, real Chrome 154, unpacked build; Playwright can't click the prompt): (1) popup with a button that calls `chrome.permissions.request({origins:["https://example.com/*"]})` as the first statement; service worker with top-level `permissions.onAdded/onRemoved` listeners that append `{event, origins, time}` to `chrome.storage.local`. (2) Click the button on example.com; note if the popup closes; accept the prompt. (3) Open the service worker console or the storage: was `onAdded` logged? Is `permissions.contains` true? (4) Then chrome://extensions > Details > Site access, remove/switch the site; check `onRemoved` logged and `contains` result. (5) Repeat with `chrome.permissions.remove` from the console.

## Tests still needed from Phase 3 research (summary)
1. Real Chrome 154: popup `tab.url` with activeTab only (Q1).
2. Real Windows: requireInteraction toast stays; behaviour under Do Not Disturb; icon sizes; click raises Chrome from another app (Q3).
3. Real Chrome: popup closing + `onAdded`/`onRemoved` incl. chrome://extensions revocation (Q7).
4. Windows `powercfg /requests` (admin) before/after: after worker stop (still held) and after extension reload (released); Modern Standby on battery caveat (Q4).
5. 5-minute accessor-property test with the real Tawk snippet and the fake chat (Q5).
6. `registerContentScripts` MAIN + document_start on real Chrome 154 (Q6).
7. Playwright: forced worker stop (see playwright.md section 10).

## Live result: popup on real Chrome 154 (2026-10-13, Bilal's Chrome 154.0.8037.98, Windows 11, fake chat at 127.0.0.1)
Phase 3 step 1 build, unpacked, opened from the toolbar on http://127.0.0.1:47813/. This was the fake chat page, not a real vendor site.
- Q1 (activeTab): WORKS. The popup read the tab's address with activeTab only (it showed the site and offered "Watch chats on this site", which it only does when it has a web address).
- Q7 (popup during the prompt): the popup STAYED OPEN while Chrome's "Allow access?" prompt showed, and after Allow it showed "Watching chats on this site." Reopening the popup still said watching. So on Chrome 154 the popup's own code after the grant does run; the onAdded path remains as a backup.
- Not yet checked: whether onRemoved fires when access is removed at chrome://extensions (Q7c).

## Live result: notifications on real Chrome 155 (2026-10-14, Bilal's Chrome 155.0.8059.79, Windows 11, fake chat at 127.0.0.1)
Phase 3 step 3 build, unpacked. Fake chat page, not a real vendor site.
- The Windows notification "Agent replied on 127.0.0.1" appeared while Bilal was in another app.
- Clicking it brought Chrome to the front with the chat tab (Q3/Q6: chrome.windows.update focused works from a notification click on Windows 11).
- Quiet rule: a reply while Bilal was looking at the chat gave no notification.
- Not yet settled: whether requireInteraction keeps it on screen beyond Windows' usual few seconds (Bilal clicked after about 2 seconds).
