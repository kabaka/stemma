// static-server.mjs — a KIT-OWNED, in-process, loopback-only static file server
// the browser tools serve the consumer's BUILT app from while auditing.
//
// WHY A KIT-OWNED SERVER (and not a long-lived consumer process)
//   The app-exec harness runs the consumer's launch command TO COMPLETION and
//   then invokes the audit hook (it captures the child's output; it is not a
//   supervisor of a long-lived daemon). The faithful, containment-safe model is
//   therefore: the harness runs the consumer's OWN build/export command (their
//   code) which emits static files into a repo-local, containment-checked
//   directory and EXITS; then this kit-owned server serves those files on
//   127.0.0.1:<ephemeral> while the managed chromium audits them. No detached
//   consumer daemon escapes the harness's process-tree kill, and navigation is
//   loopback-only by construction.
//
// HARDENING
//   - Binds ONLY 127.0.0.1 (never 0.0.0.0). The kit chooses an ephemeral port.
//   - Serves ONLY files under the containment-checked root; every request path
//     is normalized and re-confined (no "..", no absolute escape, no symlink-out
//     via realpath). A request outside the root → 403, never a read.
//   - GET/HEAD only; no directory listing (serves index.html for a dir).
//   - Bounded per-file size; a tiny static MIME map; no execution of anything.

import { createServer } from 'node:http';
import { createReadStream, statSync, realpathSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { isContained } from '../lib/binding.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB per served file

// Start a loopback-only static server rooted at `realRoot` (an already
// realpath'd, contained absolute dir). Returns { baseUrl, port, close() }.
export function startStaticServer(realRoot) {
  const canonicalRoot = realpathSync(realRoot);
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain' }); res.end('method not allowed'); return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }); res.end('bad request'); return;
    }
    if (pathname.includes('\0')) { res.writeHead(400); res.end('bad request'); return; }
    // Normalize and confine. Strip the leading slash so join stays under root,
    // then re-check containment against the canonical root (defeats "..").
    const relPath = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    let target = join(canonicalRoot, relPath);
    if (!isContained(canonicalRoot, target) && target !== canonicalRoot) {
      res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return;
    }
    // Directory → index.html.
    try {
      if (existsSync(target) && statSync(target).isDirectory()) {
        target = join(target, 'index.html');
      }
    } catch { /* fall through to 404 */ }
    if (!existsSync(target)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    // Realpath the final target and re-confine (no symlink escaping the root).
    let real;
    try { real = realpathSync(target); } catch { res.writeHead(404); res.end('not found'); return; }
    if (!isContained(canonicalRoot, real) && real !== canonicalRoot) {
      res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return;
    }
    let st;
    try { st = statSync(real); } catch { res.writeHead(404); res.end('not found'); return; }
    if (!st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    if (st.size > MAX_FILE_BYTES) { res.writeHead(413, { 'content-type': 'text/plain' }); res.end('too large'); return; }
    const type = MIME[extname(real).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'x-content-type-options': 'nosniff' });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(real);
    stream.on('error', () => { try { res.destroy(); } catch { /* */ } });
    stream.pipe(res);
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on('error', rejectPromise);
    // 127.0.0.1 ONLY — never 0.0.0.0. Port 0 → ephemeral kit-chosen port.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr.port;
      resolvePromise({
        baseUrl: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
