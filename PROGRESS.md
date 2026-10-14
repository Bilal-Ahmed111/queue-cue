# Progress: Queue Cue

Current phase: 3 (Core build, Tawk.to). Steps 0-4 built. First review (2026-10-14): FAIL with 2 bugs. Fixed: keep-awake race with a closing tab, plus smaller points. The "only if missing" handler bug is fixed too: the Tawk.to detector now listens to the widget's window events, checked in two live tests (Next steps 1-2 in the Phase 3 section). One new question for Bilal (Next steps, item 2). Next: decisions B and D, then the reviewer. Tests (2026-10-14): 112 passed, 0 failed, 1 skipped.
Fixed 2026-10-14 (late): test runs were locking Bilal's Windows account. Each test starts Chromium on a fresh profile, and on Windows Chromium checks "is the Windows password blank?" by trying to sign in with an empty password (one failed sign-in, event 4625, per launch; about 113 per test run). Test browsers now start with that answer pre-filled (test/e2e/browser-profile.js; notes/research/windows-logon.md). A tripwire stops the run, and blocks further runs, if Chromium ever asks Windows again: delete test/.build/STOP-windows-sign-in.txt only once the cause is understood. Retries are off and a run stops after 10 failed tests. Nothing runs on its own: no scheduled tasks, startup entries or hooks. Confirmed by Bilal's Security log: 29 failed sign-ins that evening before the fix, 0 after it (one check launch plus a full test run).
Bilal's Chrome: 155.0.8059.79 (updated from 154 on 2026-10-14). Tests use Playwright's Chromium 156, so flag any feature newer than 155. Run tests with: npm.cmd test (in PowerShell, plain "npm test" is blocked because Windows won't run the npm.ps1 script; npm.cmd is the same npm without that block)

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
- [x] Hook (MAIN world) and relay (ISOLATED world) (src/content/; events reach the service worker and the dev-mode log; tested with the fake chat in test/e2e/tawk-events.spec.js)
- [x] Tawk.to detector for agent joined and agent message (HTML fallback only if official events fail) (src/detectors/tawk.js; also visitor message and chat ended. Since 2026-10-14 it listens to the widget's window events (tawkChatMessageAgent etc.) and never touches Tawk_API. No HTML fallback: the events work. messageKey = type + a fingerprint of the text, never the text. Events before tawkLoad are ignored, with a 5-second fallback if tawkLoad never comes)
- [x] Desktop notification naming the site; clicking it brings the chat tab to the front; quiet only when the chat tab is visible and focused (src/background/alerts.js; tested with the fake chat in test/e2e/alerts.spec.js. One notification per site, replaced by the next. Quiet = Chrome's focused window shows a tab that reported the event AND that tab's page said visible and focused; the decision waits 0.5 s for every tab's copy. Manual checks: the real Windows notification, clicking it from another app, and switching to another app)
- [x] No alerts for old messages after a page refresh; no duplicate alerts (old messages: the detector ignores anything before Tawk.to's onLoad. Duplicates: the same key on the same site within 10 s is one message, kept in chrome.storage.session so it survives the service worker stopping; tested with a forced stop)
- [x] PC kept awake while a chat is active, and always released afterwards (src/background/keep-awake.js, level "system": the screen may switch off, sleep is blocked. On with any chat message or agent join on a watched site; off when the chat ends, all its tabs close or leave the site, the site is no longer watched, or after 60 minutes with no chat activity (chrome.alarms). Tested with the fake chat in test/e2e/keep-awake.spec.js; whether Windows really stays awake is a manual check)
- [ ] All tests pass; reviewer PASS; committed

Next steps (start here in the next session; decisions approved by Bilal 2026-10-14, "all as recommended"):
1. DONE (2026-10-14): live test with the real widget, results in notes/research/tawk.md section 8.3. The window events fire with no callbacks set, carry the same data as the callbacks (message text, agent details, chatId), fire in every tab (background tabs too) and with the widget minimised, and old messages don't replay after a reload. NEW FINDING: when the agent ends the chat from the dashboard, only "agent left" fires, never "chat ended" (the callbacks behave the same). "Chat ended" only comes when the visitor ends the chat. So today keep-awake stays on until the 60-minute limit after an agent ends a chat. Second live test (same day): the agent CAN come back to the same chat after "agent left" ("agent joined" and the reply then fire and alert as usual), so "agent left" doesn't mean the chat is over. Bilal decided: keep the 60-minute limit for that case (decision E below).
2. DONE (2026-10-14): src/detectors/tawk.js now listens to the window "tawk..." events only (no Tawk_API getter/setter, no callback wrappers). The reviewer's "only if missing" test (break-phase3-site.spec.js:44) passes, and so do the defineProperty and locked-handler cases, which used to hear nothing. test/fake-chat/fake-tawk.js sends each event on window, then to the callback, like the real widget. Also brought in line with the live test: a visitor's message only fires in its own tab (the other tabs hear "chat started"), and a new agentLeave() action ("Agent closes the chat" button). CLAUDE.md's Detection and "Never break the host site" bullets updated (decision C). New tests: Tawk_API and the site's handlers are left untouched; an agent leaving reports nothing and keeps the PC awake; a returning agent is reported. Fixed a race in keep-awake.spec.js "a site dropped because its access is gone" (it failed now and then before this change too).
   NEW FINDING for Bilal (real widget, so the old callbacks had it too): because a visitor's message only reaches its own tab, a second tab of the chat only counts for keep-awake once it hears the agent. So with the chat in two tabs and no agent yet, closing the tab Bilal typed in lets the PC sleep until an agent joins. Recorded in keep-awake.spec.js as a known gap. Options: accept it as a known limitation, or count "chat started" (which every tab hears) as chat activity, which adds an event type and so changes the architecture.
3. Decision B: clear a site's notification when Bilal switches to that chat tab himself.
4. Decision D: chrome.tabs.update(tabId, { autoDiscardable: false }) for tabs with an active chat; set it back when the chat ends (no permission needed: chrome-mv3.md, "Tab discarding and freezing").
5. Decision A: listed under Known limitations (done).
6. Run the reviewer again until PASS, then Bilal's manual checklist below.

### Manual checks (reviewer adds)
All of these use the fake chat in your own Chrome, not the real Tawk.to (that's Phase 4). Already done, so not repeated here: the popup reading the site, the popup staying open during "Allow access?", a notification appearing, clicking it from another app, and no notification while you look at the chat.

Getting ready (each time Claude Code changes the code):
- [ ] At chrome://extensions, click the round "reload" arrow on the Queue Cue card. Then refresh the chat page. Open pages keep running the old code until you refresh them.
- [ ] In a terminal in the project folder, run `node test/serve.js` and leave that window open. Open http://127.0.0.1:47813/ in Chrome. Click the Queue Cue icon. It should say "Watching chats on this site." (if it doesn't, click "Watch chats on this site", Allow, then refresh the page). Click "Forget the chat", then "Visitor sends a message" so a chat is going.

Test runs leave your Windows sign-in alone (added 2026-10-14 after the lockouts):
- [x] In an admin terminal (right-click Start, "Terminal (Admin)"), run `Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4625; StartTime=(Get-Date '2026-10-14 22:50')} -ErrorAction SilentlyContinue | Select-Object TimeCreated, @{n='Process';e={$_.Properties[18].Value}} | Format-Table -AutoSize`. Expected: no lines naming chrome.exe from the project folder (no output at all is fine). Change the date and time to just before the latest test run to re-check later. Result (2026-10-14): 0 since 22:50, after a full test run with the fix (29 earlier that evening). If the command prints nothing, check you're really in an admin terminal.

Notifications:
- [ ] Stays on screen: click "Agent sends a message in 5 seconds", then at once click on another app (for example Notepad). A notification "Agent replied on 127.0.0.1" with a Close button should appear and stay in the corner of the screen for at least 1 minute, untouched. Then click it: Chrome comes to the front on the chat tab and the notification goes away.
- [ ] A second alert after the first: click "Agent sends a message in 5 seconds" and switch to another app. When the notification appears, leave it. Go back to the chat, click the button again and switch away again. The new notification should pop up again (not stay hidden), and your notification list (click the date and time in the taskbar) should show only one from Queue Cue. Click it: Chrome comes to the front on the chat tab.
- [ ] Chat tab still selected, but you're in another app: keep the chat tab as the selected tab in Chrome, click "Agent sends a message in 5 seconds", then click on another app so Chrome sits behind it. A notification should appear. (This checks that Queue Cue knows you're not looking even though the chat tab is the one showing in Chrome.)
- [ ] Another tab: click "Agent sends a message in 5 seconds", then switch to a different Chrome tab (for example a new tab). A notification should appear. Clicking it switches back to the chat tab.
- [ ] Minimised: click "Agent sends a message in 5 seconds", then minimise Chrome (the "_" button). A notification should appear. Clicking it brings Chrome back up on the chat tab.
- [ ] Chat in two tabs: open http://127.0.0.1:47813/ in a second tab as well. Click "Agent sends a message in 5 seconds" in one of them and switch to another app. Exactly ONE notification should appear, not two.
- [ ] Do Not Disturb: turn on Do Not Disturb (click the date and time in the taskbar, then the bell icon; or Settings > System > Notifications > Do not disturb). Repeat the "5 seconds" test while in another app. Expected: no pop-up (Windows holds it back), but it should be listed when you click the date and time in the taskbar. Turn Do Not Disturb off afterwards. This is Windows' rule, not a bug; the phone alerts in Phase 5 are the backup.

Removing access at chrome://extensions (do this last, as it stops watching the site):
- [ ] With a chat going, open chrome://extensions, click "Details" on Queue Cue, find "Site access", and remove 127.0.0.1 (the three-dot menu or the remove button next to it). Do NOT open the Queue Cue popup yet. Go back to the chat tab, click "Agent sends a message in 5 seconds" and switch to another app. Expected: NO notification. If one appears, Chrome didn't tell Queue Cue that access was removed: tell Claude Code. Then click the Queue Cue icon on the chat page: it should say "Not watching this site." Click "Watch chats on this site" and Allow to set things back, then refresh the page.

Keeping the PC awake (needs an admin terminal):
- [ ] Get ready: close any Chrome tabs playing video or music, and any video calls, as they also keep the PC awake. Right-click the Start button, choose "Terminal (Admin)" and click Yes.
- [ ] Before: on the chat page click "End chat", then "Forget the chat". In the admin terminal run `powercfg /requests`. Under "EXECUTION:" and "SYSTEM:" there should be no line naming chrome.exe (it may say "None.").
- [ ] During: click "Visitor sends a message". Run `powercfg /requests` again. Now a line naming chrome.exe should appear under "EXECUTION:" (possibly under "SYSTEM:" as well). Write down which.
- [ ] Still on after Queue Cue's background part goes to sleep: leave everything alone for 2 minutes, then run `powercfg /requests` again. The chrome.exe line should still be there.
- [ ] After the chat ends: click "End chat". Run `powercfg /requests`. The chrome.exe line should be gone.
- [ ] After closing the tab: start a chat again ("Visitor sends a message", check the line is back), then close the chat tab. Run `powercfg /requests`. The line should be gone.
- [ ] After "Stop watching": open the chat again, start a chat, check the line is back, then click the Queue Cue icon and "Stop watching this site". Run `powercfg /requests`. The line should be gone. Click "Watch chats on this site" again and refresh the page to set things back.
- [ ] After reloading the extension: start a chat, check the line is back, then click the reload arrow on Queue Cue at chrome://extensions. Run `powercfg /requests`. The line should be gone.
- [ ] Really stays awake, plugged in: note your current setting in Settings > System > Power & battery > "Screen, sleep & hibernate timeouts", then set "When plugged in, put my device to sleep after" to 1 minute. Start a chat on the fake page and leave the laptop alone (lid open, no keys) for 10 minutes. Then in a normal PowerShell window run `Get-WinEvent -FilterHashtable @{LogName='System'; Id=506,507} -MaxEvents 6 | Format-Table TimeCreated, Id, Message -AutoSize`. Expected: no 506 ("entering Modern Standby") during those 10 minutes. (The screen may still turn off; that's allowed.)
- [ ] On battery: unplug the charger, set "On battery power, put my device to sleep after" to 1 minute, start a chat and leave the laptop alone for 10 minutes, then run the same Get-WinEvent command. Write down the time of any 506 line. Research says Windows may end Chrome's keep-awake about 5 minutes after the sleep time on battery, so a 506 roughly 6 minutes in would confirm that limit. Put both sleep settings back afterwards.
- [ ] Optional, slow: start a chat, then don't touch the chat for 65 minutes (the PC must stay plugged in and on). Run `powercfg /requests`. The chrome.exe line should be gone (the 60-minute limit).

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
- Hook timing: Tawk.to reads its callbacks once at load, so the MAIN-world hook must run first. SETTLED in Phase 2: a registered MAIN-world script at document_start runs before the page's scripts (Playwright's Chromium 156, fake chat). DONE in Phase 3 step 2: a getter/setter on window.Tawk_API wraps the object only once the site creates it (value stays undefined on non-Tawk pages; side effect: `'Tawk_API' in window` is true on watched sites). Still to confirm with the real widget: one-time reading for onAgentJoinChat. SUPERSEDED 2026-10-14 (decision C): the detector now only listens to window events, so there is no getter/setter and no side effect; it still registers at document_start so it hears tawkBeforeLoad.
- A site handler set after Tawk.to has loaded is normally never called, but our wrapper would call it. DECIDED 2026-10-13: copy Tawk.to, don't call it. DONE in step 2: test/fake-chat/site-handlers.html checks the site's handlers see exactly the same calls with and without Queue Cue (chaining, throwing and late handlers).
- De-duplication: no message ID, and every open tab fires. messageKey SETTLED in step 2: type + fingerprint of the text (no chatId, because a tab may not know it); the service worker will treat the same key on the same site within about 10 seconds as one message (step 3), with one write at a time. Quiet rule and keep-awake must work with several tabs of one chat.
- onChatStarted fires again on every reload, so it doesn't mean a new chat. Not yet tested live: onChatEnded, and replay when the widget is minimised or the chat has ended.
- Tests can't click Chrome's permission prompt: DONE in Phase 2, tests use a test copy with the fake chat pre-granted (test/e2e/global-setup.js). The real prompt goes on the Phase 3 manual checklist.
- Under Playwright the service worker did not stop after 40 s idle, so restart recovery can't be tested by waiting. SETTLED in step 3: CDP ServiceWorker.stopWorker from an extension page works (playwright.md 10.8; helper test/e2e/service-worker-restart.js).
- chrome.power (research, from Chromium source): a service worker stop does NOT release keep-awake; an extension reload or disable does. Unverified: on Modern Standby laptops on battery, Windows may cancel the request about 5 minutes after the sleep timeout. Bilal's laptop DOES use Modern Standby (Windows system log, 2026-10-14), so test keep-awake on battery as well as plugged in. Manual check with `powercfg /requests` in an admin terminal.
- Tested by Bilal on real Chrome 154 (2026-10-13, fake chat): activeTab lets the popup read the address, and the popup STAYS OPEN during the "Allow access?" prompt and shows "Watching" afterwards. Still unknown: whether onRemoved fires when access is removed at chrome://extensions. Also tested by Bilal on Chrome 155 (2026-10-14, fake chat, step 3 build): the Windows notification appears, clicking it brings Chrome to the front from another app, and no notification while looking at the chat. Still to check: that it stays on screen well beyond 5 seconds. The code treats these events as hints and always re-checks with Chrome; the popup re-checks when it opens.
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
- (2026-10-14) A: the same words from the agent twice within 10 seconds give one alert (messages have no ID). Accepted as a known limitation.
- (2026-10-14) B: a site's notification is cleared automatically when Bilal switches to that chat tab himself.
- (2026-10-14) C: Tawk.to detection listens to the widget's window events ("tawkChatMessageAgent" etc., used by Tawk.to's own official add-ons but not documented) instead of wrapping Tawk_API callbacks, once a live test confirms them. Changes CLAUDE.md's architecture bullets.
- (2026-10-14) D: tabs with an active chat are marked "don't discard" (autoDiscardable false) so Chrome's Memory Saver can't unload them.
- (2026-10-14) Test browsers never start on an empty profile: they use test/e2e/browser-profile.js (pre-filled Local State plus tripwire), including tests without the extension (plainTest in fixtures.js). Playwright's own browser fixture is switched off. Reason: Windows account lockouts from Chromium's blank-password check.
- (2026-10-14) E: "agent left" is not treated as the end of the chat, because the agent can come back to it (live test). Keep-awake's 60-minute limit covers that case; closing the chat tab still releases it at once.

## Known limitations
- The computer must be on with Chrome open for any alert, including phone alerts.
- Some platforms' events may not fire in pop-out chat windows.
- Chats can time out on the company's side. The nudge reduces this but can't prevent it.
- If the agent sends exactly the same words twice within 10 seconds, only one alert is shown (Tawk.to messages have no ID).
- Tawk.to detection relies on the widget's window events, which Tawk.to's own add-ons use but its API docs don't mention, so Tawk.to could change them without notice. If alerts stop working on Tawk.to sites, check these events first (test-site/events-probe.html).
- When an agent closes a Tawk.to chat, Tawk.to only says "agent left", so the PC stays awake for up to 60 minutes unless the chat tab is closed.
- Keep-awake can't stop the laptop sleeping when the lid is closed or the sleep button is pressed. On a Modern Standby laptop on battery (Bilal's is one), Windows may end it a few minutes after its sleep timeout (research; to be checked).
