#!/usr/bin/env node
// A4-0 spike tooling: NOT product code. Writes the synthetic .ics fixtures used to observe how Google Calendar,
// Apple Calendar and Outlook treat a feed like the one A4 would publish. No real student data, no dependencies.
//
//   node docs/spikes/a4-calendar-feed/generate.mjs                      the committed fixtures (fixed dates, Oct 2026)
//   node docs/spikes/a4-calendar-feed/generate.mjs --alarms-in 50       alarm events start 50 and 70 min from now
//   node docs/spikes/a4-calendar-feed/generate.mjs --no-hints --suffix -nohints   same, without REFRESH-INTERVAL/TTL
//   options: --out <dir> (default: this folder)  --anchor YYYY-MM-DD (a Monday; default 2026-10-19)
//
// The serializer below is a throwaway for the spike (escape, fold by OCTETS, CRLF); A4-1 will write the real one.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? true);
};
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(String(arg('out', here)));
const anchor = String(arg('anchor', '2026-10-19'));
const alarmsIn = arg('alarms-in', null);
const hints = !process.argv.includes('--no-hints');
const suffix = String(arg('suffix', ''));

// Bogotá is UTC-5 all year (no daylight saving): enough for a synthetic fixture.
const BOGOTA = 5 * 3600_000;
const day = (offset) => {
  const [y, m, d] = anchor.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset));
};
const ymd = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');
const utc = (date) => `${date.toISOString().slice(0, 19).replaceAll(/[-:]/g, '')}Z`;
/** Wall-clock Bogotá "HH:mm" on the date `offset` days after the anchor -> UTC Date. */
const bogota = (offset, hhmm) => {
  const [h, min] = hhmm.split(':').map(Number);
  const d = day(offset);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, min) + BOGOTA);
};
const minus = (date, minutes) => new Date(date.getTime() - minutes * 60_000);
const plus = (date, minutes) => new Date(date.getTime() + minutes * 60_000);

// ── RFC 5545 text rules (3.3.11 escaping, 3.1 folding at 75 OCTETS, CRLF) ──
const escapeText = (s) =>
  s.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n');
function fold(line) {
  const chunks = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = chunks.length === 0 ? 75 : 74; // continuation lines start with one space
    if (bytes + size > limit) {
      // never end a physical line in a space (tools that trim trailing whitespace would corrupt the text)
      const trailing = / +$/.exec(current)?.[0] ?? '';
      chunks.push(current.slice(0, current.length - trailing.length));
      current = trailing;
      bytes = Buffer.byteLength(trailing);
    }
    current += ch;
    bytes += size;
  }
  chunks.push(current);
  return chunks.map((c, i) => (i === 0 ? c : ` ${c}`)).join('\r\n');
}

const V1_STAMP = new Date('2026-10-07T12:00:00Z');
const V2_STAMP = new Date('2026-10-07T18:00:00Z');

/** A deadline is a SHORT block that ENDS at dueAt (the A4 design under test). */
const deadline = (uid, dueAt, summary, stamp) => ({
  uid,
  stamp,
  start: minus(dueAt, 15),
  end: dueAt,
  summary,
  transparent: true,
});
const allDay = (uid, date, summary, stamp) => ({ uid, stamp, date, summary, transparent: true });
const klass = (uid, start, end, summary, stamp) => ({ uid, stamp, start, end, summary });

function alarmEvents() {
  if (alarmsIn === null) {
    const relStart = bogota(4, '10:00'); // Fri 10:00 Bogotá
    const absStart = bogota(4, '11:00');
    return { relStart, absStart, absTrigger: minus(absStart, 15) };
  }
  const now = Date.now();
  const relStart = new Date(Math.ceil((now + Number(alarmsIn) * 60_000) / 60_000) * 60_000);
  const absStart = plus(relStart, 20);
  return { relStart, absStart, absTrigger: minus(absStart, 15) };
}

const UNICODE_TITLE = 'Evaluación ¿Qué tal, Pérez; Núñez? ñ á é í ó ú \\ fin';
const LONG_TITLE =
  'Título muy largo para forzar el pliegue de líneas por octetos: acentuación, diseño, año, ' +
  'señalización, ¿qué pasará con los caracteres de varios bytes justo en el límite de 75 octetos? ' +
  'ñandú ñandú ñandú áéíóú áéíóú áéíóú fin';

