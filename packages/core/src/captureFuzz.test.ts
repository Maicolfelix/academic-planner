import { describe, expect, it } from 'vitest';
import { parseCaptureProposals, type CaptureMode } from './captureProposals.js';
import { tokenize, type QuickCaptureContext } from './captureShared.js';

/**
 * Punctuation is a weak signal, not a wall: a comma, a line break or a double space inserted INSIDE a phrase must not change
 * what is understood. Every variant is compared with the same text typed cleanly, field by field:
 *   A  only the title wording differs        B  same fields, only status/description/alternatives differ
 *   C  a field was lost                      D  the number of proposals changed
 *   E  a date, hour or subject was reassigned
 * C, D and E are bugs. "Today" is Monday 5 October 2026, 12:00 in Bogotá.
 */
const NOW = new Date('2026-10-05T17:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ctx: QuickCaptureContext = {
  now: NOW,
  timeZone: 'America/Bogota',
  subjects: [
    { id: id(1), name: 'Redes de Computadores' },
    { id: id(2), name: 'Programación' },
    { id: id(3), name: 'Bases de Datos' },
    { id: id(4), name: 'Ciberseguridad' },
  ],
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
};

interface Row {
  title: string;
  type: string;
  subject: string;
  date: string | null;
  time: string | null;
  alternatives: string;
  status: string;
  description: string | null;
  blockedOn: string[];
}
const rows = (text: string, mode: CaptureMode): Row[] =>
  parseCaptureProposals(text, ctx, mode).proposals.map((p) => ({
    title: p.title.value,
    type: p.type.value,
    subject: p.subject.kind === 'EXISTING' ? p.subject.name : p.subject.kind,
    date: p.date.value,
    time: p.time.value,
    alternatives: p.time.alternatives.join('/'),
    status: p.status,
    description: p.description.value,
    blockedOn: p.blockingIssues.map((b) => b.field),
  }));

type Class = 'same' | 'A' | 'B' | 'C' | 'D' | 'E';
const FIELDS = ['type', 'subject', 'date', 'time'] as const;
const key = (r: Row) => FIELDS.map((f) => r[f]).join('|');

/**
 * `flagged`: a field that is missing but whose proposal is NEEDS_REVIEW and blocked on exactly that field is a question for
 * the student, not a silent loss (a genuinely ambiguous reading is allowed to ask).
 */
function classify(base: Row[], got: Row[]): { cls: Class; flagged: boolean } {
  if (base.length !== got.length) return { cls: 'D', flagged: false };
  let lost = false;
  let reassigned = false;
  let flagged = true;
  base.forEach((b, i) => {
    for (const f of FIELDS) {
      const x = b[f];
      const y = got[i]![f];
      if (x === y) continue;
      if (x && !y) {
        lost = true;
        if (got[i]!.status === 'READY' || !got[i]!.blockedOn.some((o) => o === f || o === 'date')) {
          flagged = false;
        }
      } else if (x && y) reassigned = true;
    }
  });
  if (reassigned) {
    return {
      cls: base.map(key).sort().join() === got.map(key).sort().join() ? 'B' : 'E',
      flagged: false,
    };
  }
  if (lost) return { cls: 'C', flagged };
  const extra = base.some(
    (r, i) =>
      r.description !== got[i]!.description ||
      r.alternatives !== got[i]!.alternatives ||
      r.status !== got[i]!.status,
  );
  if (extra) return { cls: 'B', flagged: false };
  const titles = base.some((r, i) => r.title.toLowerCase() !== got[i]!.title.toLowerCase());
  return { cls: titles ? 'A' : 'same', flagged: false };
}

describe('the 360 variants of the QA (seed 7): C = 0, D = 0, E = 0 — and nothing else differs either', () => {
  const bases = [
    'Tengo un examen de redes el lunes a las 7 am y un ensayo de ciberseguridad el martes a las 9 el martes y tengo dos tareas para dos dias distintos uno para el jueves y otro para el viernes las dos tareas tengo que entregarlas a las 8 AM',
    'tengo un parcial de redes para el dia jueves de la otra semana y un ensayo de ciberseguridad para el lunes el parcial de redes es a las 7:00 AM y el ensayo es a las 5 de la tarde',
    'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM',
  ];
  // The generator of the QA, unchanged: 1-4 random word boundaries become a newline or a comma, optionally capitalising.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const variants: { mode: CaptureMode; base: string; text: string }[] = [];
  for (const mode of ['QUICK', 'INBOX'] as const) {
    for (const base of bases) {
      const words = base.split(' ');
      for (let n = 0; n < 60; n++) {
        const cuts = new Set<number>();
        const k = 1 + Math.floor(rnd() * 4);
        while (cuts.size < k) cuts.add(1 + Math.floor(rnd() * (words.length - 1)));
        const text = words
          .map((w, i) => {
            if (!cuts.has(i)) return (i ? ' ' : '') + w;
            const sep = rnd() < 0.5 ? '\n' : ', ';
            return sep + (rnd() < 0.5 ? w[0]!.toUpperCase() + w.slice(1) : w);
          })
          .join('');
        variants.push({ mode, base, text });
      }
    }
  }

  it('there are 360 of them and every one reads exactly like the clean text', () => {
    expect(variants).toHaveLength(360);
    const counts: Record<string, number> = {};
    const bad: string[] = [];
    for (const v of variants) {
      const { cls } = classify(rows(v.base, v.mode), rows(v.text, v.mode));
      counts[cls] = (counts[cls] ?? 0) + 1;
      if (cls !== 'same') bad.push(`${cls} ${v.mode} ${JSON.stringify(v.text)}`);
    }
    expect(bad).toEqual([]);
    expect(counts).toEqual({ same: 360 });
  });
});

