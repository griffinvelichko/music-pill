#!/usr/bin/env node
// Zero-dependency static server for the playground, examples and browser tests.
//
//   node scripts/serve.mjs                    -> http://127.0.0.1:4391 (repo root)
//   node scripts/serve.mjs --open /playground/
//   node scripts/serve.mjs --port 4391 --port 4392   (second origin for CORS tests)
//
// Supports HTTP Range requests (Safari/WebKit require them for media).
// Test-only path prefixes, served from the repo root:
//   /cors/...    adds Access-Control-Allow-Origin: *   (correct cross-origin setup)
//   /nocors/...  no CORS headers                        (misconfigured server)
//   /slow/...    delays the response by 1.5 s           (late media readiness)
//   /csp/...     adds a strict Content-Security-Policy    (no 'unsafe-inline')
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const ports = [];
let open = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') ports.push(Number(args[++i]));
  else if (args[i] === '--open') open = args[++i];
}
if (ports.length === 0) ports.push(Number(process.env.PORT) || 4391);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.md': 'text/plain; charset=utf-8',
};

function handler(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const headers = { 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  let delay = 0;
  if (pathname.startsWith('/cors/')) {
    pathname = pathname.slice(5);
    headers['access-control-allow-origin'] = '*';
    headers['access-control-expose-headers'] = 'content-length, content-range, accept-ranges';
  } else if (pathname.startsWith('/nocors/')) {
    pathname = pathname.slice(7);
  } else if (pathname.startsWith('/csp/')) {
    pathname = pathname.slice(4);
    headers['content-security-policy'] =
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'";
  } else if (pathname.startsWith('/slow/')) {
    pathname = pathname.slice(5);
    delay = 1500;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'access-control-allow-headers': 'range' });
    return res.end();
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root + sep) || file.includes(`${sep}node_modules${sep}`) || file.includes(`${sep}.git${sep}`)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  let stat;
  try {
    stat = statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, headers);
    return res.end('not found');
  }
  headers['content-type'] = TYPES[extname(file)] ?? 'application/octet-stream';
  const send = () => {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : stat.size - 1;
      end = Math.min(end, stat.size - 1);
      start = Math.max(0, start);
      if (start > end) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': stat.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  };
  if (delay) setTimeout(send, delay);
  else send();
}

for (const port of ports) {
  createServer(handler).listen(port, '127.0.0.1', () => {
    console.log(`music-pill static server: http://127.0.0.1:${port}/`);
  });
}

if (open) {
  const url = `http://127.0.0.1:${ports[0]}${open}`;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  setTimeout(() => spawn(cmd, [url], { stdio: 'ignore', shell: process.platform === 'win32', detached: true }).unref(), 300);
  console.log(`opening ${url}`);
}
