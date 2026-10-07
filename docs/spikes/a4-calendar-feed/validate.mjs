#!/usr/bin/env node
// A4-0 spike tooling: NOT product code. Checks .ics files two ways:
//   1. parse them with ical.js (Mozilla; an implementation independent of generate.mjs) and read the events back;
//   2. structural rules of RFC 5545 that a lenient parser would let through (CRLF, 75-octet lines, UTF-8, UID/DTSTAMP,
//      DTEND after DTSTART, balanced BEGIN/END, unique UIDs).
// ical.js is NOT a dependency of the project. Install it OUTSIDE the repository and point --lib at that folder:
//   npm install --prefix <some temp dir> ical.js
//   node docs/spikes/a4-calendar-feed/validate.mjs --lib <that temp dir> docs/spikes/a4-calendar-feed/spike-v1.ics
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { ROBUSTNESS_CASES, normalizeText } from './serializer-cases.mjs';

const argv = process.argv.slice(2);
const libAt = argv.indexOf('--lib');
const lib = libAt >= 0 ? path.resolve(argv[libAt + 1]) : null;
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lib');
if (!lib || files.length === 0) {
  process.stderr.write('usage: validate.mjs --lib <dir with ical.js installed> <file.ics>...\n');
  process.exit(2);
}
const resolved = createRequire(path.join(lib, 'x.js')).resolve('ical.js');
const loaded = await import(pathToFileURL(resolved).href);
const ICAL = loaded.default ?? loaded;
const version = JSON.parse(
  fs.readFileSync(path.join(lib, 'node_modules', 'ical.js', 'package.json'), 'utf8'),
).version;

let failures = 0;
const say = (s) => process.stdout.write(`${s}\n`);

for (const file of files) {
  const raw = fs.readFileSync(file);
  const problems = [];
  const warnings = [];

  // ── bytes and lines ──
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    problems.push('not valid UTF-8');
    text = raw.toString('utf8');
  }
  if (/(^|[^\r])\n/.test(text))
    problems.push('a line ends in LF without CR (RFC 5545 requires CRLF)');
  if (!text.endsWith('\r\n')) problems.push('the file does not end with CRLF');
  const lines = text.split('\r\n');
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((l, i) => {
    const octets = Buffer.byteLength(l);
    if (octets > 75) problems.push(`line ${i + 1} has ${octets} octets (> 75)`);
    if ([...l].some((ch) => (ch.charCodeAt(0) < 32 && ch !== '\t') || ch.charCodeAt(0) === 127)) {
      problems.push(`line ${i + 1} has a control character`);
    }
  });
  // unfolded logical lines
  const logical = [];
  for (const l of lines) {
    if (l.startsWith(' ') || l.startsWith('\t')) logical[logical.length - 1] += l.slice(1);
    else logical.push(l);
  }
  // a fold must not leave a broken character: unfolding in bytes must equal unfolding in text
  const names = logical.map((l) => l.split(/[:;]/)[0]);
  const stack = [];
  for (const l of logical) {
    if (l.startsWith('BEGIN:')) stack.push(l.slice(6));
    if (l.startsWith('END:') && stack.pop() !== l.slice(4)) problems.push(`unbalanced ${l}`);
  }
  if (stack.length) problems.push(`unclosed ${stack.join(',')}`);
  if (logical[0] !== 'BEGIN:VCALENDAR' || logical.at(-1) !== 'END:VCALENDAR')
    problems.push('not wrapped in VCALENDAR');
  for (const required of ['VERSION', 'PRODID']) {
    if (!names.includes(required)) problems.push(`missing ${required}`);
  }

  // ── independent parse (ical.js) ──
  let events = [];
  try {
    const root = new ICAL.Component(ICAL.parse(text));
    events = root.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c));
  } catch (err) {
    problems.push(`ical.js could not parse it: ${err.message}`);
  }
  // ── the serializer contract (serializer-cases.mjs): every title must read back EXACTLY and inject nothing ──
  if (path.basename(file).startsWith('spike-robustness')) {
    if (events.length !== ROBUSTNESS_CASES.length) {
      problems.push(
        `expected ${ROBUSTNESS_CASES.length} events, ical.js read ${events.length}: a title injected or swallowed a component`,
      );
    }
    for (const [id, raw] of ROBUSTNESS_CASES) {
      const e = events.find((ev) => ev.uid === `spike-robustness-${id}`);
      if (!e) problems.push(`case ${id}: event not found`);
      else if (e.summary !== normalizeText(raw))
        problems.push(`case ${id}: the title did not read back exactly`);
      else if (
        e.component
          .getAllProperties()
          .some((pr) => ['attendee', 'description', 'organizer'].includes(pr.name))
      ) {
        problems.push(`case ${id}: an injected property appeared`);
      }
    }
    say(`serializer contract: ${ROBUSTNESS_CASES.length} cases checked`);
  }
  const uids = new Set();
  for (const e of events) {
    const c = e.component;
    const uid = e.uid;
    if (!uid) problems.push('a VEVENT has no UID');
    if (uids.has(uid)) problems.push(`duplicate UID ${uid}`);
    uids.add(uid);
    if (!c.hasProperty('dtstamp')) problems.push(`${uid}: no DTSTAMP`);
    if (!c.hasProperty('dtstart')) problems.push(`${uid}: no DTSTART`);
    const start = e.startDate;
    const end = e.endDate;
    if (start && end && end.compare(start) <= 0)
      problems.push(`${uid}: DTEND is not after DTSTART`);
    if (start && !start.isDate && start.zone?.tzid !== 'UTC')
      warnings.push(`${uid}: DTSTART is not UTC`);
  }

  say(`\n== ${path.basename(file)} (ical.js ${version}) ==`);
  say(`events read back by ical.js: ${events.length}`);
  for (const e of events) {
    const kind = e.startDate?.isDate ? 'DATE     ' : 'DATE-TIME';
    say(
      `  ${kind} ${String(e.startDate)} -> ${String(e.endDate)}  ${e.uid}  ${JSON.stringify(e.summary)}`,
    );
  }
  say(`errors:   ${problems.length === 0 ? 'none' : ''}`);
  for (const p of problems) say(`  - ${p}`);
  say(`warnings: ${warnings.length === 0 ? 'none' : ''}`);
  for (const w of warnings) say(`  - ${w}`);
  failures += problems.length;
}
process.exit(failures ? 1 : 0);
