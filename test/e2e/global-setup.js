// Builds the test copy of the extension in test/.build/extension before the tests run.
// The copy differs from the real extension in three ways only:
// 1. The fake chat's address (http://127.0.0.1) is granted up front in host_permissions, because
//    automated tests can't click Chrome's "Allow access?" prompt (notes/research/playwright.md, section 5).
// 2. config.js turns the dev-mode alert log on (that one setting only).
// 3. Test-only probe scripts are added under test-probes/.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'test', '.build', 'extension');
const FAKE_CHAT_ORIGIN = 'http://127.0.0.1/*';

module.exports = async function globalSetup() {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });

  for (const item of ['manifest.json', 'src', 'icons']) {
    const from = path.join(ROOT, item);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(BUILD, item), { recursive: true });
  }

  const manifestPath = path.join(BUILD, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions || []), FAKE_CHAT_ORIGIN];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Change only the debugLog setting, so any setting added to config.js later reaches the test copy too.
  const configPath = path.join(BUILD, 'src', 'background', 'config.js');
  const config = fs.readFileSync(configPath, 'utf8');
  const testConfig = config.replace('debugLog: false', 'debugLog: true');
  if (testConfig === config) {
    throw new Error('global-setup: "debugLog: false" not found in src/background/config.js, so the debug log could not be switched on.');
  }
  fs.writeFileSync(configPath, testConfig);

  fs.cpSync(path.join(__dirname, 'probes'), path.join(BUILD, 'test-probes'), { recursive: true });
};
