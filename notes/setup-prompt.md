# Setup prompt for Claude Code: Live Chat Notifier

You're setting up a new project in this folder. Work through the steps below in order, and stop wherever a step says to.

## STEP 0: Safety checks (before creating anything)

1. If my user-level Claude Code memory file exists (~/.claude/CLAUDE.md), read it. If it contains any rule telling you not to write code for me (I call it my "leash" block; it comes from a Python learning project), STOP. Tell me exactly which file it's in and wait until I've moved it into that Python project's own CLAUDE.md. In this project you write all the code.
2. Check this folder contains only setup-prompt.md. If anything else is here, list it and ask me before continuing.
3. Tell me my operating system, then check and report: git, Node.js (version 20 or newer), npm, the GitHub CLI (gh), and whether gh is signed in. For anything missing, give me exact install steps for my system and wait until I confirm it's done. Git and Node.js are required before STEP 1. gh is optional for now.
4. Read my user-level settings (~/.claude/settings.json) if it exists. If it sets defaultMode to "bypassPermissions", tell me. Bypass mode should not be used in this project, and a user-level setting applies to every project. Explain how to keep bypass for my other project only (for example, by starting that project with the --dangerously-skip-permissions flag) and wait until I've changed it.

## STEP 1: Create the project files

Create each file below with exactly the content between its BEGIN and END lines. Don't include the marker lines themselves. Create folders as needed.

When all five files exist, move setup-prompt.md into a notes/ folder so it's kept for reference.

===== BEGIN FILE: .claude/settings.json =====
{
  "permissions": {
    "ask": [
      "Bash(git push *)",
      "Bash(gh *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git reset --hard *)"
    ]
  }
}
===== END FILE: .claude/settings.json =====

===== BEGIN FILE: CLAUDE.md =====
# Live Chat Notifier: project rules

## What we're building
A Chrome extension (Manifest V3) that alerts the user when a website's live-chat agent joins the chat or replies, so they can leave the chat tab and get on with other things. Desktop notification first, then an optional phone alert via ntfy. Platforms: Tawk.to first, then Zendesk (both its messaging widget and its Classic widget).

## Working with Bilal
- Bilal is not a developer. You write all the code in this project. Any "don't write code for me" rule from other projects does not apply here.
- He wants to understand every step. Use plain English, define jargon the first time you use it, and keep explanations short.
- At the start of every session, read PROGRESS.md and tell him in one or two lines where we are.
- Before starting a phase, present a plan: what you'll build, which files, how it will be tested, and what he'll need to do. Wait for his approval. Never start the next phase without approval.
- Don't add features that aren't in PROGRESS.md without asking.
- When he has something to do, end your message with a short numbered list of his tasks.
- After any code change, remind him: reload the extension at chrome://extensions AND refresh the chat page. Open pages keep running the old code otherwise.

## Agents
- researcher (subagent): call it by name before relying on any vendor API, Chrome API or tool behaviour that isn't already verified in notes/research/. Never guess API names or behaviour.
- reviewer (subagent): call it by name at the end of every phase. It reviews the changes, writes "try to break it" tests, runs the full test suite and writes Bilal's manual checklist into PROGRESS.md. It doesn't edit extension code. You fix what it finds, then run it again until it passes.
- No other agents and no agent teams.

## Definition of done (every phase)
1. Your tests pass.
2. The reviewer's verdict is PASS.
3. Bilal has ticked the phase's manual checklist (where there is one).
4. PROGRESS.md is updated.
5. The work is committed with a clear message.

Also commit after every working step, not just at the end of a phase, so mistakes can always be rolled back.

## Architecture (ask before changing any of this)
- Detection: use each platform's official JavaScript events first (Tawk_API callbacks, Zendesk zE listeners). Watching the page's HTML with a MutationObserver is a fallback, used only where official events don't fire.
- Two content scripts:
  - hook runs in the page's MAIN world so it can reach the vendor's JavaScript API. It cannot use chrome.* APIs.
  - relay runs in the ISOLATED world and passes events from the hook to the service worker (window.postMessage, then chrome.runtime.sendMessage). It only accepts messages from the same window that carry our own marker.
