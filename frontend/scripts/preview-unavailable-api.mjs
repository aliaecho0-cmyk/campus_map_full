// Local manual test only: serve dist while all API requests deliberately stall.
// No production requests, credentials or database are used.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (pathname.startsWith('/api/')) {
    console.log('Deliberately stalled API request:', req.method, pathname);
    req.resume();
    const timer = setTimeout(() => res.writeHead(503).end(), 30000);
    res.on('close', () => clearTimeout(timer));
    return;
  }
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403).end(); return;
  }
  try {
    const body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
server.listen(4174, '127.0.0.1', () => console.log('Unavailable-API preview: http://127.0.0.1:4174'));
process.on('SIGINT', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
