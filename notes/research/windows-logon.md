# Windows failed-logon (event 4625) caused by Playwright Chromium launches

Researched 2026-10-14. Chromium build used by this project: chromium-1248 = Chromium 156.0.8078.4
(node_modules/playwright-core/browsers.json). Playwright 1.64.0 (node_modules/playwright-core/package.json).

Labels: OFFICIAL-SOURCE = Chromium source code. LOCAL = file in this project's node_modules.
UNKNOWN = not confirmed. Source text was read through a summarising fetch tool, so quotes are
short and may differ in whitespace. The tag 156.0.8078.4 was checked where noted, otherwise "main".

## Short answer

Your hypothesis is RIGHT about the mechanism and WRONG about the trigger.

- The failed logon is Chromium's "is the Windows password blank?" probe: `LogonUser(user, L".", L"", LOGON32_LOGON_INTERACTIVE, ...)`
  with an empty password. For an account that has a password this is exactly a 4625, Logon Type 2, 0xC000006A. (OFFICIAL-SOURCE)
- It is NOT called from browser startup any more. `ChromeBrowserMainPartsWin` in 156.0.8078.4 has no mention of
  CheckBlankPassword / password_manager_util_win / DelayReportOsPassword / ReportOsPassword. (OFFICIAL-SOURCE, tag 156.0.8078.4)
- It IS reached from the autofill code that runs when a tab is created (details in section 1). That path is the best
  match for "one new attempt per fresh-profile launch". It is a code-reading match, not a measured one (section 7).
- The result is cached in Local State (not the profile). A fresh profile has no cache, so each launch re-asks.

## 1. Where Chromium calls LogonUser (call chain)

All OFFICIAL-SOURCE. Files in github.com/chromium/chromium (mirror of chromium.googlesource.com/chromium/src).

1. `chrome/browser/password_manager/password_manager_util_win.cc`, `CheckBlankPasswordWithPrefs()`:
   ```
   DWORD logon_result =
       LogonUser(username_view.data(), L".", L"", LOGON32_LOGON_INTERACTIVE,
                 LOGON32_PROVIDER_DEFAULT, &handle);
   ...
   blank_password = (logon_result || last_error == ERROR_ACCOUNT_RESTRICTION);
   ```
   This is the only LogonUser call in the file. `CheckBlankPassword()` is in an anonymous namespace (not callable from other files).
