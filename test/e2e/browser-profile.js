// A fresh, safe profile folder for every test browser.
// Why (notes/research/windows-logon.md): on Windows, Chromium checks whether the Windows password is blank
// by trying to sign in to the account with an empty password (LogonUser), and only remembers the answer in
// the profile folder's "Local State" file. With an empty profile for every test, every launch tried again,
// and each try was a failed Windows sign-in (event 4625). A test run's bursts locked Bilal's account
// (2026-10-14). So each profile starts with the answer already in Local State, and Chromium skips the check.
// Tripwire: the answer we fill in is "blank", which a real check could never write back for an account
// that has a password. If it reads "not blank" after the browser closes, Chromium did ask Windows: the run
// stops, and no test browser starts again until a person deletes the stop file.
const fs = require('fs');
const os = require('os');
const path = require('path');

const STOP_FILE = path.resolve(__dirname, '..', '.build', 'STOP-windows-sign-in.txt');

// Chromium skips the check while the stored time is later than the password's last change. Int64 settings
// are stored as strings. 16000000000000000 microseconds after 1601 is about the year 2108.
const SEED = { password_manager: { os_password_blank: true, os_password_last_changed: '16000000000000000' } };

function assertNotStopped() {
  if (!fs.existsSync(STOP_FILE)) return;
  throw new Error('Test browsers are switched off because Chromium may have tried to sign in to Windows:\n' +
    fs.readFileSync(STOP_FILE, 'utf8') + '\nFind out why before deleting ' + STOP_FILE + ' (see test/e2e/browser-profile.js).');
}

function makeProfile() {
  assertNotStopped();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-cue-profile-'));
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify(SEED));
  return dir;
}

function stop(reason) {
  fs.mkdirSync(path.dirname(STOP_FILE), { recursive: true });
  fs.writeFileSync(STOP_FILE, new Date().toISOString() + ': ' + reason + '\n');
  throw new Error('Stopping all test browsers: ' + reason);
}

// Call once the browser has closed.
function finishProfile(dir) {
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(path.join(dir, 'Local State'), 'utf8'));
  } catch (e) {
    // Checked below.
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.warn('Could not delete the test profile ' + dir + ': ' + e.message);
  }
  if (!state) stop('the test profile\'s Local State file was missing or unreadable after the browser closed');
  const answer = state.password_manager && state.password_manager.os_password_blank;
  if (answer !== true) stop('Chromium changed the stored "blank Windows password" answer to ' + JSON.stringify(answer));
}

// Launches Chromium on a safe profile. Returns the context; pass it to close() afterwards.
async function launch(chromium, options) {
  const dir = makeProfile();
  let context;
  try {
    context = await chromium.launchPersistentContext(dir, options);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw error;
  }
  context.__queueCueProfile = dir;
  return context;
}

async function close(context) {
  await context.close();
  finishProfile(context.__queueCueProfile);
}

module.exports = { launch, close, assertNotStopped, STOP_FILE, SEED };
