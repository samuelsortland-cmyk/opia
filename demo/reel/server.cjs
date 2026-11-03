// Serves Opia's real renderer files for the Reel, with a stand-in for the Electron bridge.
// Usage: node demo/reel/server.cjs [port]   (then record demo/reel/storyboard.json)
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.argv[2] || 8790);
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.cjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/demo/reel/stage.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file);
  if (/\/renderer\/(index|panel)\.html$/.test(p)) body = body.toString().replace(/<head>/i, '<head><script src="/demo/reel/mock.js"></script>');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`reel stage on http://127.0.0.1:${PORT}/`));
