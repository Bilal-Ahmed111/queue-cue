# Progress: Queue Cue

Current phase: 3 (Core build, Tawk.to): plan approved 2026-10-13 (Bilal took all five recommendations, see Decisions); steps 0 and 1 done; next is step 2 (hook, Tawk.to detector and relay). Phase 1 done 2026-10-13. Phase 2 done 2026-10-13.
Bilal's Chrome: 154.0.8037.98 (Stable). Tests use Playwright's Chromium 156, so flag any feature newer than 154. Run tests with: npm.cmd test (in PowerShell, plain "npm test" is blocked because Windows won't run the npm.ps1 script; npm.cmd is the same npm without that block)

Key: [ ] to do, [x] done. Owner in brackets.

## Phase 1: Setup
- [x] GitHub repo created and pushed (Claude Code, with Bilal's OK): github.com/Bilal-Ahmed111/queue-cue
- [x] Free Tawk.to account created (Bilal)
- [x] Agent status set to Online in the Tawk.to dashboard. If no agent is online, visitors get a leave-a-message form instead of live chat (Bilal)
- [x] Tawk.to embed code pasted into Claude Code (Bilal) and saved as test-site/index.html (Claude Code)
- [x] Test site served locally with the chat widget visible. If it won't load locally, host it on GitHub Pages instead (Claude Code + Bilal). Works at http://localhost:8080 (python -m http.server, set up in .claude/launch.json); checked in Claude Code's built-in browser
- [x] Research: Tawk.to JavaScript API. Verify onAgentJoinChat, onChatMessageAgent and onChatMessageVisitor, what each passes, and limits such as pop-out chat windows. Save to notes/research/tawk.md (researcher). Live test with the real widget done (section 7): old messages don't replay on refresh; no message ID; Tawk.to reads handlers once at load, so the hook must run at document_start; every open tab fires, so alerts must be de-duplicated across tabs
- [x] Research: Chrome Manifest V3 essentials for this design (per-site optional permissions, registerContentScripts in the MAIN world, service worker lifetime, alarms, power, notifications). Save to notes/research/chrome-mv3.md (researcher). Open questions listed in the file; settle them with tests in Phases 2 and 3
- [x] Research: Playwright testing with an unpacked extension. Save to notes/research/playwright.md (researcher). Tests can't click Chrome's permission prompt; plan for this in Phase 2

### Manual checks (reviewer adds)
Note: the test page only loads while Claude Code has started the local server (ask it to "start the test-site server"). If the page says "can't be reached", the server isn't running; that's not a bug.
- [x] Open http://localhost:8080 in your own Chrome (not Claude Code's browser). You should see the "Queue Cue Test Site" heading and, after a few seconds, the Tawk.to chat button in the bottom corner.
- [x] Click the chat button and send a message such as "hello". With your Tawk.to dashboard open in another tab and set to Online, the message should appear there, and a reply you type in the dashboard should appear in the test page's chat window.
- [x] Set your dashboard status to Away or Invisible, refresh the test page and open the chat. You should get the leave-a-message form instead of live chat. Set yourself back to Online afterwards. Result (2026-10-13): with Away, live chat was still offered, not the form. Not a problem for Queue Cue, which only reacts once an agent joins or replies.
- [x] Open http://localhost:8080/probe.html, chat and reply from the dashboard. Each event should appear as a new line in the list on the page (for example one containing onChatMessageAgent with your reply text).
- [x] Open https://github.com/Bilal-Ahmed111/queue-cue after Claude Code has pushed. You should see the notes/research and test-site folders. (Right now 10 commits are saved only on this PC.)

## Phase 2: Fake chat and automated tests
- [x] Fake chat page in test/fake-chat/ that fires agent-joined, agent-message and visitor-message events at the press of a button, matching the real API as described in the research notes
- [x] Playwright installed with its bundled Chromium; a first test loads the extension successfully. Browsers live inside node_modules (test/playwright.env) because Chromium won't start from AppData on this PC
- [x] Dev-mode alert log that tests can read (on only in the test copy, test/.build/extension)
- [x] Reviewer: first "try to break it" tests written; verdict PASS (first review FAIL on two test-tool bugs, fixed; second review PASS, 45 tests passing)

### Manual checks (reviewer adds)
Note: `npm.cmd test` starts its own copy of the fake chat page and stops it when the tests finish. To open the page yourself, first run `node test/serve.js` in a terminal in the project folder and leave that window open (press Ctrl+C to stop it). Nothing in this phase shows real notifications yet; that comes in Phase 3.
- [x] In a terminal in the project folder, run `npm.cmd test`. After about a minute it should end with lines like "45 passed" and "1 skipped" (the skipped one is a slow 40-second test that only runs when asked for), and no "failed" line. (If you see "spawn UNKNOWN", it was started some other way; use exactly `npm.cmd test`.) Result (2026-10-13): 45 passed, 1 skipped, 32 s. Plain `npm test` was blocked by PowerShell ("running scripts is disabled"); `npm.cmd test` works.
- [x] Run `node test/serve.js`, then open http://127.0.0.1:47813/ in your own Chrome. You should see "Fake Tawk.to Chat" with buttons, and a small "Fake chat (online)" box in the bottom-right corner.
- [x] Click "Visitor sends a message", then "Agent joins", then "Agent sends a message". The box should list "You: Visitor message 1" and "Test Agent: Agent reply 1".
- [x] Refresh the page. The same messages should still be in the box (the fake remembers the chat, like the real widget).
- [x] Open http://127.0.0.1:47813/ in a second tab and click "Agent sends a message" there. Switch back to the first tab: a second "Test Agent: Agent reply 1" line should show there too, without refreshing (each tab numbers its own clicks, so the number repeats).
- [x] Click "End chat" (the box should say "Chat ended"), then "Forget the chat" (the box empties). Stop the server with Ctrl+C when done.
- [x] Open chrome://extensions in your own Chrome, turn on Developer mode, click "Load unpacked" and choose the project folder (the one with manifest.json). "Queue Cue" should appear with no red "Errors" button. It does nothing visible yet. Remove it afterwards if you like.

## Phase 3: Core build (Tawk.to)
Plan (approved 2026-10-13), one commit per step: 0 research; 1 popup and site permission; 2 hook, Tawk.to detector and relay; 3 alerts (duplicates, quiet rule, notifications, click to focus); 4 keep-awake; 5 reviewer.
- [x] Research: activeTab for reading the current tab's address in the popup; forcing a service worker stop in Playwright; Windows notes for notifications (requireInteraction). Smoke test: tab visible/focused in Playwright (researcher + Claude Code). Notes in chrome-mv3.md and playwright.md ("Phase 3 research"). Smoke test: under Playwright every page claims to be visible and focused, but chrome.tabs knows the real active tab (test/e2e/smoke-focus.spec.js)
- [x] Popup "Watch chats on this site" button: per-site permission, content scripts registered for that site (src/popup/, src/background/sites.js; tested with the fake chat in test/e2e/popup.spec.js. The real "Allow access?" prompt and activeTab are manual checks)
- [x] Popup "Stop watching this site" button (approved 2026-10-13)
- [x] Placeholder icons in icons/ (Chrome needs one for notifications; real icons in Phase 8)
- [ ] Hook (MAIN world) and relay (ISOLATED world)
- [ ] Tawk.to detector for agent joined and agent message (HTML fallback only if official events fail)
- [ ] Desktop notification naming the site; clicking it brings the chat tab to the front; quiet only when the chat tab is visible and focused
- [ ] No alerts for old messages after a page refresh; no duplicate alerts
- [ ] PC kept awake while a chat is active, and always released afterwards
- [ ] All tests pass; reviewer PASS; committed

### Manual checks (reviewer adds)

## Phase 4: Real-world test (Bilal)
- [ ] Extension loaded: chrome://extensions, Developer mode on, Load unpacked, then choose the folder that contains manifest.json (not the folder above it)
- [ ] Phase 3 manual checklist completed in the real Tawk.to chat (reply as the agent from the dashboard in another tab, or from the Tawk.to phone app)
- [ ] If no notification appears, check the computer's notification settings for Chrome and Do Not Disturb before blaming the code
- [ ] Any problems reported to Claude Code with the exact error text (chrome://extensions, then the Errors button), fixed and re-tested
- [ ] Committed: "Tawk.to version working"

## Phase 5: Phone alerts (ntfy)
- [ ] Random topic generated on install; shown in settings with a copy button
- [ ] "Send test alert" button in settings
- [ ] Alert text is "Agent joined on [site]" or "Agent replied on [site]", never message content
- [ ] ntfy app installed on the phone, subscribed to the topic, test alert received (Bilal)
- [ ] Tests pass; reviewer PASS; manual checks done; committed

### Manual checks (reviewer adds)

## Phase 6: Timeout nudge
- [ ] Second alert if Bilal hasn't replied within a set time (default 3 minutes, adjustable in settings), using chrome.alarms
- [ ] Nudge cancelled when Bilal replies or returns to the chat tab
- [ ] Tests pass; reviewer PASS; manual checks done; committed

### Manual checks (reviewer adds)

## Phase 7: Zendesk
- [ ] Zendesk free trial started only now, as it's time-limited (Bilal)
- [ ] Research: Zendesk messaging widget (zE "messenger:on" with "unreadMessages") and Classic widget (zE "webWidget:on" with "chat:unreadMessages"). Save to notes/research/zendesk.md (researcher)
- [ ] Detectors for both widgets; shared core unchanged
- [ ] Check whether the unread event still fires when the chat window is open but the tab is in the background. If it doesn't, use the HTML fallback for that case
- [ ] Tests pass; reviewer PASS; manual checks done; committed

### Manual checks (reviewer adds)

## Phase 8: Publish
- [ ] Privacy policy on GitHub Pages: what the extension reads, that only a short alert goes to ntfy, and that nothing is stored anywhere else
- [ ] Icons; a name without "Zendesk" or "Tawk.to" in it; the description says "works with"
- [ ] README for the GitHub repo
- [ ] CHROMEWEBSTORE.md: everything the Chrome Web Store listing asks for, including a reason for each permission (format from the Chrome team's chrome-extensions skill, Modern Web Guidance). Added 2026-10-13 at Bilal's request
- [ ] Screenshots and a 30-second demo video (Bilal)
- [ ] Chrome Web Store developer account (one-time fee) and submission (Bilal)

## Open questions for Phases 2-3 (from the Phase 1 review)
- Hook timing: Tawk.to reads its callbacks once at load, so the MAIN-world hook must run first. SETTLED in Phase 2: a registered MAIN-world script at document_start runs before the page's scripts (Playwright's Chromium 156, fake chat). Still to do: avoid creating Tawk_API on non-Tawk sites (e.g. a getter/setter on window.Tawk_API itself). Confirm one-time reading for onAgentJoinChat too.
- A site handler set after Tawk.to has loaded is normally never called, but our wrapper would call it. DECIDED 2026-10-13: copy Tawk.to, don't call it.
- De-duplication: no message ID, and every open tab fires. Settle messageKey (e.g. chatId + text hash + short time window) and guard against two tabs writing to storage at once. Quiet rule and keep-awake must work with several tabs of one chat.
- onChatStarted fires again on every reload, so it doesn't mean a new chat. Not yet tested live: onChatEnded, and replay when the widget is minimised or the chat has ended.
- Tests can't click Chrome's permission prompt: DONE in Phase 2, tests use a test copy with the fake chat pre-granted (test/e2e/global-setup.js). The real prompt goes on the Phase 3 manual checklist.
- Under Playwright the service worker did not stop after 40 s idle, so restart recovery can't be tested by waiting. Research done (playwright.md section 10): Playwright's debugger keeps it alive; force a stop with CDP ServiceWorker.stopWorker or Target.closeTarget. Try it in step 3.
- chrome.power (research, from Chromium source): a service worker stop does NOT release keep-awake; an extension reload or disable does. Unverified: on Modern Standby laptops on battery, Windows may cancel the request about 5 minutes after the sleep timeout. Manual check with `powercfg /requests` in an admin terminal.
- Tested by Bilal on real Chrome 154 (2026-10-13, fake chat): activeTab lets the popup read the address, and the popup STAYS OPEN during the "Allow access?" prompt and shows "Watching" afterwards. Still unknown: whether onRemoved fires when access is removed at chrome://extensions. The code treats these events as hints and always re-checks with Chrome; the popup re-checks when it opens.
- Registering content scripts from permissions.onAdded in the service worker (instead of the popup) changes an architecture rule. APPROVED by Bilal 2026-10-13; CLAUDE.md updated.
- In the fake chat, a site onChatMessageVisitor handler that throws stops onChatStarted firing in that tab (other tabs are fine). Real behaviour is unknown; keep it in mind for Phase 3's "site handler throws" tests.
- The open questions at the end of chrome-mv3.md and playwright.md become Phase 2-3 smoke tests. Check Chrome-version claims against the bundled Chromium.

## Decisions (don't reopen without a reason)
- Official vendor events first; HTML watching is the fallback only.
- Per-site permissions, granted by the user's click.
- No custom sound: the computer's notification sound and the phone alert are enough.
- Phone alerts via ntfy with a random topic; alerts never include message text.
- Three agents only: builder (main session), researcher, reviewer.
- Tawk.to first, Zendesk second.
- Name: Queue Cue (GitHub repo: queue-cue). Folder on the PC is still "Live Chat Notifier".
- (2026-10-13) The popup asks for the site permission; the service worker registers the content scripts when Chrome reports the grant (permissions.onAdded). The popup re-checks every time it opens, because Chrome may close it while the prompt shows.
- (2026-10-13) A site handler set after Tawk.to has loaded is not called, matching Tawk.to's own behaviour.
- (2026-10-13) The event shape gains "chat_ended", so keep-awake can be released when a chat ends.
- (2026-10-13) The popup has a "Stop watching this site" button.
- (2026-10-13) Desktop notifications stay on screen until clicked or closed (requireInteraction), if Windows supports it. They name the site only, never message text.

## Known limitations
- The computer must be on with Chrome open for any alert, including phone alerts.
- Some platforms' events may not fire in pop-out chat windows.
- Chats can time out on the company's side. The nudge reduces this but can't prevent it.
