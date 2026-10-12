# Progress: Queue Cue

Current phase: 1 (Setup)

Key: [ ] to do, [x] done. Owner in brackets.

## Phase 1: Setup
- [x] GitHub repo created and pushed (Claude Code, with Bilal's OK): github.com/Bilal-Ahmed111/queue-cue
- [x] Free Tawk.to account created (Bilal)
- [ ] Agent status set to Online in the Tawk.to dashboard. If no agent is online, visitors get a leave-a-message form instead of live chat (Bilal)
- [x] Tawk.to embed code pasted into Claude Code (Bilal) and saved as test-site/index.html (Claude Code)
- [x] Test site served locally with the chat widget visible. If it won't load locally, host it on GitHub Pages instead (Claude Code + Bilal). Works at http://localhost:8080 (python -m http.server, set up in .claude/launch.json); checked in Claude Code's built-in browser
- [ ] Research: Tawk.to JavaScript API. Verify onAgentJoinChat, onChatMessageAgent and onChatMessageVisitor, what each passes, and limits such as pop-out chat windows. Save to notes/research/tawk.md (researcher). Notes saved; still to settle with a live test: replay of old messages on refresh, message data shape, handler timing, several tabs
- [x] Research: Chrome Manifest V3 essentials for this design (per-site optional permissions, registerContentScripts in the MAIN world, service worker lifetime, alarms, power, notifications). Save to notes/research/chrome-mv3.md (researcher). Open questions listed in the file; settle them with tests in Phases 2 and 3
- [x] Research: Playwright testing with an unpacked extension. Save to notes/research/playwright.md (researcher). Tests can't click Chrome's permission prompt; plan for this in Phase 2

### Manual checks (reviewer adds)

## Phase 2: Fake chat and automated tests
- [ ] Fake chat page in test/fake-chat/ that fires agent-joined, agent-message and visitor-message events at the press of a button, matching the real API as described in the research notes
- [ ] Playwright installed with its bundled Chromium; a first test loads the extension successfully
- [ ] Dev-mode alert log that tests can read
- [ ] Reviewer: first "try to break it" tests written; verdict PASS

### Manual checks (reviewer adds)

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
