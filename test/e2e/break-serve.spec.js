// Reviewer's "try to break it" tests for test/serve.js, the fake chat's web server.
// Starts its own copy on a spare port so the main server used by the other tests is never at risk.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { test, expect } = require('@playwright/test');

const PORT = 4198;
const SERVE = path.resolve(__dirname, '..', 'serve.js');

// Sends a request with the path exactly as written (no normalising by a URL library).
function rawGet(urlPath) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (error) => resolve({ status: 0, body: '', error: error.code }));
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

let server;

test.beforeAll(async () => {
  server = spawn(process.execPath, [SERVE], { env: { ...process.env, FAKE_CHAT_PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('Fake chat server')) resolve(); });
    server.on('exit', (code) => reject(new Error('serve.js exited early with code ' + code)));
  });
});

test.afterAll(() => {
  if (server && server.exitCode === null) server.kill();
});

test('refuses every way of escaping test/fake-chat', async () => {
  const attempts = [
    '/../package.json',
    '/../../package.json',
    '/..%2f..%2fpackage.json',
    '/..%2F..%2FCLAUDE.md',
    '/..%5c..%5cpackage.json',
    '/%2e%2e/%2e%2e/package.json',
    '/%2e%2e%2f%2e%2e%2fmanifest.json',
    '/..%2f..%2fsrc%2fbackground%2fconfig.js',
    '/..%2fserve.js',
    '/C:%5cWindows%5cwin.ini',
    '/%2f%2fetc%2fpasswd'
  ];
  for (const attempt of attempts) {
    const res = await rawGet(attempt);
    expect([403, 404], `${attempt} gave ${res.status}`).toContain(res.status);
    expect(res.body).not.toContain('queue-cue');
    expect(res.body).not.toContain('QueueCue');
  }
});

test('still serves the fake chat files', async () => {
  expect((await rawGet('/')).body).toContain('Fake Tawk.to Chat');
  expect((await rawGet('/fake-tawk.js')).status).toBe(200);
  expect((await rawGet('/no-vendor.html')).status).toBe(200);
  expect((await rawGet('/missing.html')).status).toBe(404);
});

test('a malformed request gets an error reply and does not crash the server', async () => {
  for (const bad of ['/%E0%A4%A', '/%', '/%00', '/a%00.html']) {
    const res = await rawGet(bad);
    expect(res.status, `${bad} gave ${res.status} ${res.error || ''}`).toBeGreaterThanOrEqual(400);
  }
  // The server must still be up for the next request.
  const after = await rawGet('/');
  expect(after.status, 'server died after a malformed request').toBe(200);
});
