import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const publicFiles = new Set([
  'index.html', 'THE_INDIAN_SKILLS.html', 'admin.html', 'admin.js', 'favicon.svg', 'connection-check.html',
  'logo.png.jpeg', 'qr-code.png.jpeg', 'marketing management.jpeg', 'branding management.jpeg',
  'traffic management.jpeg', 'influence management.jpeg', 'finance management.jpeg',
  'marketing-management.pdf', 'branding-management.pdf', 'traffic-management.pdf',
  'influence-management.pdf', 'finance-management.pdf'
]);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };

export function startServer(port = 5501) {
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filename = path.resolve(root, relative);
      if (relative.includes('\\') || relative.split('/').includes('..') ||
          !filename.startsWith(root + path.sep) ||
          (!publicFiles.has(relative) && !/^assets\/[a-zA-Z0-9_./-]+\.js$/.test(relative))) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const stat = await fs.stat(filename);
      if (!stat.isFile()) { response.writeHead(404); response.end(); return; }
      const headers = { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
      let start = 0, end = stat.size - 1, status = 200;
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (!match || (!match[1] && !match[2])) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
        start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      }
      headers['Content-Length'] = end - start + 1;
      response.writeHead(status, headers);
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(filename, { start, end });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 400);
      response.end('Unable to serve this file.');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server); });
  });
}
