# Tawk.to JavaScript API research

Researched 2026-10-12. Official = developer.tawk.to or help.tawk.to. Anything else is labelled UNOFFICIAL.
Main source: https://developer.tawk.to/jsapi/ (fetched through a summariser, so exact wording was relayed, not read raw. Re-check key lines in a browser before relying on them.)

## 1. Message and agent callbacks
All are assigned as `window.Tawk_API.<name> = function(...) {...}`. Docs examples start with `window.Tawk_API = window.Tawk_API || {};`.

| Callback | Fires (docs wording) | Argument |
|---|---|---|
| `onAgentJoinChat` | "when an agent joins the chat" | `data` with `name`, `position`, `image`, `id` (field types not stated) |
| `onChatMessageAgent` | "when message is sent by the agent" | `message`, shape NOT documented |
| `onChatMessageVisitor` | "when message is sent by the visitor" | `message`, shape NOT documented |
| `onChatMessageSystem` | "when message is sent by the system" | `message`, shape NOT documented |
| `onAgentLeaveChat` | agent leaves | `data`: `name`, `id` |

- All four above are marked "not supported in pop out chat window".
- Message ID or timestamp: the docs do not mention either. The Angular wrapper docs (https://github.com/tawk/tawk-messenger-angular/blob/master/docs/api-reference.md, published by Tawk) type the argument as `any` and say to check the payload at runtime.
- `onAgentJoinChat` `data.id` is the agent's ID, not a message ID. It cannot dedupe messages on its own.
- UNCERTAIN: whether the message object has any id or time field. Needs a runtime test (see tests).

## 2. Replay of old messages on reload
NOT documented anywhere I found (developer.tawk.to, help.tawk.to, wrapper docs). Searches for community threads found nothing. Do not assume either way. See Test A.

## 3. Other callbacks and methods (all from https://developer.tawk.to/jsapi/)
Callbacks:
- `onBeforeLoad()`: when Tawk_API is ready to use, before the widget renders. No args. Not supported in pop-out.
- `onLoad()`: right after the widget renders. No args. Not supported in pop-out.
- `onStatusChange(status)`: `"online"`, `"away"` or `"offline"`. Not supported in pop-out.
- `onChatMaximized()`, `onChatMinimized()`, `onChatHidden()`: no args. Not supported in pop-out.
- `onChatStarted()`: "when the widget is started". Pop-out support not stated.
- `onChatEnded()`: "when the widget is ended". Not supported in pop-out.
- `onPrechatSubmit(data)`, `onOfflineSubmit(data)` (`{name, email, message, questions[]}`), `onChatSatisfaction(satisfaction)` (-1/0/1), `onVisitorNameChanged(visitorName)`, `onFileUpload(link)`, `onTagsUpdated(data)`, `onTranscriptRequest(email)`.
- There is NO `onUnreadCountChanged` in the docs I read.
- The docs wording for `onChatStarted`/`onChatEnded` ("widget is started/ended") is vague. It is unclear whether "started" means the visitor's first message or the widget connecting. The docs also describe `onChatSatisfaction` inconsistently (one line says it fires when an agent leaves). Both need runtime tests.

Methods for reading state: `getStatus()` returns `online`/`away`/`offline`. `isChatOngoing()` returns true if a chat is in progress. `isVisitorEngaged()` returns true if the visitor is chatting or has requested a chat. `isChatMaximized()`, `isChatMinimized()`, `isChatHidden()` return booleans. `getWindowType()` returns `inline` or embed (docs: "inline or embed").
Other methods: `start({showWidget})`, `shutdown()`, `login`, `logout`, `switchWidget`, `maximize/minimize/toggle`, `popup()`, `showWidget/hideWidget/toggleVisibility`, `endChat()`, `setAttributes`, `setChatInputMessage`, `addEvent`, `addTags`, `removeTags`. Properties: `autoStart` (default true), `visitor`, `customStyle`.
Note: `visitor` and `customStyle` must be set before the widget script downloads (docs). Later changes are ignored. This is the only documented "timing" rule and it applies to those two properties, not callbacks.

## 4. How callbacks are attached
NOT documented. The docs do not say whether Tawk reads `Tawk_API.onX` when firing or copies it at load, nor whether the loaded script keeps or replaces the `Tawk_API` object.
Related facts:
- Official help page https://help.tawk.to/article/how-to-add-multiple-widgets-to-a-website-with-javascript says all widget scripts "use the same global object (Tawk_API)". This hints the object is shared, but does not say it is kept.
- The documented pattern (`Tawk_API = Tawk_API || {}` then assign) assumes the snippet's object persists, since the snippet itself creates it before the script loads.
Safe-wrapping implication (an inference, not documented): define `Tawk_API.onX` as an accessor property (getter/setter) so we hold whatever the site sets, before or after, and call it from our wrapper. Fall back if Tawk replaces the object (poll/re-check `window.Tawk_API` identity). Needs Tests B and C.
(Superseded as the preferred design by section 8 below: listen to window events instead of touching Tawk_API.)

## 5. Limits
- Pop-out: nearly every callback is documented "not supported in pop out chat window". `onChatStarted`, `onTagsUpdated`, `onTranscriptRequest` are not stated. A pop-out is a separate window, so the main page's hook would not see its events anyway (inference).
- Several tabs on the same site: NOT documented. Test D.
- Widget in an iframe / do callbacks fire in the top page: NOT documented (the JS API page does not cover iframes). The widget UI is itself rendered in iframes by Tawk (UNOFFICIAL observation, check in DevTools), but `Tawk_API` lives on the host page's window. Test E.
- Mobile vs desktop: NOT documented on the JS API page. (Mobile apps are separate from the embedded widget.)
- Docs say nothing about replay, ordering, or message content for the callbacks.

## 6. Dashboard questions
(a) Yes. Official: "These become your default Property Name and Property URL, which you can edit at Administration > Overview." https://help.tawk.to/article/the-difference-between-properties-chat-pages-and-profile-pages
   - A search-summary claimed another article says "Site URL" is internal only. I could not confirm that in the article text. Treat as UNVERIFIED. The Overview page shows Name, Image, ID, Status, URL (https://help.tawk.to/article/adding-additional-websites-to-the-dashboard).
(b) Yes. Administration > Chat Widget > Availability Restriction > Domain Restriction > Configure. Toggle on, then choose "SHOW widget only on specific domains and/or URLs" or "HIDE widget on specific domains and/or URLs". Enter domains without http(s)://. Changes may take a few minutes. https://help.tawk.to/article/restricting-the-chat-widget-from-showing-on-specific-domains and https://help.tawk.to/article/restricting-your-widget-by-platform-domain-or-country
   - Default: the docs do not state it. Switching it on reveals the options, which implies off by default. Your own result (works on localhost:8080) is consistent with off. Don't treat as documented.
   - UNOFFICIAL: a tawk.to community post (https://community.tawk.to/t/support-localhost-in-availability-restriction-domain-restriction/13786) says restriction lists only accept public domains, so localhost can't be added. Not read in full.
(c) Official: "When your widget is offline, visitors will see the Offline Form" and can submit a message. Customizable under Chat Widget > Widget Content > Offline state. https://help.tawk.to/article/using-the-offline-form
   - OBSERVED 2026-10-13 (real widget, Bilal's account): with the agent set to Away, the widget still offered live chat, not the Offline Form. Invisible not tested.
   - Widget goes offline automatically only if "Widget offline when all Agent(s) offline" is turned on in Visibility Settings (reported by search summary of https://help.tawk.to/article/the-difference-between-online-away-and-invisible, not read in full). A Widget Scheduler overrides it. Possible "hide widget when offline" option: not confirmed.

## Recommended tests on http://localhost:8080 (real widget; paste into DevTools console or add to a temporary script)
Each handler should just `console.log(name, JSON.stringify(arg))`.
- Test A (replay): set handlers in a snippet before the Tawk script. Chat as visitor, have the agent reply from the dashboard, reload the page, and watch whether `onChatMessageAgent`/`Visitor`/`Agent join` fire for old messages. Also record the full message object shape and whether it has an id or time.
- Test B (post-load assignment): after `onLoad`, set `Tawk_API.onChatMessageAgent` in the console, have the agent reply, and see if it fires.
- Test C (object identity): in the snippet, save `window.__t = Tawk_API`. After `onLoad`, check `window.__t === window.Tawk_API`. Also set a handler before load and check it still exists after load.
- Test D (two tabs): open two tabs on the site, send an agent reply, and see which tabs log.
- Test E (iframe): check `window.Tawk_API` exists in the top page only (and in frames); log from top page when widget is used.
- Test F: log `onChatStarted`/`onChatEnded`/`onStatusChange` timing, and call `isChatOngoing()` / `isVisitorEngaged()` at each step.

## 7. Live test results (REAL Tawk.to widget, 2026-10-13)
Source: test-site/probe.html (logs every callback) on http://localhost:8080, run in Claude Code's built-in Chromium browser. Bilal replied as the agent from the Tawk.to dashboard. Desktop layout, widget maximised. These are observations from one account on one day, not documented guarantees. They answer the "NOT documented" items in sections 1, 2, 4 and 5 above.

Callback arguments (answers section 1):
- `onChatMessageVisitor` and `onChatMessageAgent` get `{ message: "<text>", attachments: [] }`. No message ID, no timestamp.
- `onAgentJoinChat` gets `{ name, position, image, id }`. `id` is the agent's ID (example `"6acd6103a9b845a5a533b885"`), `position` was `""`.
- `onChatStarted` gets `{ chatId: "<uuid>" }`, although the docs say it gets nothing.
- Order when the visitor sent the first message (probe log, 1 ms apart): `onUnreadCountChanged(0)`, then `onChatMessageVisitor`, then `onChatStarted`.
- `onBeforeLoad` and `onLoad` get nothing. `onStatusChange` got `"online"`.
- `onChatMessageSystem` never fired, including when the agent joined.
- `onUnreadCountChanged(count)` EXISTS, although it is not in the docs. It fired with 0 when the visitor sent a message, then 1, 2, 3 as agent replies arrived, and sometimes reset to 0 about 1.2 s later. When it resets wasn't consistent, so don't rely on it.

Replay of old messages (answers section 2):
- After a page refresh with an ongoing chat (agent had joined and replied twice), and in a second tab opened on the same chat: NO `onChatMessageVisitor`, `onChatMessageAgent` or `onAgentJoinChat` fired for the old messages, even though the widget showed them.
- `onChatStarted` DOES fire again on every page load of an ongoing chat, with the same `chatId`, before `onLoad`. So it must not be treated as "a new chat started".
- Not tested: refreshing with the widget minimised, or after the chat has ended.

Load order and state (one run, times since page start):
- `onBeforeLoad` (~75-115 ms), then `onStatusChange("online")` (~85-130 ms), then `onChatStarted` if a chat exists (~250-290 ms), then `onLoad` (~715-970 ms).
- `getStatus()` returns `""` before `onLoad` and `"online"` after.
- `isVisitorEngaged()` becomes true when the visitor sends a message.
- `isChatOngoing()` stays false after the visitor's message and after the agent joins. It becomes true only at the first agent message, and is true at `onLoad` when reloading an ongoing chat.

How callbacks are attached (answers section 4). This matters most for the hook design:
- Tawk.to keeps the `Tawk_API` object from the snippet (same object after `onLoad`). It does not overwrite handlers set before it loads.
- Tawk.to reads each `Tawk_API.onX` ONCE, when its script starts (the getter was read at 55 ms, before `onBeforeLoad`), and keeps its own copy.
- Replacing `Tawk_API.onChatMessageAgent` after load has NO effect, whether by plain assignment or by `Object.defineProperty` with a getter. The original function kept firing.
- A getter/setter defined BEFORE Tawk.to loads works. The site's later assignment (still before Tawk.to loads) went to our setter, Tawk.to read our wrapper through the getter, and on an agent reply our wrapper fired and then called the site's handler, in the same tick.
- Consequence: the hook must be installed before Tawk.to's script runs (`document_start`). If it runs later, the callbacks can't be attached and only the HTML fallback would work.

Several tabs and frames (answers section 5):
- Two tabs open on the same chat: BOTH fired `onChatMessageAgent` (and `onUnreadCountChanged`) for every agent reply, at the same moment. Alerts must be de-duplicated across tabs.
- The widget's 5 iframes are same-origin `about:blank` frames with no `Tawk_API` of their own. Callbacks fire in the top page only.

## 8. Window events and reading callbacks (2026-10-14)

Labels: OFFICIAL-DOCS = developer.tawk.to / help.tawk.to page text. VENDOR-CODE = source in Tawk's own GitHub org (github.com/tawk), real code Tawk publishes, but NOT documented as a public API on developer.tawk.to. UNOFFICIAL = anything else. UNKNOWN = needs a live test. Source files were read through a summarising fetch tool (raw.githubusercontent.com), so quoted lines are as the tool reported them; re-read one in a browser before final reliance.

### 8.1 Does Tawk.to dispatch DOM events on window? Short answer: YES in practice (VENDOR-CODE), but NOT documented on developer.tawk.to.

OFFICIAL-DOCS says nothing about it. https://developer.tawk.to/jsapi/ : the tool found no mention of CustomEvent, addEventListener, tawkLoad or any DOM/window event. The only mechanism the page describes is assigning functions to `window.Tawk_API.onX`. The React wrapper's api-reference.md (https://github.com/tawk/tawk-messenger-react/blob/master/docs/api-reference.md) also says "None are mentioned" for window events / CustomEvent / detail (its only "event" word is `tawkAddEvent`, which is the chat API, not a DOM event). A general web search found no page documenting these event names (search tool: "I couldn't find any evidence that tawk.to fires window events named tawkLoad ..."). So: undocumented.

VENDOR-CODE evidence that they exist: Tawk's own wrappers do not set `Tawk_API.onX` at all; they listen with `window.addEventListener('tawk...')`. Read:
- React: https://raw.githubusercontent.com/tawk/tawk-messenger-react/master/src/index.js , function `mapCallbacks()` (JSDoc above it: "API for listening an event emitting" / "inside of the widget"). 20 `window.addEventListener` calls, all on `window`, none on `document`. The tool reports the file uses `window.Tawk_API` only for the placeholder object (`window.Tawk_API || {}`), `customStyle`, `embedded`/`autoStart` and imperative methods, and reads `window.Tawk_API.onLoaded` / `onBeforeLoaded` for the "is it ready" getters (see the doubt in 8.1.4).
- Angular: https://raw.githubusercontent.com/tawk/tawk-messenger-angular/master/projects/tawk-messenger-angular/src/lib/tawk-messenger-angular.ts : the `onX` methods call `window.addEventListener` with the same 20 names, e.g. `window.addEventListener('tawkChatMessageAgent', (message?: any) => {`.
- Vue 3: https://raw.githubusercontent.com/tawk/tawk-messenger-vue-3/main/src/lib/index.js , `provideListeners()`, same 20 names, e.g. `window.addEventListener('tawkChatMessageAgent', (message) => {`. "Tawk_API is not used for listening."
- Vue 2 not read (my guessed file path 404'd).

Because the wrappers set no `Tawk_API.onX` callbacks and still deliver events to the app's props, the widget must dispatch these events itself. This is an inference from wrapper design, not a statement by Tawk.

#### 8.1.1 Exact event names (VENDOR-CODE, identical in React, Angular, Vue 3). Mapping to the callbacks you asked about:

| Tawk_API callback | window event name | Value the wrapper passes on |
|---|---|---|
| onBeforeLoad | `tawkBeforeLoad` | nothing |
| onLoad | `tawkLoad` | nothing |
| onStatusChange | `tawkStatusChange` | `event.detail` |
| onChatStarted | `tawkChatStarted` | nothing (but live callback gets `{chatId}`; see 8.1.3) |
| onChatEnded | `tawkChatEnded` | nothing |
| onChatMessageVisitor | `tawkChatMessageVisitor` | `event.detail` |
| onChatMessageAgent | `tawkChatMessageAgent` | `event.detail` |
| onAgentJoinChat | `tawkAgentJoinChat` | `event.detail` |
| onAgentLeaveChat | `tawkAgentLeaveChat` | `event.detail` |

Others in the same list: `tawkChatMaximized`, `tawkChatMinimized`, `tawkChatHidden`, `tawkPrechatSubmit` (detail), `tawkOfflineSubmit` (detail), `tawkChatMessageSystem` (detail), `tawkChatSatisfaction` (detail), `tawkVisitorNameChanged` (detail), `tawkFileUpload` (detail), `tawkTagsUpdated` (detail), `tawkUnreadCountChanged` (detail). The naming rule is plain: `onFooBar` becomes `tawkFooBar`. Note `tawkUnreadCountChanged` is in the wrappers although `onUnreadCountChanged` is not in the JS API docs (matches our live finding in section 7). `tawkOnTranscriptRequest` has no event in the wrappers.

#### 8.1.2 Where the data is
- The wrappers read `event.detail` (so these are `CustomEvent`s). Events with no argument call the prop with no argument (the wrapper ignores detail for them).
- Shape of `detail`: not stated anywhere. The wrappers' docs describe the props with the same arguments as the callbacks (React api-reference: agent data "(name, position, image, id)", visitor/agent message "Receive the message"). It is most likely the same value the callback gets (live: `{message, attachments}`), but this is an INFERENCE. UNKNOWN until a live test logs `event.detail`.

#### 8.1.3 Fire even when the site set no callback?
- Evidence says yes: the wrappers register no `Tawk_API.onX` and only use window listeners (VENDOR-CODE, inference as above). UNKNOWN (live test): confirm on a page whose snippet sets no callbacks at all.
- Also UNKNOWN: whether the event fires IN ADDITION to the site's callback or instead of it (the wrappers don't set callbacks so they cannot tell us). Expect "in addition"; confirm.
- Target: all wrapper listeners are on `window`, none on `document` (VENDOR-CODE). A listener on `window` in the MAIN world is enough. Whether the event bubbles / is dispatched on `document` too: UNKNOWN (doesn't matter if we listen on `window`, but if the widget dispatches on `document` with bubbles the window listener also receives it, and if dispatched directly on `window` only a window listener works. Use `window`).
- `onChatStarted`: the live callback gets `{chatId}`. The wrapper ignores detail for `tawkChatStarted`, so whether the event has `detail.chatId` is UNKNOWN.

#### 8.1.4 Since when
- React wrapper first commit bdcb772, 2021-12-02, already has 19 `tawk...` window listeners (`tawkLoad`, `tawkStatusChange`, `tawkChatMessageVisitor`, ... `tawkTagsUpdated`). Commit 03c9fb5, 2021-12-27, shows 20 (adds `tawkUnreadCountChanged`). The 2023-05-13 commit 05b61a6 and the 2024-09-25 commit 913746f still use the same listeners. Source: https://github.com/tawk/tawk-messenger-react commits (via api.github.com). So the widget has dispatched these since at least December 2021 (VENDOR-CODE, inference from the wrapper). The Tawk-side first release of these events is UNKNOWN.
- Doubt to check: the React wrapper's `tawkOnLoaded` / `tawkOnBeforeLoaded` getters return `window.Tawk_API.onLoaded` / `onBeforeLoaded`. These are NOT in the JS API docs. They hint Tawk's script sets `Tawk_API.onLoaded` / `onBeforeLoaded` flags (probably "has loaded" booleans) and are useful for a late-start check. UNKNOWN meaning; do not rely on them.

#### 8.1.5 Pop-out windows
- developer.tawk.to marks nearly every callback "This callback is not supported in pop out chat window" (onLoad, onStatusChange, onBeforeLoad, onChatMaximized/Minimized/Hidden, onChatEnded, onPrechatSubmit, onOfflineSubmit, the three onChatMessage*, onAgentJoinChat, onAgentLeaveChat, onChatSatisfaction, onVisitorNameChanged, onFileUpload). `onChatStarted`, `onTagsUpdated`, `onTranscriptRequest` have no such note (OFFICIAL-DOCS, https://developer.tawk.to/jsapi/). The React api-reference repeats the same notes for the props.
- Nothing says whether the matching window events work in a pop-out. UNKNOWN. Likely the same limit, and the pop-out is another window that our hook would not be injected into on the host site. Not important for the main-page use case.

#### 8.1.6 Design consequences (our reasoning)
- Listening with `window.addEventListener('tawkChatMessageAgent', fn)` does not touch `Tawk_API` at all. The site's `Tawk_API.onX = Tawk_API.onX || mine` and `typeof ... !== 'function'` patterns see their own values, so the problem the reviewer found goes away. The `window.Tawk_API` accessor and the callback wrappers could be removed for Tawk.
- Because we are a passive listener, the "install before Tawk.to's script reads the callbacks" constraint (section 7) is probably gone, but we must still register before the events fire. Register at `document_start` anyway, before `tawkBeforeLoad` (~75 ms after the Tawk script starts).
- Dedupe: we may also see an event and the matching callback. We would only subscribe to events, so no double counting from that. Multiple tabs still all fire (section 7).
- Risk: the events are undocumented, so Tawk could change them without notice. Mitigation: keep the existing callback wrapper as a fallback, started only if no `tawkLoad` / `tawkBeforeLoad` window event arrives within a few seconds after Tawk's script appears. That fallback would reintroduce the site-visible getter, so decide with Bilal.

#### 8.1.7 Live test for 8.1 (real widget, 5 minutes, test-site/probe.html style)
1. Snippet that sets NO `Tawk_API.onX` callbacks (just `var Tawk_API = Tawk_API || {}`), plus a script before it that logs every `window` event whose type starts with `tawk` (use the 20 names from 8.1.1) with `JSON.stringify(e.detail)`, `e.constructor.name`, `e.bubbles`, `e.target === window`, `e.isTrusted`, and `performance.now()`.
2. Visitor sends a message; agent joins; agent replies; agent leaves; end chat; reload with an ongoing chat. Record: do the events fire with no callbacks set; the detail shape of each; whether `tawkChatStarted` has `detail.chatId`; whether old messages fire as events after reload (callbacks did not).
3. Repeat with callbacks also set, and compare counts and order (event vs callback) per message.
4. Also check the events fire if the listener is added AFTER `tawkLoad` (late start), and in a second tab.

### 8.2 If there were no events: telling Tawk's own read of `Tawk_API.onX` from the site's reads
Only needed if the live test in 8.1.7 disproves the events. Short answer: NOT documented; only a live test can settle it. Do not build on it unless needed.
- Script URLs: the embed snippet loads `https://embed.tawk.to/<propertyId>/<widgetId>` (VENDOR-CODE, https://raw.githubusercontent.com/tawk/tawk-messenger-react/master/src/utils/widget.js : "script.src = `https://embed.${basePath}/${propertyId}/${widgetId}`;" inserted with "firstScript.parentNode.insertBefore(script, firstScript);"; default basePath `tawk.to`). What that script loads next: UNKNOWN. Fetching `https://embed.tawk.to/` directly returned 404 and I did not fetch a real property's script. The multiple-widgets help page (https://help.tawk.to/article/how-to-add-multiple-widgets-to-a-website-with-javascript) says only that all widget scripts use the same `Tawk_API` global.
- Top-level or later: UNKNOWN. Our live finding (section 7) says the getter was read ~55 ms after page start and before `onBeforeLoad`, which is consistent with a read at script start, but we did not record `document.currentScript` or a stack.
- Live test: in a getter on each `onX`, log `document.currentScript && document.currentScript.src`, `new Error().stack` (it shows the calling script's URL and whether it is the top-level frame or an async callback), `performance.now()`, and count the reads. Compare reads by the site's own code (e.g. a site snippet doing `Tawk_API.onLoad = Tawk_API.onLoad || mine`) with reads by Tawk. If the stack file URLs are on `embed.tawk.to` / `*.tawk.to`, a stack check works but is fragile (needs the stack to be exposed and not minified into the site's bundle) and `Error.stack` is not a standard. If `document.currentScript` is the tawk script on the one read, that is a cleaner signal; if it is null, it is not usable.
- Alternative that needs no knowledge: a one-shot getter that returns a wrapper only on the FIRST read after `<script src*="embed.tawk.to">` exists in the DOM, and undefined/original otherwise, would still be visible to the site's own reads that happen in that window, so it does not fully solve the problem. Prefer the events.
