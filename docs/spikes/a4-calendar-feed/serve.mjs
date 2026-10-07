#!/usr/bin/env node
// A4-0 spike tooling: NOT product code and NOT part of Academic Planner. A tiny static server for the spike fixtures
// that LOGS every request, so the refresh behaviour of Google/Apple/Outlook is measured on the server side too
// (exact time, user agent, whether the client sends If-None-Match / If-Modified-Since).
//
//   node docs/spikes/a4-calendar-feed/serve.mjs [--port 8080] [--dir <folder with the .ics files>] [--no-conditional]
//
//   GET /feed.ics             the CURRENT version (v1 at start)            Content-Type: text/calendar; charset=utf-8
//   GET /feed-nohints.ics     the same without REFRESH-INTERVAL/TTL (needs spike-v1-nohints.ics, see generate.mjs)
//   GET /switch/v2, /switch/v1  publish another version; the exact time is printed (write it down)
//   GET /                     which version is live
//
// It listens on localhost only. To give a calendar client a PUBLIC HTTPS address use any tunnel or static host you
// trust (see README.md); nothing here stores credentials, and the fixtures contain only synthetic data.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? true);
};
const dir = path.resolve(String(arg('dir', path.dirname(fileURLToPath(import.meta.url)))));
const port = Number(arg('port', 8080));
const conditional = !process.argv.includes('--no-conditional');
let live = 1;

const log = (line) => process.stdout.write(`${new Date().toISOString()}  ${line}\n`);
const file = (variant) => path.join(dir, `spike-v${live}${variant}.ics`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const note = [
    `${req.method} ${url.pathname}`,
    `ua="${req.headers['user-agent'] ?? ''}"`,
    req.headers['if-none-match'] ? `if-none-match=${req.headers['if-none-match']}` : '',
    req.headers['if-modified-since'] ? `if-modified-since=${req.headers['if-modified-since']}` : '',
    req.headers['x-forwarded-for'] ? `xff=${req.headers['x-forwarded-for']}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const switchTo = /^\/switch\/v([12])$/.exec(url.pathname);
  if (switchTo) {
    live = Number(switchTo[1]);
    log(`PUBLISHED v${live}  <-- write this time down`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`live: v${live}\n`);
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`live: v${live}\n`);
    return;
  }
  const variant =
    url.pathname === '/feed.ics' ? '' : url.pathname === '/feed-nohints.ics' ? '-nohints' : null;
  if (variant === null || !fs.existsSync(file(variant))) {
    log(`${note} -> 404`);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found\n');
    return;
  }
  const body = fs.readFileSync(file(variant));
  const etag = `"${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;
  const lastModified = fs.statSync(file(variant)).mtime.toUTCString();
  if (conditional && req.headers['if-none-match'] === etag) {
    log(`${note} -> 304 (v${live}${variant})`);
    res.writeHead(304, { ETag: etag }).end();
    return;
  }
  log(`${note} -> 200 v${live}${variant} ${body.length} bytes`);
  res.writeHead(200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="spike.ics"',
    'Cache-Control': 'no-store',
    ...(conditional ? { ETag: etag, 'Last-Modified': lastModified } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(port, '127.0.0.1', () => {
  log(
    `serving ${dir} on http://127.0.0.1:${port}/feed.ics (v${live}); conditional GET ${conditional ? 'on' : 'off'}`,
  );
});
