# Progress: Queue Cue

Current phase: 2 (Fake chat and automated tests): reviewer PASS (second review); waiting for Bilal's manual checklist. Phase 1 done 2026-10-13. Run tests with: npm test

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
Note: `npm test` starts its own copy of the fake chat page and stops it when the tests finish. To open the page yourself, first run `node test/serve.js` in a terminal in the project folder and leave that window open (press Ctrl+C to stop it). Nothing in this phase shows real notifications yet; that comes in Phase 3.
- [ ] In a terminal in the project folder, run `npm test`. After about a minute it should end with lines like "45 passed" and "1 skipped" (the skipped one is a slow 40-second test that only runs when asked for), and no "failed" line. (If you see "spawn UNKNOWN", it was started some other way; use exactly `npm test`.)
- [ ] Run `node test/serve.js`, then open http://127.0.0.1:47813/ in your own Chrome. You should see "Fake Tawk.to Chat" with buttons, and a small "Fake chat (online)" box in the bottom-right corner.
- [ ] Click "Visitor sends a message", then "Agent joins", then "Agent sends a message". The box should list "You: Visitor message 1" and "Test Agent: Agent reply 1".
- [ ] Refresh the page. The same messages should still be in the box (the fake remembers the chat, like the real widget).
- [ ] Open http://127.0.0.1:47813/ in a second tab and click "Agent sends a message" there. Switch back to the first tab: a second "Test Agent: Agent reply 1" line should show there too, without refreshing (each tab numbers its own clicks, so the number repeats).
- [ ] Click "End chat" (the box should say "Chat ended"), then "Forget the chat" (the box empties). Stop the server with Ctrl+C when done.
- [ ] Open chrome://extensions in your own Chrome, turn on Developer mode, click "Load unpacked" and choose the project folder (the one with manifest.json). "Queue Cue" should appear with no red "Errors" button. It does nothing visible yet. Remove it afterwards if you like.

## Phase 3: Core build (Tawk.to)
- [ ] Popup "Watch chats on this site" button: per-site permission, content scripts registered for that site
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
- [ ] Screenshots and a 30-second demo video (Bilal)
- [ ] Chrome Web Store developer account (one-time fee) and submission (Bilal)

## Open questions for Phases 2-3 (from the Phase 1 review)
- Hook timing: Tawk.to reads its callbacks once at load, so the MAIN-world hook must run first. SETTLED in Phase 2: a registered MAIN-world script at document_start runs before the page's scripts (Playwright's Chromium 156, fake chat). Still to do: avoid creating Tawk_API on non-Tawk sites (e.g. a getter/setter on window.Tawk_API itself). Confirm one-time reading for onAgentJoinChat too.
- A site handler set after Tawk.to has loaded is normally never called, but our wrapper would call it. Decide whether to allow that.
- De-duplication: no message ID, and every open tab fires. Settle messageKey (e.g. chatId + text hash + short time window) and guard against two tabs writing to storage at once. Quiet rule and keep-awake must work with several tabs of one chat.
- onChatStarted fires again on every reload, so it doesn't mean a new chat. Not yet tested live: onChatEnded, and replay when the widget is minimised or the chat has ended.
- Tests can't click Chrome's permission prompt: DONE in Phase 2, tests use a test copy with the fake chat pre-granted (test/e2e/global-setup.js). The real prompt goes on the Phase 3 manual checklist.
- Under Playwright the service worker did not stop after 40 s idle, so restart recovery can't be tested by waiting. Find a way to force a stop before Phase 3 relies on it (research first).
- Registering content scripts from permissions.onAdded in the service worker (instead of the popup) changes an architecture rule: needs Bilal's OK.
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

## Known limitations
- The computer must be on with Chrome open for any alert, including phone alerts.
- Some platforms' events may not fire in pop-out chat windows.
- Chats can time out on the company's side. The nudge reduces this but can't prevent it.
