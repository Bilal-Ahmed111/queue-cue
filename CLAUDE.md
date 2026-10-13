# Queue Cue: project rules

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
- One detector file per platform in src/detectors/. Every detector emits the same event shape: { type: "agent_joined" | "agent_message" | "visitor_message" | "chat_ended", platform, messageKey }.
- Content scripts can't use import/export. Load files in order and share one namespace object.
- Never break the host site: wrap vendor callbacks and keep any handler the site sets, whether it sets it before or after us. A handler the site sets after the vendor has loaded is not called, because the vendor wouldn't call it either. No side effects on sites that don't use that vendor.
- Permissions are per site. The popup's "Watch chats on this site" button calls chrome.permissions.request for that site (this must come from the user's click). The service worker registers the content scripts for that site with chrome.scripting.registerContentScripts when Chrome reports the grant (permissions.onAdded), because Chrome may close the popup while its prompt shows. The popup re-checks every time it opens. "Stop watching this site" removes the permission and the scripts. Site access goes in optional_host_permissions; never ask for all sites up front. The only required host permission is https://ntfy.sh/*.
- The service worker shuts down after about 30 seconds idle. Never use setTimeout or setInterval for waits longer than a few seconds; use chrome.alarms. Keep state in chrome.storage (session or local), never in global variables.
- Notifications name the site (never message text), stay on screen until clicked or closed, and clicking one brings the chat tab to the front. Stay quiet only when the chat tab is both visible and focused.
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