function build(version) {
  const v2 = version === 2;
  const { relStart, absStart, absTrigger } = alarmEvents();
  const events = [
    // 1. deadline with time, 23:59 Bogotá. v2: TIME change, no SEQUENCE bump.
    v2
      ? deadline(
          'spike-activity-entrega@academic-planner',
          bogota(4, '23:30'),
          'Entrega Proyecto (Bases de Datos)',
          V2_STAMP,
        )
      : deadline(
          'spike-activity-entrega@academic-planner',
          bogota(4, '23:59'),
          'Entrega Proyecto (Bases de Datos)',
          V1_STAMP,
        ),
    // 2. exam: dueAt 08:30 treated as a DEADLINE (08:15-08:30). v2: TIME change WITH SEQUENCE:1.
    v2
      ? {
          ...deadline(
            'spike-activity-parcial@academic-planner',
            bogota(2, '09:30'),
            'Parcial de Redes (Redes de Computadores)',
            V2_STAMP,
          ),
          sequence: 1,
        }
      : deadline(
          'spike-activity-parcial@academic-planner',
          bogota(2, '08:30'),
          'Parcial de Redes (Redes de Computadores)',
          V1_STAMP,
        ),
    // 3. all-day (no time). v2: TITLE change, no SEQUENCE bump.
    v2
      ? allDay(
          'spike-activity-taller@academic-planner',
          day(3),
          'Taller de Bioestadística (título cambiado en v2)',
          V2_STAMP,
        )
      : allDay(
          'spike-activity-taller@academic-planner',
          day(3),
          'Taller de Bioestadística (sin hora)',
          V1_STAMP,
        ),
    // 4. class 08:00-10:00 Bogotá. v2: TITLE change WITH SEQUENCE:1.
    v2
      ? {
          ...klass(
            `spike-class-redes-${ymd(day(0))}@academic-planner`,
            bogota(0, '08:00'),
            bogota(0, '10:00'),
            'Redes de Computadores (aula cambiada en v2)',
            V2_STAMP,
          ),
          sequence: 1,
        }
      : klass(
          `spike-class-redes-${ymd(day(0))}@academic-planner`,
          bogota(0, '08:00'),
          bogota(0, '10:00'),
          'Redes de Computadores',
          V1_STAMP,
        ),
    // 5. second occurrence, same pattern the next week: byte-identical in v2.
    klass(
      `spike-class-redes-${ymd(day(7))}@academic-planner`,
      bogota(7, '08:00'),
      bogota(7, '10:00'),
      'Redes de Computadores',
      V1_STAMP,
    ),
    // 8/9. alarms, byte-identical in v2.
    {
      uid: 'spike-alarm-relative@academic-planner',
      stamp: V1_STAMP,
      start: relStart,
      end: plus(relStart, 15),
      summary: 'Alarma relativa (-30 min)',
      alarm: { trigger: 'TRIGGER:-PT30M' },
    },
    {
      uid: 'spike-alarm-absolute@academic-planner',
      stamp: V1_STAMP,
      start: absStart,
      end: plus(absStart, 15),
      summary: 'Alarma absoluta (15 min antes)',
      alarm: { trigger: `TRIGGER;VALUE=DATE-TIME:${utc(absTrigger)}` },
    },
    // 7. long title (folding by octets), byte-identical in v2.
    klass(
      'spike-long-title@academic-planner',
      bogota(1, '14:00'),
      bogota(1, '14:30'),
      LONG_TITLE,
      V1_STAMP,
    ),
  ];
  // 6. unicode/escaping: present in v1, DELETED in v2.
  if (!v2) {
    events.splice(
      5,
      0,
      klass(
        'spike-unicode@academic-planner',
        bogota(1, '10:00'),
        bogota(1, '10:30'),
        UNICODE_TITLE,
        V1_STAMP,
      ),
    );
  }
  // v2 ADDS one event.
  if (v2) {
    events.push(
      klass(
        'spike-new-in-v2@academic-planner',
        bogota(2, '15:00'),
        bogota(2, '16:00'),
        'Evento nuevo en v2',
        V2_STAMP,
      ),
    );
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Academic Planner//A4 spike//ES',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Academic Planner (spike A4)',
    ...(hints ? ['REFRESH-INTERVAL;VALUE=DURATION:PT10M', 'X-PUBLISHED-TTL:PT10M'] : []),
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${utc(e.stamp)}`,
      `LAST-MODIFIED:${utc(e.stamp)}`,
    );
    if (e.sequence) lines.push(`SEQUENCE:${e.sequence}`);
    if (e.date) {
      lines.push(
        `DTSTART;VALUE=DATE:${ymd(e.date)}`,
        `DTEND;VALUE=DATE:${ymd(plus(e.date, 24 * 60))}`,
      );
    } else {
      lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.transparent) lines.push('TRANSP:TRANSPARENT');
    if (e.alarm) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText('Recordatorio de prueba')}`,
        e.alarm.trigger,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

fs.mkdirSync(out, { recursive: true });
for (const version of [1, 2]) {
  const file = path.join(out, `spike-v${version}${suffix}.ics`);
  fs.writeFileSync(file, build(version), 'utf8');
  process.stdout.write(`wrote ${file}\n`);
}
