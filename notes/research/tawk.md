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
   - Widget goes offline automatically only if "Widget offline when all Agent(s) offline" is turned on in Visibility Settings (reported by search summary of https://help.tawk.to/article/the-difference-between-online-away-and-invisible, not read in full). A Widget Scheduler overrides it. Possible "hide widget when offline" option: not confirmed.

## Recommended tests on http://localhost:8080 (real widget; paste into DevTools console or add to a temporary script)
Each handler should just `console.log(name, JSON.stringify(arg))`.
- Test A (replay): set handlers in a snippet before the Tawk script. Chat as visitor, have the agent reply from the dashboard, reload the page, and watch whether `onChatMessageAgent`/`Visitor`/`Agent join` fire for old messages. Also record the full message object shape and whether it has an id or time.
- Test B (post-load assignment): after `onLoad`, set `Tawk_API.onChatMessageAgent` in the console, have the agent reply, and see if it fires.
- Test C (object identity): in the snippet, save `window.__t = Tawk_API`. After `onLoad`, check `window.__t === window.Tawk_API`. Also set a handler before load and check it still exists after load.
- Test D (two tabs): open two tabs on the site, send an agent reply, and see which tabs log.
- Test E (iframe): check `window.Tawk_API` exists in the top page only (and in frames); log from top page when widget is used.
- Test F: log `onChatStarted`/`onChatEnded`/`onStatusChange` timing, and call `isChatOngoing()` / `isVisitorEngaged()` at each step.
