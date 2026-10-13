# Where this skill comes from

Copied unchanged from Google Chrome's Modern Web Guidance, version 0.0.194 (commit b31dc0a), on 2026-10-13:
https://github.com/GoogleChrome/modern-web-guidance (folder skills/chrome-extensions). Licence: Apache 2.0, see LICENSE.
Bilal asked for it to be installed; the plugin installer wasn't available in the desktop app, so it lives here as a project skill.
It does not update itself. To update, copy the folder again from the repo and change the version above.

Project rules still come first (CLAUDE.md): facts we rely on are checked by the researcher and saved in notes/research/.
Known differences from what we have verified (2026-10-13):
- Its rule 4 says tab.url needs the "tabs" permission. Our smoke test (test/e2e/smoke-focus.spec.js) read tab.url
  with only a host permission for that site, which matches the official tabs docs.
- Its Part 2 says to create CHROMEWEBSTORE.md as soon as an extension will be published. In this project that is
  a Phase 8 task (PROGRESS.md).
