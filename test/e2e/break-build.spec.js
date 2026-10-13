// Reviewer's "try to break it" tests for the test copy built by global-setup.js.
// Plain file checks, no browser. They make sure the test copy differs from the real extension only
// in the ways global-setup.js promises, and that nothing test-only leaks into the real extension.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'test', '.build', 'extension');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

// Runs a config.js file the way the service worker would and returns QueueCue.config.
function loadConfig(file) {
  const sandbox = { self: {} };
  sandbox.self = sandbox;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return sandbox.QueueCue.config;
}

test('the real manifest asks for no site access up front and has nothing test-only', () => {
  const manifest = readJson(path.join(ROOT, 'manifest.json'));
  const text = JSON.stringify(manifest);
  expect(manifest.host_permissions || []).toEqual(
    (manifest.host_permissions || []).filter((p) => p === 'https://ntfy.sh/*'));
  expect(manifest.permissions || []).not.toContain('<all_urls>');
  expect(text).not.toContain('127.0.0.1');
  expect(text).not.toContain('test-probes');
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.content_security_policy).toBeUndefined();
});

test('the real config keeps the debug log off', () => {
  expect(loadConfig(path.join(ROOT, 'src', 'background', 'config.js')).debugLog).toBe(false);
});

test('the test copy differs from the real extension only in the promised ways', () => {
  const real = readJson(path.join(ROOT, 'manifest.json'));
  const copy = readJson(path.join(BUILD, 'manifest.json'));
  const { host_permissions: copyHosts, ...copyRest } = copy;
  const { host_permissions: realHosts, ...realRest } = real;
  expect(copyRest).toEqual(realRest);
  expect(copyHosts).toEqual([...(realHosts || []), 'http://127.0.0.1/*']);

  // Every src file is byte-for-byte the same, except config.js.
  const realFiles = listFiles(path.join(ROOT, 'src')).sort();
  const copyFiles = listFiles(path.join(BUILD, 'src')).sort();
  expect(copyFiles).toEqual(realFiles);
  for (const file of realFiles) {
    if (file === 'background/config.js') continue;
    const a = fs.readFileSync(path.join(ROOT, 'src', file));
    const b = fs.readFileSync(path.join(BUILD, 'src', file));
    expect(b.equals(a), `${file} differs in the test copy`).toBe(true);
  }

  // config.js in the copy changes debugLog and nothing else.
  const realConfig = loadConfig(path.join(ROOT, 'src', 'background', 'config.js'));
  const copyConfig = loadConfig(path.join(BUILD, 'src', 'background', 'config.js'));
  expect(copyConfig).toEqual({ ...realConfig, debugLog: true });
});

test('extension code makes no network calls except to ntfy.sh and loads no remote code', () => {
  const srcFiles = listFiles(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js') || f.endsWith('.html'));
  for (const file of srcFiles) {
    const text = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    const urls = text.match(/https?:\/\/[^\s'"`)]+/g) || [];
    for (const url of urls) {
      expect(url, `${file} mentions ${url}`).toMatch(/^https:\/\/ntfy\.sh(\/|$)/);
    }
    expect(text, `${file} uses eval or new Function`).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    // importScripts may only load files packaged with the extension.
    for (const m of text.matchAll(/importScripts\(([^)]*)\)/g)) {
      expect(m[1], `${file} importScripts`).not.toMatch(/\/\//);
    }
  }
});

test('nothing in src/ refers to test-only files or the fake chat', () => {
  for (const file of listFiles(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    expect(text, file).not.toMatch(/test-probes|fake-chat|FakeTawk|127\.0\.0\.1|__qc/);
  }
});