describe('a comma, a line break or a double space inside a phrase, in every position of every family', () => {
  const FAMILIES: Record<string, string[]> = {
    'quantity + type': [
      'tengo dos tareas uno para el jueves y otro para el viernes las dos tareas las entrego a las 8 AM',
      'tengo tres quices para el martes y dos talleres para el viernes',
    ],
    'type + de + subject': [
      'ensayo de ciberseguridad para el lunes y parcial de redes para el jueves',
      'Tengo un taller de programación el martes a las 3 pm y un quiz de bases de datos el jueves a las 10 am',
    ],
    'preposition + date': [
      'tengo un parcial de redes para el día jueves de la otra semana y un ensayo de ciberseguridad para el lunes',
      'tengo una tarea para el viernes y un parcial para el martes de la próxima semana',
    ],
    'reference + noun': [
      'tengo dos tareas uno para el jueves y otro para el viernes ambas a las 8 AM',
      'tengo dos tareas uno para el jueves y otro para el viernes esas tareas son a las 8 AM',
      'tengo dos tareas uno para el jueves y otro para el viernes los dos los entrego a las 8 AM',
      'tengo examen de redes el lunes y quiz de ciberseguridad el martes los dos a las 7 am',
      'Tarea de redes el jueves. Es a las 7 am.',
    ],
    'verb + time': [
      'tengo que entregar el informe de laboratorio el miércoles a las 11 am',
      'tengo parcial de redes el lunes y lo presento a las 9 am',
    ],
    'description cue': [
      'tengo tarea de programación el viernes, hay que subirla en PDF al campus',
      'Parcial de redes el lunes a las 7 am, estudiar VLAN, subnetting y routing estático',
      'Reunión de semillero el viernes a las 3 pm, llevar el portátil',
    ],
    titles: [
      'Tarea de programación el viernes',
      'Proyecto de grado el viernes',
      'Lectura del capítulo 4 el martes',
      'Informe final del proyecto el martes',
    ],
    'list + hours': [
      'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM',
    ],
  };
  const SEPARATORS = [', ', '\n', '  '];

  for (const [family, texts] of Object.entries(FAMILIES)) {
    it(`${family}: never a lost, reassigned or extra activity`, () => {
      let total = 0;
      const problems: string[] = [];
      const counts: Record<string, number> = {};
      for (const text of texts) {
        const words = text.split(' ');
        for (const mode of ['QUICK', 'INBOX'] as const) {
          const base = rows(text, mode);
          for (let i = 1; i < words.length; i++) {
            for (const sep of SEPARATORS) {
              const variant = words.slice(0, i).join(' ') + sep + words.slice(i).join(' ');
              const { cls, flagged } = classify(base, rows(variant, mode));
              total++;
              counts[cls] = (counts[cls] ?? 0) + 1;
              // D and E are never acceptable; a lost field only when the proposal asks for it (NEEDS_REVIEW on that field).
              if (cls === 'D' || cls === 'E' || (cls === 'C' && !flagged)) {
                problems.push(`${cls} ${mode} ${JSON.stringify(variant)}`);
              }
            }
          }
        }
      }
      expect(problems).toEqual([]);
      expect(total).toBeGreaterThan(100);
    });
  }

  it('a proposal that was READY and correct never becomes READY with another date, hour or subject', () => {
    // the invariant behind E: punctuation can make the engine ask, never make it wrong with confidence
    const text =
      'tengo un parcial de redes el lunes y un ensayo de ciberseguridad el martes el parcial de redes es a las 7:00 AM y el ensayo es a las 5 de la tarde';
    const words = text.split(' ');
    const base = rows(text, 'QUICK');
    for (let i = 1; i < words.length; i++) {
      for (const sep of SEPARATORS) {
        const got = rows(words.slice(0, i).join(' ') + sep + words.slice(i).join(' '), 'QUICK');
        for (const g of got.filter((r) => r.status === 'READY')) {
          expect(
            base.some((b) => key(b) === key(g)),
            `READY with data nobody wrote: ${key(g)} (${sep === '\n' ? '\\n' : JSON.stringify(sep)} at ${i})`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('weak punctuation, at the token level', () => {
  const breaks = (text: string) => tokenize(text).map((t) => [t.raw, t.afterBreak] as const);
  const broken = (text: string) =>
    breaks(text)
      .filter(([, b]) => b)
      .map(([w]) => w);

  it('a comma after a word that cannot end a clause is not a boundary', () => {
    expect(broken('tengo dos, tareas para el, dia jueves de, redes')).toEqual([]);
    expect(broken('tengo un, examen y, ademas el ensayo es, a las 5')).toEqual([]);
  });

  it('a comma before "de"/"del" is not a boundary, nor one before a number that counts the word before it', () => {
    expect(broken('ensayo, de ciberseguridad')).toEqual([]);
    expect(broken('lectura del capítulo, 4')).toEqual([]);
  });

  it('a real clause boundary stays one', () => {
    expect(broken('parcial de redes el lunes, quiz de bases el martes')).toEqual(['quiz']);
    expect(broken('tarea el jueves; ensayo el viernes')).toEqual(['ensayo']);
    expect(broken('lunes 5, martes 6')).toEqual(['martes']);
  });

  it('never changes the text: raw words and offsets are as typed', () => {
    const text = 'tengo dos, tareas';
    const tokens = tokenize(text);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['tengo', 'dos', 'tareas']);
    expect(tokens.map((t) => t.raw)).toEqual(['tengo', 'dos', 'tareas']);
  });
});