- One detector file per platform in src/detectors/. Every detector emits the same event shape: { type: "agent_joined" | "agent_message" | "visitor_message", platform, messageKey }.
- Content scripts can't use import/export. Load files in order and share one namespace object.
- Never break the host site: wrap vendor callbacks and keep any handler the site sets, whether it sets it before or after us. No side effects on sites that don't use that vendor.
- Permissions are per site. The popup's "Watch chats on this site" button calls chrome.permissions.request for that site (this must come from the user's click), then registers the content scripts for that site with chrome.scripting.registerContentScripts. Site access goes in optional_host_permissions; never ask for all sites up front. The only required host permission is https://ntfy.sh/*.
- The service worker shuts down after about 30 seconds idle. Never use setTimeout or setInterval for waits longer than a few seconds; use chrome.alarms. Keep state in chrome.storage (session or local), never in global variables.
- Notifications name the site, and clicking one brings the chat tab to the front. Stay quiet only when the chat tab is both visible and focused.
- Never alert for messages that existed before the page loaded, and never alert twice for the same message.
- Keep the PC awake with chrome.power while a watched chat is active. Always release it when the chat ends, the tab closes, or after 60 minutes with no chat activity.
- Phone alerts use ntfy. Generate a random topic on install (crypto.randomUUID) so it can't be guessed. Alert text names the site only, never message content.
- No custom sounds, no analytics, no network calls except ntfy.sh, no remote code.

## Testing
- Automated tests use Playwright with its own bundled Chromium. Branded Google Chrome no longer accepts the command-line flags that load an unpacked extension.
- In dev mode, the service worker records every alert in a debug log in chrome.storage.session, so tests can check that alerts fired. Tests can't see real OS notifications.
- test/fake-chat/ imitates the real vendor APIs as described in notes/research/. A fake proves the logic; only the real chat proves it works. Always say which one a result came from.
- Only Bilal can verify: OS notifications appearing, phone alerts arriving, the PC staying awake, and behaviour in real vendor chats. These go in the manual checklist.

## Folder layout
- manifest.json
- src/background/ : service worker
- src/content/ : hook (MAIN world) and relay (ISOLATED world)
- src/detectors/ : one file per platform, plus the HTML fallback
- src/popup/ : "Watch chats on this site" button and status
- src/options/ : settings (ntfy topic, test alert, nudge timing)
- icons/
- test/fake-chat/ : fake vendor chat page
- test/e2e/ : Playwright tests
- test-site/ : page with the real Tawk.to snippet, for manual testing
- notes/research/ : researcher reports
- PROGRESS.md : phase checklist; keep it current

## When something fails
Explain the cause in plain English, what you changed, and how you checked the fix. If you're not sure, say so and propose a test that settles it.
===== END FILE: CLAUDE.md =====

===== BEGIN FILE: PROGRESS.md =====
# Progress: Live Chat Notifier

Current phase: 1 (Setup)

Key: [ ] to do, [x] done. Owner in brackets.

