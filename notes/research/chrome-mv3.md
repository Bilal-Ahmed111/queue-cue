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
- Windows-specific: the official page lists no Windows behaviours other than the priority note. Anything about Windows Focus Assist / Do Not Disturb / notification centre / Chrome notification settings is not covered [docs silent]. Manual check on Bilal's PC.
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
