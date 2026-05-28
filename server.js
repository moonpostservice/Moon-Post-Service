const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.mp3':  'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
};

function serveFile(filePath, res) {
  try {
    const content = fs.readFileSync(filePath);
    const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

http.createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);

  // Admin backstage — explicit before SPA fallback
  if (pathname === '/admin' || pathname === '/admin/') {
    serveFile(path.join(ROOT, 'admin/index.html'), res);
    return;
  }

  // Try exact static file
  const filePath = path.join(ROOT, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(filePath, res);
    return;
  }

  // SPA fallback
  serveFile(path.join(ROOT, 'index.html'), res);

}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