2. `DeviceAuthenticationPresent()` (same file) calls it: `return base::win::IsEnrolledToDomain() || !CheckBlankPassword(username, local_state);`
   So on a domain-joined PC the probe is skipped. (Bilal's PC is presumably not domain-joined: UNKNOWN.)
3. `DeviceAuthenticationPresent()` is called only from `CanAuthenticateWithScreenLock()` and `AuthenticateUser()` in that file.
4. `chrome/browser/device_reauth/win/authenticator_win.cc`: `AuthenticatorWin::CanAuthenticateWithScreenLock()` calls
   `password_manager_util_win::CanAuthenticateWithScreenLock(g_browser_process->local_state())` unconditionally.
5. `chrome/browser/device_reauth/win/device_authenticator_win.cc` and `device_auth_availability_checker_win.cc`:
   ```
   return CanAuthenticateWithBiometrics() ||
          authenticator_->CanAuthenticateWithScreenLock();
   ```
   `CanAuthenticateWithBiometrics()` reads the Local State pref `kIsBiometricAvailable`. It is only filled in by an async check posted
   30 s after browser start (`kCacheBiometricsAvailabilityDelay = base::Seconds(30)` in `chrome_browser_main_win.cc`, only if feature
   `kDeviceReauthRefactor` is on). Our tests last 2-10 s, so the pref is still false and the `||` falls through to the screen-lock
   check, i.e. to LogonUser.
6. `components/autofill/core/browser/foundations/autofill_client.cc`:
   ```
   bool AutofillClient::SupportsDeviceReauth() const {
     std::unique_ptr<device_reauth::DeviceAuthenticator> authenticator = GetDeviceAuthenticator();
     return authenticator && authenticator->CanAuthenticateWithBiometricOrScreenLock();
   }
   ```
   `ChromeAutofillClient::GetDeviceAuthenticator()` returns a real authenticator on Windows
   (`#if BUILDFLAG(IS_ANDROID) || BUILDFLAG(IS_MAC) || BUILDFLAG(IS_WIN) || BUILDFLAG(IS_CHROMEOS)` ... `ChromeDeviceAuthenticatorFactory::GetForProfile`). Checked at tag 156.0.8078.4.
7. THE TRIGGER. `chrome/browser/ui/autofill/chrome_autofill_client.cc`, in the constructor `ChromeAutofillClient::ChromeAutofillClient(content::WebContents*)`
   (present at tag 156.0.8078.4 and on main):
   ```
   // Notify the EntityDataManager about the availability of device re-auth. ...
   if (EntityDataManager* edm = base::FeatureList::IsEnabled(features::kAutofillAiWalletPrivatePasses) ||
                                base::FeatureList::IsEnabled(features::kAutofillAmbientAutofill)
                                ? GetEntityDataManager() : nullptr) {
     edm->SetReauthAvailability(SupportsDeviceReauth());
   }
   ```
   There is no delay. It runs when the autofill client is created for a tab (WebContents). That the client is created for every tab,
   including the first about:blank tab in headless: UNKNOWN (not verified; normal Chrome attaches it as a tab helper).
8. Feature defaults (tag 156.0.8078.4, `components/autofill/core/common/autofill_features.cc`):
   - `kAutofillAmbientAutofill`: `BASE_FEATURE(..., base::FEATURE_DISABLED_BY_DEFAULT)`.
   - `kAutofillAiWalletPrivatePasses` (non-iOS): `BASE_FEATURE_WITH_COUNTRY_RESTRICTIONS(..., base::FEATURE_DISABLED_FOR_COUNTRIES, WALLET_UNSUPPORTED_COUNTRIES)`.
   - `base/feature.h` comment: "FEATURE_DISABLED_FOR_COUNTRIES: The feature is disabled only for the countries specified.
     Defaults to enabled if Chrome does not have information about the current country."
   - A fresh profile with `--disable-field-trial-config` and no variations seed probably has no country, so the feature should be ON.
     Not measured: UNKNOWN.

Other (non-startup) paths that reach the same function, so they are not the cause of a launch-time attempt but could appear if a test page
has a login form with saved passwords or uses navigator.credentials: `password_autofill_manager.cc` (~l.976-982), `credential_manager_impl.cc`
(~l.261-268), `http_auth_manager_impl.cc` (~l.106-110), `password_manual_fallback_flow.cc`, settings page strings
(`settings_localized_strings_provider.cc`), `autofill_private_api.cc`, `mandatory_reauth_manager.cc`. A fresh profile has no saved passwords,
so these should not fire in our tests (UNKNOWN, not tested).

## 2. Cache: where and what

OFFICIAL-SOURCE. `components/password_manager/core/common/password_manager_pref_names.h` (Windows only):
- `kOsPasswordBlank` = `"password_manager.os_password_blank"` (bool).
- `kOsPasswordLastChanged` = `"password_manager.os_password_last_changed"` (int64).
Registered with `registry->RegisterInt64Pref(prefs::kOsPasswordLastChanged, 0);` in `components/password_manager/core/browser/password_manager.cc` (~l.659).
`CheckBlankPassword()` reads/writes them on `g_browser_process->local_state()` (the file called "Local State" in the user-data-dir root), NOT the profile's Preferences.

Re-check rule (`CheckBlankPasswordWithPrefs`, tag 156.0.8078.4):
```
int64_t last_changed = GetPasswordLastChanged(username_view.data());   // NetUserGetInfo level 1, usri1_password_age
if (last_changed == -1) { return false; }                               // cannot tell -> assume NOT blank, no LogonUser, no pref write
bool need_recheck = true;
if (prefs->pref_last_changed > 0 && last_changed <= prefs->pref_last_changed) { need_recheck = false; }
if (need_recheck) { ...LogonUser... }
last_changed += base::Time::kMicrosecondsPerSecond;                     // 1 s skew
prefs->pref_last_changed = last_changed;  prefs->blank_password = blank_password;
```
- `last_changed = base::Time::Now() - base::Seconds(age)` then `.ToInternalValue()` (microseconds; I believe since 1601-01-01, from memory: UNKNOWN).
  The comment in the pref-names header says "seconds since epoch", which disagrees with the code. The code wins; the comment is stale.
- So: first run, pref is 0, so recheck (LogonUser). After that, no recheck unless the Windows password was changed later than the stored time.
- The stored values are written back every call, even when skipped.
- Int64 prefs are stored in JSON as a STRING. `PrefService::SetInt64` does `base::Int64ToValue`; `GetInt64` does `base::ValueToInt64(value)` and
  `return integer.value_or(0)` (a JSON number instead of a string would read as 0 in release builds, and trip a DCHECK in debug builds).
  `base/json/values_util.h`: "Converts between an int64_t and a string-flavored Value (a human readable string of that number)."

## 3. Is it skipped anywhere?

Findings (OFFICIAL-SOURCE unless stated):
- Headless: no check anywhere in the chain. Not skipped. (Nothing in the code above tests headless.)
- Automation (`--enable-automation`): not checked in the chain. Also, Playwright 1.64.0 does not pass `--enable-automation` for Chromium
  (it is not in `chromiumSwitches`; LOCAL). Your note that it does is not borne out by the local file.
- Command-line switch: none found in the chain. The only gate is feature flags and the domain check:
  - Domain-joined PC: `base::win::IsEnrolledToDomain()` skips the probe. (Can't be used; not changing Windows.)
  - Feature gate at the trigger: `kAutofillAiWalletPrivatePasses` OR `kAutofillAmbientAutofill` must be enabled (item 7 above).
    Turning `AutofillAiWalletPrivatePasses` off with `--disable-features=` removes THIS trigger. See section 5 about how duplicates behave.
- Enterprise policy: none found in the chain. UNKNOWN whether a policy could turn off the features.
- Password manager disabled (`credentials_enable_service` etc.): not checked in this chain. The trigger is in autofill, not password manager. Not skipped.
- Chrome for Testing: not checked. Playwright's chromium-1248 is a Chromium (not Chrome for Testing) build; irrelevant to the code.
- `--disable-field-trial-config` (Playwright passes it) only turns off server-side experiments; it does not change the code-default of the two features.

## 4. Playwright's default launch arguments (LOCAL)

File: node_modules/playwright-core/lib/coreBundle.js, `chromiumSwitches` (~line 36206), used by `_innerDefaultArgs` (~line 44754).
Relevant ones: `--disable-field-trial-config`, `--disable-extensions`, `--disable-sync`, `--no-first-run`, `--password-store=basic` (no effect on Windows),
`--use-mock-keychain` (macOS), and `--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion`.
None of them affects the blank-password probe. Your `args` are appended after the defaults (`chromeArguments.push(...args)`).
Headless adds `--headless`; `channel: 'chromium'` uses the full Chromium binary (new headless), `getExecutableName` returns "chromium".
Playwright has NO option to pre-set Local State. But `launchPersistentContext(userDataDir, ...)` accepts a real folder, and Chromium will read
`<userDataDir>/Local State` if it exists. Playwright only forbids `--user-data-dir` inside `args`. (LOCAL line ~44747.)

## 5. Safest ways to stop the attempts (no Windows changes)

### Option A (recommended): pre-seed Local State in a per-test temp user-data-dir
In fixtures.js create a temp folder, write `Local State` into it, pass that folder to `launchPersistentContext(dir, ...)` instead of `''`, delete the folder after `context.close()`.
JSON (note: nested object, the int64 is a STRING, the bool is a real boolean):
```json
{"password_manager":{"os_password_blank":false,"os_password_last_changed":"16000000000000000"}}
```
Why it works (code above): `pref_last_changed > 0` is true and the real `last_changed` (about 1.34e16 for a 2025/26 date if microseconds since 1601; smaller
in any other unit) is `<=` 16000000000000000, so `need_recheck = false` and LogonUser is never called; `blank_password=false` means "has a password", which is the true answer for you.
Why I trust it most: it targets the exact cache the code consults, independent of which caller triggered it (covers every path in section 1, including the password-fill ones), and does not
depend on feature flags, switch ordering or Chromium defaults. Cost: if I am wrong about the int64-as-string form or about Local State loading, one launch makes one failed logon.
Unverified details (UNKNOWN): that a partial Local State (only these keys) is accepted without side effects (Chromium normally tolerates this; Playwright's own code at
coreBundle.js ~72548 also reads a Local State file); that Local State has no tamper protection for these keys (the protection I know of is for profile Secure Preferences; not checked).

### Option B: turn the trigger feature off
`args: [..., '--disable-features=<Playwright's list>,AutofillAiWalletPrivatePasses']`.
GOTCHA (UNKNOWN, from general Chromium command-line behaviour, not verified here): when a switch appears twice, Chromium's CommandLine keeps only the LAST value, so your
`--disable-features` would REPLACE Playwright's list, not add to it. Playwright's list would have to be repeated in full (or use `ignoreDefaultArgs` and rebuild). It also
removes only the item-7 trigger, not other callers (section 1 "other paths"). Weaker than A.

### Option C: reuse one profile across tests
Launch once with a persistent user-data-dir (a fixed folder), so Local State is written at exit with the real values, and later launches skip the probe. Works by the same cache,
but costs exactly one attempt on the first ever launch (and one after each Windows password change), breaks test isolation (extension storage/alarms persist between tests), and
a crash before exit may leave no Local State written. Option A with a seed is the same effect with zero attempts.

Best: A, optionally plus B as a second belt (only if B's switch-merging is verified).
Alternative with no Chromium involvement: none that avoids Windows settings. (Not recommended: domain join, blank password, policy changes; all excluded by the brief.)

## 6. Other startup sources that call LogonUser / CredUI

- Searched the chain: `LogonUser` appears only in `CheckBlankPasswordWithPrefs` in `password_manager_util_win.cc` (file-level check). A repo-wide search was not completed (the search tool used returned truncated results), so "only call in all of Chromium" is UNKNOWN.
- `CredUIPromptForWindowsCredentials` is only in `AuthenticateUser()` (shows a prompt before revealing/filling a password); user-driven, not at startup. `LsaLogonUser` in the same file validates what the user types in that prompt (a different API, and only after a prompt).
- Windows Hello: `authenticator_win.cc` uses `IUserConsentVerifierStatics::CheckAvailabilityAsync` (the 30 s biometrics cache) and `RequestVerification...Async`. These are not LogonUser and should not create a 4625 (UNKNOWN: not tested).
- NTLM/Negotiate HTTP auth to a server could also produce logon events but needs a server challenge; our tests have no such pages. Not examined in source.

## 7. What is not proven, and the cheapest tests

1. Not proven that the ChromeAutofillClient constructor path is what fires in our launches (tab-helper attach for headless/about:blank, feature on with no country).
   Cheapest test: Option A, then run ONE test (`HEADED` not needed) and compare Security 4625 count before and after. Expect 0 new.
   Risk: if it still logs one, that costs 1 attempt. Before the test, ask Bilal to check the lockout counter is low (wait 10+ minutes since the last burst, per the 10 attempts / 10 minutes policy).
2. Verify the file format first at zero risk: write the seeded `Local State`, launch NOTHING, and just have the fixture code unit-checked (JSON parses; value is a string). Optional extra zero-risk check:
   after one seeded launch closes, open the temp dir's `Local State` and confirm `password_manager.os_password_last_changed` now holds a real (smaller) value written by Chromium
   (proves Chromium read and rewrote it). A different/absent value means the probe did not run its pref path.
3. If a 4625 still appears after Option A, the cause is a different call site. Then compare the event's timing with test start (the event's process creation time and "Process ID" will show which chrome.exe process, browser or helper) before changing anything else.

## Sources
- https://github.com/chromium/chromium/blob/main/chrome/browser/password_manager/password_manager_util_win.cc (also read at tag 156.0.8078.4 via raw.githubusercontent.com)
- https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/chrome/browser/password_manager/password_manager_util_win.cc
- https://github.com/chromium/chromium/blob/156.0.8078.4/chrome/browser/ui/autofill/chrome_autofill_client.cc
- https://github.com/chromium/chromium/blob/main/components/autofill/core/browser/foundations/autofill_client.cc
- https://github.com/chromium/chromium/blob/main/chrome/browser/device_reauth/win/authenticator_win.cc
- https://github.com/chromium/chromium/blob/main/chrome/browser/device_reauth/win/device_authenticator_win.cc
- https://github.com/chromium/chromium/blob/main/chrome/browser/device_reauth/win/device_auth_availability_checker_win.cc
- https://github.com/chromium/chromium/blob/main/chrome/browser/chrome_browser_main_win.cc
- https://github.com/chromium/chromium/blob/156.0.8078.4/components/autofill/core/common/autofill_features.cc
- https://github.com/chromium/chromium/blob/156.0.8078.4/base/feature.h
- https://github.com/chromium/chromium/blob/156.0.8078.4/components/password_manager/core/common/password_manager_pref_names.h
- https://github.com/chromium/chromium/blob/156.0.8078.4/components/prefs/pref_service.cc
- https://github.com/chromium/chromium/blob/156.0.8078.4/base/json/values_util.h
- Caller list found with Sourcegraph stream search (UNOFFICIAL index of the same GitHub mirror): sourcegraph.com, query `CanAuthenticateWithBiometricOrScreenLock`, `SupportsDeviceReauth`.
- LOCAL: node_modules/playwright-core/lib/coreBundle.js (chromiumSwitches ~36206, _innerDefaultArgs ~44745), node_modules/playwright-core/browsers.json

## 8. Measured (2026-10-14, 22:56, Claude Code, one launch)
One headless launch of chromium-1248 (`launchPersistentContext` on a temp folder whose `Local State` held
`{"password_manager":{"os_password_blank":true,"os_password_last_changed":"16000000000000000"}}`), open for ~6 s on about:blank:
- After close, `Local State` kept our `password_manager` keys and gained 26 top-level keys of Chromium's own, so a partial Local State is read and merged.
- `os_password_last_changed` had been rewritten to `"13429484889640363"` (a real time, microseconds since 1601, about 2026). So the blank-password check RAN during this short launch, with no long delay: this is why every fresh-profile launch made one attempt.
- `os_password_blank` stayed `true`. A real LogonUser probe on an account with a password would have written `false`, so the check used the stored answer and did not call LogonUser.
- Also written: `had_biometrics_available` and `is_biometric_avaliable` (Windows Hello availability; not a LogonUser call).
Consequence for the tests (test/e2e/browser-profile.js): seed `os_password_blank: true` on purpose, because it doubles as a tripwire. The time value is rewritten after every check, probe or not, so it can't show whether a probe happened; the blank answer can.
Still to confirm by Bilal (needs an admin terminal): no new 4625 events for chrome.exe after 22:50 on 2026-10-14.
