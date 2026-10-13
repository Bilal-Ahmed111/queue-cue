// Tiny static web server for the automated tests: serves test/fake-chat/ at http://127.0.0.1:4173/.
// Started automatically by Playwright (see webServer in playwright.config.js).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'fake-chat');
const PORT = Number(process.env.FAKE_CHAT_PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  // Never serve anything outside test/fake-chat/.
  if (path.relative(ROOT, filePath).startsWith('..')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Fake chat server on http://127.0.0.1:${PORT}/`);
});