## Phase 1: Setup
- [ ] GitHub repo created and pushed (Claude Code, with Bilal's OK)
- [ ] Free Tawk.to account created (Bilal)
- [ ] Agent status set to Online in the Tawk.to dashboard. If no agent is online, visitors get a leave-a-message form instead of live chat (Bilal)
- [ ] Tawk.to embed code pasted into Claude Code (Bilal) and saved as test-site/index.html (Claude Code)
- [ ] Test site served locally with the chat widget visible. If it won't load locally, host it on GitHub Pages instead (Claude Code + Bilal)
- [ ] Research: Tawk.to JavaScript API. Verify onAgentJoinChat, onChatMessageAgent and onChatMessageVisitor, what each passes, and limits such as pop-out chat windows. Save to notes/research/tawk.md (researcher)
- [ ] Research: Chrome Manifest V3 essentials for this design (per-site optional permissions, registerContentScripts in the MAIN world, service worker lifetime, alarms, power, notifications). Save to notes/research/chrome-mv3.md (researcher)
- [ ] Research: Playwright testing with an unpacked extension. Save to notes/research/playwright.md (researcher)

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

## Known limitations
- The computer must be on with Chrome open for any alert, including phone alerts.
- Some platforms' events may not fire in pop-out chat windows.
- Chats can time out on the company's side. The nudge reduces this but can't prevent it.
===== END FILE: PROGRESS.md =====

===== BEGIN FILE: .claude/agents/researcher.md =====
---
name: researcher
description: Looks up and verifies facts from official documentation: chat vendor JavaScript APIs (Tawk.to, Zendesk), Chrome extension APIs, Playwright and ntfy. Use before relying on any API or behaviour that isn't already verified in notes/research/. Saves findings to notes/research/.
tools: Read, Grep, Glob, WebSearch, WebFetch, Write
model: sonnet
effort: medium
---

You research facts for a Chrome extension project. Wrong facts become bugs, so accuracy matters more than speed.

Rules:
- Use official sources first: developer.tawk.to, developer.zendesk.com, developer.chrome.com, playwright.dev and docs.ntfy.sh. Use blogs or forums only to fill gaps, and label anything from them as unofficial.
- Give exact API names, signatures and required permissions, with the source URL for each.
- Note any limits and gotchas the docs mention, such as callbacks that don't work in pop-out windows, minimum alarm intervals, or service worker lifetime.
- Never fill gaps with guesses. If the docs are unclear or contradict each other, say so plainly and suggest a quick test that would settle it.
- Check the existing files in notes/research/ first, and update them rather than duplicating.

Output:
- Save the full findings to notes/research/<topic>.md. Only ever write inside notes/research/.
- Return a summary of no more than 15 lines: what you found, what's still uncertain, and any test you recommend.
===== END FILE: .claude/agents/researcher.md =====

===== BEGIN FILE: .claude/agents/reviewer.md =====
---
name: reviewer
description: Independent reviewer and tester. Use at the end of every phase and whenever Bilal asks for a review. Reviews the phase's changes against CLAUDE.md, writes "try to break it" tests, runs the full test suite and writes Bilal's manual checklist into PROGRESS.md. Never edits extension code.
tools: Read, Grep, Glob, Bash, Write, Edit
model: opus
effort: high
---

You are the independent reviewer and tester for this Chrome extension. The builder wrote the code. Assume it contains mistakes and find them. Approving broken work is the worst outcome; a false alarm is cheap.

Before reviewing:
1. Read CLAUDE.md and PROGRESS.md.
2. Find what changed in this phase: run `git log --oneline -15`, then `git diff` against the commit where the previous phase ended. Read every changed file in full.
3. Read the relevant files in notes/research/.

Check:
- Every rule in CLAUDE.md, especially: official vendor events first; the host site's own handlers preserved; per-site permissions only; no setTimeout or setInterval for long waits in the service worker; no state kept in service worker global variables; no alerts for old messages; no duplicate alerts; quiet only when the chat tab is visible and focused; keep-awake always released; ntfy alerts never contain message text; no network calls except ntfy.sh.
- Bugs and race conditions, such as page load order, the service worker restarting mid-chat, or chats open in two tabs, plus anything that would fail silently.
- Whether the tests actually test the behaviour, not just that the code runs.

Write tests:
- Add "try to break it" tests, in test/ only. Ideas: refreshing mid-chat, many messages at once, the same chat in two tabs, the agent leaving, the service worker restarting between messages, the chat popped out into its own window, the site setting its own vendor handler before or after ours.
- You may edit files in test/ and the "Manual checks" sections of PROGRESS.md. Never edit manifest.json, anything in src/, or any other file. If code needs fixing, report it; the builder fixes it.
- Run the full suite with `npx playwright test` and report exact failures.

Manual checklist:
- Under the current phase in PROGRESS.md, add a short checklist of things only Bilal can verify: the OS notification appearing, the phone alert arriving, the PC staying awake, and behaviour in the real Tawk.to or Zendesk chat. For each item, say what to do and what should happen. Plain English, no jargon.

Report back in this format, in plain English, concisely:
VERDICT: PASS or FAIL
MUST FIX: file, problem, why it matters, suggested fix
SHOULD FIX:
TESTS ADDED:
TEST RESULTS: number passed, number failed, and the names of any failures
MANUAL CHECKLIST: added to PROGRESS.md (yes or no)

Any failing test or any MUST FIX item means VERDICT: FAIL.
===== END FILE: .claude/agents/reviewer.md =====

## STEP 2: Git

1. Create a .gitignore file containing these lines: node_modules/, test-results/, playwright-report/, playwright/.cache/, .DS_Store
2. Run git init, then commit everything with the message: "Project setup: rules, progress checklist, subagents".

## STEP 3: GitHub

- If gh is installed and signed in, ask me before creating a public GitHub repo named live-chat-notifier, then push. Public is deliberate: it's a portfolio project, it allows free GitHub Pages hosting later, and nothing secret goes in this repo.
- If gh isn't ready, give me the shortest steps to set it up, then carry on. We can push later.

## STEP 4: Hand over

1. Summarise in plain English: the files you created, the check results, and anything still missing.
2. Subagent files may only be picked up when Claude Code starts. Tell me to restart: exit, run claude again in this folder, then type /agents to confirm "researcher" and "reviewer" both appear.
3. Tell me that after restarting, I should check the permission mode shown on screen: it should be auto mode (or accept edits if auto isn't offered), never bypass. Then I switch to plan mode (Shift+Tab) and type: Start Phase 1
