import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_IMPORT_MAX_PROPOSALS,
  buildScheduleProposals,
  cleanLabel,
  editDistance,
  extractClassCandidates,
  findDuplicateClass,
  matchSubject,
  parseLoneTime,
  parseScheduleDocument,
  parseTimeRange,
  parseWeekday,
  proposeSubjectName,
  type ExtractedDocument,
  type ExtractedWord,
  type SubjectRef,
} from './scheduleImport.js';

// ───────────────────────── Fixtures ─────────────────────────

const H = 20;
const CHAR = 11;

/** Words of `text` laid out from (x, y), like an OCR / PDF engine would report them. */
function at(text: string, x: number, y: number, confidence?: number): ExtractedWord[] {
  const out: ExtractedWord[] = [];
  let cursor = x;
  for (const t of text.split(' ')) {
    const width = t.length * CHAR;
    out.push({
      text: t,
      x: cursor,
      y,
      width,
      height: H,
      ...(confidence === undefined ? {} : { confidence }),
    });
    cursor += width + 8;
  }
  return out;
}

const doc = (...groups: ExtractedWord[][]): ExtractedDocument => ({
  pages: [{ page: 1, method: 'OCR', words: groups.flat() }],
});

const COLS = { lun: 200, mar: 420, mie: 640 };
const header = (labels = ['Lunes', 'Martes', 'Miércoles']) => [
  ...at('Hora', 20, 30),
  ...at(labels[0]!, COLS.lun, 30),
  ...at(labels[1]!, COLS.mar, 30),
  ...at(labels[2]!, COLS.mie, 30),
];

const REDES = { id: '11111111-1111-4111-8111-111111111111', name: 'Redes' };
const BASES = { id: '22222222-2222-4222-8222-222222222222', name: 'Bases de Datos' };
const ANATOMIA = { id: '33333333-3333-4333-8333-333333333333', name: 'Anatomía' };
const PROG1 = { id: '44444444-4444-4444-8444-444444444444', name: 'Programación I' };
const PROG2 = { id: '55555555-5555-4555-8555-555555555555', name: 'Programación II' };
const SUBJECTS: SubjectRef[] = [REDES, BASES, ANATOMIA];

// Monday 3 Aug 2026 .. Saturday 28 Nov 2026.
const PERIOD = { startDate: '2026-08-03', endDate: '2026-11-28' };
const ctx = { subjects: SUBJECTS, period: PERIOD };

const summarize = (d: ExtractedDocument) =>
  extractClassCandidates(d).candidates.map((c) => [c.weekday, c.startTime, c.endTime, c.label]);

// ───────────────────────── Days ─────────────────────────

describe('parseWeekday', () => {
  it.each([
    ['lunes', 1],
    ['Lunes', 1],
    ['LUNES', 1],
    ['lun', 1],
    ['Martes', 2],
    ['mar', 2],
    ['miércoles', 3],
    ['miercoles', 3],
    ['MIÉ', 3],
    ['mie', 3],
    ['jueves', 4],
    ['jue', 4],
    ['viernes', 5],
    ['vie', 5],
    ['sábado', 6],
    ['sabado', 6],
    ['sáb', 6],
    ['sab', 6],
    ['domingo', 7],
    ['dom', 7],
    ['Lunes:', 1],
    ['SAB.', 6],
  ])('%s -> %s', (token, expected) => {
    expect(parseWeekday(token)).toBe(expected);
  });

  it.each(['', 'marte', 'redes', 'lunar', 'hora', '08:00', 'martes2'])('%j is not a day', (t) => {
    expect(parseWeekday(t)).toBeNull();
  });
});

// ───────────────────────── Times ─────────────────────────

describe('parseTimeRange', () => {
  it.each([
    ['08:00-10:00', '08:00', '10:00'],
    ['08:00 - 10:00', '08:00', '10:00'],
    ['08:00 – 10:00', '08:00', '10:00'],
    ['08:00 — 10:00', '08:00', '10:00'],
    ['8:00-10:00', '08:00', '10:00'],
    ['8 a 10', '08:00', '10:00'],
    ['8-10', '08:00', '10:00'],
    ['8:00 a.m. - 10:00 a.m.', '08:00', '10:00'],
    ['8:00 AM - 10:00 AM', '08:00', '10:00'],
    ['08:00 hasta 10:00', '08:00', '10:00'],
    ['14:00-16:00', '14:00', '16:00'],
    ['2pm - 4pm', '14:00', '16:00'],
    ['2-4pm', '14:00', '16:00'],
    ['11 - 1pm', '11:00', '13:00'],
    ['12:00 - 1:00 pm', '12:00', '13:00'],
    ['07.00 - 09.00', '07:00', '09:00'],
    ['Redes 08:00-10:00 Aula 3', '08:00', '10:00'],
  ])('%s', (text, start, end) => {
    const r = parseTimeRange(text);
    expect(r).toMatchObject({ startTime: start, endTime: end, valid: true });
  });

  it('reports where the range sits in the text', () => {
    const r = parseTimeRange('Redes 08:00-10:00 Aula 3')!;
    expect('Redes 08:00-10:00 Aula 3'.slice(r.index, r.index + r.length)).toBe('08:00-10:00');
  });

  it.each(['Salón 301', 'Grupo 1-2', 'Redes', '', '08:00', '3-5', '301-A', 'Aula 12 - 14'])(
    '%j has no range',
    (text) => {
      expect(parseTimeRange(text)).toBeNull();
    },
  );

  it('flags a range that does not increase or is not a real time, keeping what it read', () => {
    expect(parseTimeRange('10:00-08:00')).toMatchObject({
      startTime: '10:00',
      endTime: '08:00',
      valid: false,
    });
    expect(parseTimeRange('10:00-10:00')?.valid).toBe(false);
    expect(parseTimeRange('25:00-26:00')?.valid).toBe(false);
    expect(parseTimeRange('08:90-10:00')?.valid).toBe(false);
  });
});

describe('parseLoneTime', () => {
  it.each([
    ['08:00', '08:00'],
    ['7:30', '07:30'],
    ['7am', '07:00'],
    ['7 pm', '19:00'],
    ['12am', '00:00'],
    ['Redes 14:00', '14:00'],
  ])('%s', (text, time) => {
    expect(parseLoneTime(text)?.time).toBe(time);
  });
  it.each(['301', 'Redes', '7', 'Salón 3', '25:00', '13pm'])('%j is not a time', (text) => {
    expect(parseLoneTime(text)).toBeNull();
  });
});

// ───────────────────────── Labels ─────────────────────────

describe('cleanLabel', () => {
  it.each([
    ['Redes', 'Redes'],
    ['MAT101 - Cálculo', 'Cálculo'],
    ['MAT 101: Cálculo', 'Cálculo'],
    ['Redes Salón 301', 'Redes'],
    ['Redes - Aula 3', 'Redes'],
    ['Redes (Sala B)', 'Redes'],
    ['Bases de Datos G2', 'Bases de Datos'],
    ['Bases de Datos Grupo 1', 'Bases de Datos'],
    ['  Redes  ', 'Redes'],
  ])('%j -> %j', (raw, clean) => {
    expect(cleanLabel(raw)).toBe(clean);
  });
});

// ───────────────────────── Subject matching ─────────────────────────

describe('matchSubject', () => {
  it('EXACT: same name ignoring case and accents', () => {
    expect(matchSubject('REDES', SUBJECTS)).toMatchObject({ status: 'EXACT', subjectId: REDES.id });
    expect(matchSubject('anatomia', SUBJECTS)).toMatchObject({
      status: 'EXACT',
      subjectId: ANATOMIA.id,
    });
    expect(matchSubject('Bases de Datos', SUBJECTS)).toMatchObject({
      status: 'EXACT',
      subjectId: BASES.id,
    });
  });

  it('EXACT: the label contains the whole name (extra words around it)', () => {
    expect(matchSubject('Redes Teoría', SUBJECTS)).toMatchObject({
      status: 'EXACT',
      subjectId: REDES.id,
    });
  });

  it('LIKELY: a name with an OCR slip is only SUGGESTED', () => {
    for (const [label, subject] of [
      ['Redcs', REDES],
      ['Bases de Datcs', BASES],
      ['Anatornia', ANATOMIA],
    ] as const) {
      expect(matchSubject(label, SUBJECTS), label).toMatchObject({
        status: 'LIKELY',
        subjectId: subject.id,
      });
    }
  });

  it('LIKELY: the label is the start of one longer name', () => {
    const subjects = [{ id: REDES.id, name: 'Redes de Computadores' }, BASES];
    expect(matchSubject('Redes', subjects)).toMatchObject({
      status: 'LIKELY',
      subjectId: REDES.id,
    });
  });

  it('AMBIGUOUS: similar names are never picked for the student', () => {
    const subjects = [PROG1, PROG2, REDES];
    const m = matchSubject('Programación', subjects);
    expect(m.status).toBe('AMBIGUOUS');
    expect(m.subjectId).toBeNull();
    expect(m.candidates.map((c) => c.name)).toEqual(['Programación I', 'Programación II']);
  });

  it('the exact name beats a longer one that merely contains it', () => {
    expect(matchSubject('Programación I', [PROG1, PROG2])).toMatchObject({
      status: 'EXACT',
      subjectId: PROG1.id,
    });
    expect(matchSubject('Programación II', [PROG1, PROG2])).toMatchObject({
      status: 'EXACT',
      subjectId: PROG2.id,
    });
  });

  it('MISSING: nothing fits, and a subject is never invented', () => {
    for (const label of ['Química', 'Salón', 'xx', '', 'Descanso']) {
      expect(matchSubject(label, SUBJECTS), label).toEqual({
        status: 'MISSING',
        subjectId: null,
        candidates: [],
      });
    }
    expect(matchSubject('Redes', []).status).toBe('MISSING');
  });

  it('a name two slips away is too far to suggest (the threshold is tight on purpose)', () => {
    expect(matchSubject('Redxxs', SUBJECTS).status).toBe('MISSING');
    expect(matchSubject('Bxsxs dx Dxtxs', SUBJECTS).status).toBe('MISSING');
    expect(matchSubject('Redcs', SUBJECTS).status).toBe('LIKELY');
  });

  it('does not match short, unrelated words by fuzziness', () => {
    expect(matchSubject('Red', SUBJECTS).status).not.toBe('EXACT');
    expect(matchSubject('Rojo', SUBJECTS).status).toBe('MISSING');
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('redes', 'redes')).toBe(0);
    expect(editDistance('redes', 'redcs')).toBe(1);
    expect(editDistance('redes', 'red')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

// ───────────────────────── Format A: table by days ─────────────────────────

describe('table by days', () => {
  it('reads the columns: each class lands on its own day', () => {
    const d = doc(
      header(),
      at('08:00 - 10:00', 20, 110),
      at('Redes', COLS.lun, 110),
      at('Anatomía', COLS.mar, 110),
      at('10:00 - 12:00', 20, 200),
      at('Bases de Datos', COLS.mie, 200),
    );
    expect(summarize(d)).toEqual([
      [1, '08:00', '10:00', 'Redes'],
      [2, '08:00', '10:00', 'Anatomía'],
      [3, '10:00', '12:00', 'Bases de Datos'],
    ]);
  });

  it('keeps long, left-aligned text in its own column', () => {
    const d = doc(
      header(),
      at('08:00 - 10:00', 20, 110),
      at('Bases de Datos Avanzadas', COLS.mar, 110),
    );
    expect(summarize(d)).toEqual([[2, '08:00', '10:00', 'Bases de Datos Avanzadas']]);
  });

  it('time labels that are single start times: the class ends where the next row starts', () => {
    const d = doc(
      header(),
      at('08:00', 20, 110),
      at('Redes', COLS.lun, 110),
      at('09:00', 20, 200),
      at('10:00', 20, 290),
      at('Anatomía', COLS.mar, 290),
      at('11:00', 20, 380),
    );
    expect(summarize(d)).toEqual([
      [1, '08:00', '09:00', 'Redes'],
      [2, '10:00', '11:00', 'Anatomía'],
    ]);
  });

  it('merges the same subject on touching rows into one class', () => {
    const d = doc(
      header(),
      at('08:00', 20, 110),
      at('Redes', COLS.lun, 110),
      at('09:00', 20, 200),
      at('Redes', COLS.lun, 200),
      at('10:00', 20, 290),
      at('11:00', 20, 380),
    );
    expect(summarize(d)).toEqual([[1, '08:00', '10:00', 'Redes']]);
  });

  it('rows whose own ranges touch are merged; rows with a gap between them are not', () => {
    const touching = doc(
      header(),
      at('08:00 - 09:00', 20, 110),
      at('Redes', COLS.lun, 110),
      at('09:00 - 10:00', 20, 200),
      at('Redes', COLS.lun, 200),
    );
    expect(summarize(touching)).toEqual([[1, '08:00', '10:00', 'Redes']]);
    const gap = doc(
      header(),
      at('08:00 - 09:00', 20, 110),
      at('Redes', COLS.lun, 110),
      at('09:30 - 10:30', 20, 200),
      at('Redes', COLS.lun, 200),
    );
    expect(summarize(gap)).toEqual([
      [1, '08:00', '09:00', 'Redes'],
      [1, '09:30', '10:30', 'Redes'],
    ]);
  });

  it('does not merge different subjects, nor the same one after a gap', () => {
    const d = doc(
      header(),
      at('08:00', 20, 110),
      at('Redes', COLS.lun, 110),
      at('09:00', 20, 200),
      at('Anatomía', COLS.lun, 200),
      at('10:00', 20, 290),
      at('Redes', COLS.lun, 290),
      at('11:00', 20, 380),
    );
    expect(summarize(d)).toEqual([
      [1, '08:00', '09:00', 'Redes'],
      [1, '09:00', '10:00', 'Anatomía'],
      [1, '10:00', '11:00', 'Redes'],
    ]);
  });

  it('the last row has no next label: no end is invented', () => {
    const d = doc(header(), at('08:00', 20, 110), at('Redes', COLS.lun, 110));
    expect(summarize(d)).toEqual([[1, '08:00', null, 'Redes']]);
  });

  it('a big jump between rows is not taken as the length of the class', () => {
    const d = doc(
      header(),
      at('08:00', 20, 110),
      at('Redes', COLS.lun, 110),
      at('09:00', 20, 200),
      at('10:00', 20, 290),
      at('16:00', 20, 380),
      at('Anatomía', COLS.mar, 290),
    );
    expect(summarize(d)).toEqual([
      [1, '08:00', '09:00', 'Redes'],
      [2, '10:00', null, 'Anatomía'],
    ]);
  });

  it('cells that carry their own time, with a room line that is not a subject', () => {
    const d = doc(
      header(),
      at('REDES', COLS.lun, 100),
      at('Salón 301', COLS.lun, 125),
      at('08:00-10:00', COLS.lun, 150),
      at('BASES DE DATOS', COLS.mar, 100),
      at('Aula B2', COLS.mar, 125),
      at('10:00-12:00', COLS.mar, 150),
      at('ANATOMÍA', COLS.lun, 260),
      at('14:00-16:00', COLS.lun, 285),
    );
    expect(summarize(d)).toEqual([
      [1, '08:00', '10:00', 'REDES'],
      [1, '14:00', '16:00', 'ANATOMÍA'],
      [2, '10:00', '12:00', 'BASES DE DATOS'],
    ]);
  });

  it('own time written BEFORE the name in the cell', () => {
    const d = doc(
      header(),
      at('08:00-10:00', COLS.lun, 100),
      at('Redes', COLS.lun, 125),
      at('Salón 301', COLS.lun, 150),
      at('10:00-12:00', COLS.lun, 210),
      at('Anatomía', COLS.lun, 235),
    );
    expect(summarize(d)).toEqual([
      [1, '08:00', '10:00', 'Redes'],
      [1, '10:00', '12:00', 'Anatomía'],
    ]);
  });

  it('abbreviated days and a Sunday column', () => {
    const d = doc(
      [...at('Hora', 20, 30), ...at('LUN', 200, 30), ...at('SÁB', 420, 30), ...at('DOM', 640, 30)],
      at('08:00 - 10:00', 20, 110),
      at('Redes', 200, 110),
      at('Anatomía', 420, 110),
      at('Bases', 640, 110),
    );
    expect(summarize(d).map((r) => r[0])).toEqual([1, 6, 7]);
  });

  it('empty rows and notes without time produce nothing', () => {
    const d = doc(
      header(),
      at('08:00 - 10:00', 20, 110),
      at('12:00 - 13:00', 20, 200),
      at('Almuerzo', COLS.mar, 200),
    );
    expect(summarize(d)).toEqual([[2, '12:00', '13:00', 'Almuerzo']]); // it is read; matching decides later
  });

  it('works the same on a PDF text layer (method does not matter)', () => {
    const d: ExtractedDocument = {
      pages: [
        {
          page: 1,
          method: 'PDF_TEXT',
          words: [...header(), ...at('08:00 - 10:00', 20, 110), ...at('Redes', COLS.lun, 110)],
        },
      ],
    };
    expect(summarize(d)).toEqual([[1, '08:00', '10:00', 'Redes']]);
  });
});

// ───────────────────────── Format B: list ─────────────────────────

describe('list by days', () => {
  const lines = (...texts: string[]) => doc(...texts.map((t, i) => at(t, 30, 30 + i * 40)));

  it('a heading per day and one class per line', () => {
    expect(
      summarize(
        lines(
          'Lunes',
          '08:00 - 10:00 Redes',
          '10:00 - 12:00 Anatomía',
          'Martes',
          '14:00 - 16:00 Bases de Datos',
        ),
      ),
    ).toEqual([
      [1, '08:00', '10:00', 'Redes'],
      [1, '10:00', '12:00', 'Anatomía'],
      [2, '14:00', '16:00', 'Bases de Datos'],
    ]);
  });

  it('day, time and name on the same line; headings with colon', () => {
    expect(
      summarize(lines('Lunes 08:00-10:00 Redes', 'Miércoles: 10:00 - 12:00 Anatomía')),
    ).toEqual([
      [1, '08:00', '10:00', 'Redes'],
      [3, '10:00', '12:00', 'Anatomía'],
    ]);
  });

  it('the name before the time', () => {
    expect(summarize(lines('Jueves', 'Redes 08:00 - 10:00'))).toEqual([
      [4, '08:00', '10:00', 'Redes'],
    ]);
  });

  it('a time on its own line takes the name from the next line; room lines are skipped', () => {
    expect(
      summarize(
        lines('Viernes', '08:00 - 10:00', 'REDES', 'Salón 301', '10:00 - 12:00', 'Anatomía'),
      ),
    ).toEqual([
      [5, '08:00', '10:00', 'REDES'],
      [5, '10:00', '12:00', 'Anatomía'],
    ]);
  });

  it('only a start time: the end is left missing, never invented', () => {
    expect(summarize(lines('Lunes', '08:00 Redes'))).toEqual([[1, '08:00', null, 'Redes']]);
  });

  it('a class before any day heading has no weekday', () => {
    expect(summarize(lines('08:00 - 10:00 Redes'))).toEqual([[null, '08:00', '10:00', 'Redes']]);
  });

  it('course codes, rooms and groups are not part of the name', () => {
    expect(summarize(lines('Martes', '08:00 - 10:00 MAT101 - Redes Salón 301'))).toEqual([
      [2, '08:00', '10:00', 'Redes'],
    ]);
  });

  it('a new heading drops a time that never got its name', () => {
    expect(summarize(lines('Lunes', '08:00 - 10:00', 'Martes', 'Redes'))).toEqual([]);
  });

  it('12-hour times', () => {
    expect(
      summarize(lines('Sábado', '8:00 a.m. - 10:00 a.m. Redes', '2pm - 4pm Anatomía')),
    ).toEqual([
      [6, '08:00', '10:00', 'Redes'],
      [6, '14:00', '16:00', 'Anatomía'],
    ]);
  });
});

// ───────────────────────── Proposals ─────────────────────────

describe('proposals', () => {
  const build = (d: ExtractedDocument, subjects = SUBJECTS) =>
    parseScheduleDocument(d, { subjects, period: PERIOD });

  it('a clean table -> READY CLASS proposals with the first date, weekly until the period ends', () => {
    const r = build(
      doc(
        header(),
        at('08:00 - 10:00', 20, 110),
        at('Redes', COLS.lun, 110),
        at('10:00 - 12:00', 20, 200),
        at('Bases de Datos', COLS.mie, 200),
      ),
    );
    expect(r.layout).toBe('TABLE');
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals[0]).toMatchObject({
      index: 0,
      type: 'CLASS',
      weekday: 1,
      startTime: '08:00',
      endTime: '10:00',
      subjectId: REDES.id,
      title: 'Redes',
      date: '2026-08-03', // the period starts on a Monday
      recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
      status: 'READY',
      missingFields: [],
      warnings: [],
      duplicateOf: null,
      conflicts: [],
    });
    expect(r.proposals[1]).toMatchObject({ weekday: 3, date: '2026-08-05', subjectId: BASES.id });
    expect(r.proposals[0]!.source).toMatchObject({ page: 1 });
    expect(r.proposals[0]!.source.rawText).toContain('Redes');
  });

  it('first occurrence: a Sunday class in a period that starts on a Monday is six days in', () => {
    const r = build(doc(at('Domingo', 30, 30), at('10:00 - 12:00 Redes', 30, 70)));
    expect(r.proposals[0]).toMatchObject({ weekday: 7, date: '2026-08-09' });
  });

  it('proposals come ordered by day and time', () => {
    const r = build(
      doc(
        at('Martes', 30, 30),
        at('08:00 - 10:00 Redes', 30, 70),
        at('Lunes', 30, 110),
        at('14:00 - 16:00 Anatomía', 30, 150),
        at('09:00 - 11:00 Bases de Datos', 30, 190),
      ),
    );
    expect(r.proposals.map((p) => [p.weekday, p.startTime])).toEqual([
      [1, '09:00'],
      [1, '14:00'],
      [2, '08:00'],
    ]);
    expect(r.proposals.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it('an OCR slip is only SUGGESTED: the subject stays empty until the student confirms', () => {
    const p = build(doc(at('Lunes', 30, 30), at('08:00 - 10:00 Redcs', 30, 70))).proposals[0]!;
    expect(p.subjectId).toBeNull();
    expect(p.subjectMatch).toMatchObject({ status: 'LIKELY', suggestedId: REDES.id });
    expect(p.title).toBe('Redcs'); // the text as read, until confirmed
    expect(p.status).toBe('REVIEW');
    expect(p.missingFields).toEqual(['subject']);
    expect(p.warnings.map((w) => w.code)).toEqual(['SUBJECT_LIKELY']);
  });

  it('an ambiguous subject offers candidates and chooses none', () => {
    const p = build(doc(at('Lunes', 30, 30), at('08:00 - 10:00 Programación', 30, 70)), [
      PROG1,
      PROG2,
    ]).proposals[0]!;
    expect(p.subjectId).toBeNull();
    expect(p.subjectMatch.status).toBe('AMBIGUOUS');
    expect(p.subjectMatch.suggestedId).toBeNull();
    expect(p.subjectMatch.candidates).toHaveLength(2);
    expect(p.warnings.map((w) => w.code)).toContain('SUBJECT_AMBIGUOUS');
  });

  it('an unknown subject keeps the text and is proposed as a NEW subject, without blocking the class', () => {
    const p = build(doc(at('Lunes', 30, 30), at('08:00 - 10:00 Química', 30, 70))).proposals[0]!;
    expect(p.subjectMatch.status).toBe('MISSING');
    expect(p.subjectId).toBeNull();
    expect(p.title).toBe('Química');
    expect(p.proposedName).toBe('Química');
    // creating the subject is the default, so nothing is missing and the class is ready as it is
    expect(p.status).toBe('READY');
    expect(p.missingFields).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it('a doubtful match still asks the student; an exact one proposes the subject own name', () => {
    const subjects: SubjectRef[] = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Programación I' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Programación II' },
      { id: '33333333-3333-4333-8333-333333333333', name: 'Redes' },
    ];
    const r = buildScheduleProposals(
      extractClassCandidates(
        doc(
          at('Lunes', 30, 30),
          at('08:00 - 10:00 Programación', 30, 70),
          at('10:00 - 12:00 Redes', 30, 110),
        ),
      ).candidates,
      { subjects, period: PERIOD },
    );
    expect(r[0]).toMatchObject({ status: 'REVIEW', missingFields: ['subject'] });
    expect(r[0]!.subjectMatch.status).toBe('AMBIGUOUS');
    expect(r[1]).toMatchObject({
      status: 'READY',
      subjectId: '33333333-3333-4333-8333-333333333333',
      proposedName: 'Redes',
    });
  });

  it('missing end time, missing weekday and an invalid range are flagged for review', () => {
    const r = build(
      doc(
        at('08:00 - 10:00 Redes', 30, 30), // no day yet
        at('Lunes', 30, 70),
        at('08:00 Anatomía', 30, 110), // no end
        at('10:00 - 08:00 Bases de Datos', 30, 150), // does not increase
      ),
    );
    const byTitle = Object.fromEntries(r.proposals.map((p) => [p.title, p]));
    expect(byTitle['Redes']).toMatchObject({ weekday: null, date: null, status: 'REVIEW' });
    expect(byTitle['Redes']!.missingFields).toEqual(['weekday']);
    expect(byTitle['Redes']!.warnings.map((w) => w.code)).toEqual(['MISSING_WEEKDAY']);
    expect(byTitle['Anatomía']!.missingFields).toEqual(['endTime']);
    expect(byTitle['Anatomía']!.warnings.map((w) => w.code)).toEqual(['MISSING_END_TIME']);
    expect(byTitle['Bases de Datos']!.warnings.map((w) => w.code)).toEqual(['INVALID_TIME']);
    expect(byTitle['Bases de Datos']).toMatchObject({
      startTime: '10:00',
      endTime: '08:00',
      status: 'REVIEW',
    });
  });

  it('low OCR confidence asks for a review; the number is never exposed', () => {
    const d = doc(at('Lunes', 30, 30), at('08:00 - 10:00', 30, 70, 90), at('Redes', 250, 70, 35));
    const p = build(d).proposals[0]!;
    expect(p.status).toBe('REVIEW');
    expect(p.warnings.map((w) => w.code)).toEqual(['LOW_CONFIDENCE']);
    expect(JSON.stringify(p)).not.toMatch(/35|"confidence"/);
  });

  it('an unsure number (OCR confuses 12 and 17) asks for a review even when the name is clear', () => {
    const d = doc(
      at('Lunes', 30, 30, 95),
      at('08:00 - 10:00', 30, 70, 95),
      at('Redes', 250, 70, 96),
    );
    expect(build(d).proposals[0]!.status).toBe('READY');
    const shaky = doc(
      at('Lunes', 30, 30, 95),
      at('08:00 - 10:00', 30, 70, 55),
      at('Redes', 250, 70, 96),
    );
    expect(build(shaky).proposals[0]!.warnings.map((w) => w.code)).toEqual(['LOW_CONFIDENCE']);
  });

  it('a table row label that was read with doubt also asks for a review', () => {
    const d = doc(header(), at('08:00 - 10:00', 20, 110, 60), at('Redes', COLS.lun, 110, 95));
    expect(build(d).proposals[0]!.warnings.map((w) => w.code)).toEqual(['LOW_CONFIDENCE']);
  });

  it('nothing readable: no proposals, an honest message', () => {
    const r = build(doc());
    expect(r.proposals).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['NOTHING_READ', 'LOW_TEXT']);
  });

  it('text without any schedule: no proposals', () => {
    const r = build(
      doc(
        at('Estimados estudiantes bienvenidos al semestre', 30, 30),
        at('Gracias por su atención', 30, 70),
      ),
    );
    expect(r.proposals).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('NOTHING_READ');
  });

  it('caps at the proposal limit and says so', () => {
    const lines: ExtractedWord[][] = [at('Lunes', 30, 20)];
    for (let i = 0; i < 50; i++) {
      const hour = 6 + Math.floor(i / 4);
      lines.push(
        at(
          `${String(hour).padStart(2, '0')}:${(i % 4) * 15 + 0}0 - ${String(hour + 1).padStart(2, '0')}:00 Materia${i}`,
          30,
          60 + i * 30,
        ),
      );
    }
    const r = build(doc(...lines));
    expect(r.proposals.length).toBeLessThanOrEqual(SCHEDULE_IMPORT_MAX_PROPOSALS);
    expect(r.proposals.length).toBe(SCHEDULE_IMPORT_MAX_PROPOSALS);
    expect(r.warnings.map((w) => w.code)).toContain('TOO_MANY_PROPOSALS');
  });

  it('the same class repeated (two pages) counts once', () => {
    const page = (n: number) => ({
      page: n,
      method: 'PDF_TEXT' as const,
      words: [...at('Lunes', 30, 30), ...at('08:00 - 10:00 Redes', 30, 70)],
    });
    expect(parseScheduleDocument({ pages: [page(1), page(2)] }, ctx).proposals).toHaveLength(1);
  });

  it('subject names do not leak: only the user subjects passed in are ever matched', () => {
    const p = build(doc(at('Lunes', 30, 30), at('08:00 - 10:00 Anatomía', 30, 70)), [REDES])
      .proposals[0]!;
    expect(p.subjectMatch.status).toBe('MISSING');
    expect(p.subjectId).toBeNull();
  });
});

// ───────────────────────── Duplicates ─────────────────────────

describe('findDuplicateClass', () => {
  // Monday 08:00-10:00 Bogotá = 13:00-15:00 UTC, weekly.
  const existing = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Redes',
    type: 'CLASS',
    subjectId: REDES.id,
    startAt: '2026-08-03T13:00:00.000Z',
    endAt: '2026-08-03T15:00:00.000Z',
    recurring: true,
  };
  const proposal = { subjectId: REDES.id, weekday: 1, startTime: '08:00', endTime: '10:00' };
  const tz = 'America/Bogota';

  it('the same subject, weekday and times is a duplicate', () => {
    expect(findDuplicateClass(proposal, [existing], tz)?.id).toBe(existing.id);
  });

  it.each([
    ['another subject', { subjectId: BASES.id }],
    ['another weekday', { weekday: 2 }],
    ['another start', { startTime: '09:00' }],
    ['another end', { endTime: '11:00' }],
  ])('%s is not a duplicate', (_label, change) => {
    expect(findDuplicateClass({ ...proposal, ...change }, [existing], tz)).toBeUndefined();
  });

  it('an overlapping but different class is a conflict, not a duplicate', () => {
    expect(
      findDuplicateClass({ ...proposal, startTime: '09:00', endTime: '11:00' }, [existing], tz),
    ).toBeUndefined();
  });

  describe('by dates (the series of both sides are known)', () => {
    // existing series: Mondays from 2026-08-03 to 2026-09-28
    const series = { ...existing, until: '2026-09-28' };
    const range = (from: string, until: string) => ({ ...proposal, range: { from, until } });

    it('the same class on overlapping dates is a duplicate', () => {
      expect(findDuplicateClass(range('2026-08-03', '2026-11-28'), [series], tz)?.id).toBe(
        existing.id,
      );
      expect(findDuplicateClass(range('2026-09-28', '2026-11-28'), [series], tz)?.id).toBe(
        existing.id,
      ); // they share the last Monday
    });

    it('the same class on DISJOINT dates is a legitimate second series, not a duplicate', () => {
      expect(findDuplicateClass(range('2026-10-05', '2026-11-28'), [series], tz)).toBeUndefined();
      expect(findDuplicateClass(range('2026-07-06', '2026-07-27'), [series], tz)).toBeUndefined();
    });

    it('a title that differs does not matter, and without dates the answer is the old one', () => {
      expect(
        findDuplicateClass(range('2026-08-03', '2026-11-28'), [{ ...series, title: 'Otro' }], tz),
      ).toBeDefined();
      expect(findDuplicateClass(proposal, [series], tz)).toBeDefined(); // no range: as before
      expect(findDuplicateClass(range('2026-10-05', '2026-11-28'), [existing], tz)).toBeDefined(); // no `until`
    });
  });

  it('a one-off block or a non-class is never a duplicate of a weekly class', () => {
    expect(findDuplicateClass(proposal, [{ ...existing, recurring: false }], tz)).toBeUndefined();
    expect(findDuplicateClass(proposal, [{ ...existing, type: 'STUDY' }], tz)).toBeUndefined();
  });

  it('uses the user timezone for the weekday and times', () => {
    // 02:00 UTC Tuesday is Monday 21:00 in Bogotá.
    const late = {
      ...existing,
      startAt: '2026-08-04T02:00:00.000Z',
      endAt: '2026-08-04T04:00:00.000Z',
    };
    expect(
      findDuplicateClass({ ...proposal, startTime: '21:00', endTime: '23:00' }, [late], tz),
    ).toBeDefined();
  });

  it('an incomplete proposal can not be a duplicate', () => {
    expect(findDuplicateClass({ ...proposal, subjectId: null }, [existing], tz)).toBeUndefined();
    expect(findDuplicateClass({ ...proposal, endTime: null }, [existing], tz)).toBeUndefined();
    expect(findDuplicateClass({ ...proposal, weekday: null }, [existing], tz)).toBeUndefined();
  });
});

// ───────────────────────── Robustness ─────────────────────────

describe('robustness', () => {
  it('never throws on odd input', () => {
    const junk = [
      '',
      ' ',
      '!!!',
      '08:00',
      '-',
      '10:00-',
      'Lunes Lunes Lunes',
      '\u0000',
      'ñandú',
      '99:99-99:99',
      '🙂🙂',
    ];
    const words = junk.flatMap((t, i) => at(t === '' ? 'x' : t, (i * 37) % 600, (i * 53) % 400));
    expect(() => parseScheduleDocument(doc(words), ctx)).not.toThrow();
    expect(() => parseScheduleDocument({ pages: [] }, ctx)).not.toThrow();
  });

  it('ignores zero-size boxes', () => {
    const d = doc([
      { text: 'Lunes', x: 0, y: 0, width: 0, height: 0 },
      ...at('08:00 - 10:00 Redes', 30, 70),
    ]);
    expect(() => parseScheduleDocument(d, ctx)).not.toThrow();
  });

  it('is fast on a large page', () => {
    const many: ExtractedWord[] = [];
    for (let i = 0; i < 3000; i++)
      many.push(...at(`w${i}`, (i % 30) * 60, Math.floor(i / 30) * 24));
    const t0 = Date.now();
    parseScheduleDocument(doc(many), ctx);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('buildScheduleProposals on no candidates is empty', () => {
    expect(buildScheduleProposals([], ctx)).toEqual([]);
  });
});

// ───────────────────────── Post-RC fix: compact ranges and calendar-axis noise ─────────────────────────

describe('compact time ranges (HHMM-HHMM)', () => {
  it.each([
    ['1900-2030', '19:00', '20:30'],
    ['1400-1615', '14:00', '16:15'],
    ['0800-0930', '08:00', '09:30'],
    ['800-930', '08:00', '09:30'],
    ['900-1030', '09:00', '10:30'],
    ['1900 – 2030', '19:00', '20:30'], // en dash, with spaces
    ['1900—2030', '19:00', '20:30'], // em dash
    ['1900−2030', '19:00', '20:30'], // minus sign
  ])('reads %s as %s–%s', (text, start, end) => {
    expect(parseTimeRange(text)).toMatchObject({ startTime: start, endTime: end, valid: true });
  });

  it('reports where the range sits, so the title can drop it', () => {
    const text = '1900-2030 ZISXA-Proyectos II REMOTO Proyecto';
    const r = parseTimeRange(text)!;
    expect(text.slice(r.index, r.index + r.length)).toBe('1900-2030');
  });

  it.each(['2560-2700', '1965-2030', '1900-2060', '9999-0000', '2400-2500'])(
    'does not accept %s as a time range',
    (text) => {
      expect(parseTimeRange(text)).toBeNull();
    },
  );

  it.each([
    '2019-2024', // a year range: only 5 minutes apart
    '207-215', // room numbers: the hour would be 2 a. m.
    '1900-1900',
    '2030-1900', // not increasing
    'Folio 120045-130045', // longer numbers are never cut into pieces
  ])('does not confuse %s with a class time', (text) => {
    expect(parseTimeRange(text)).toBeNull();
  });

  it('keeps the existing behaviour of regular ranges', () => {
    expect(parseTimeRange('08:00-10:00')).toMatchObject({ startTime: '08:00', endTime: '10:00' });
    expect(parseTimeRange('Aula 12 - 14 1900-2030')).toMatchObject({
      startTime: '19:00',
      endTime: '20:30',
    });
  });
});

// The calendar of the real case: day columns, an hour axis on the left, class blocks whose text starts with a compact range.
const GRID = { mie: 640, sab: 1300 };
const dayHeader = () => [
  ...at('Lunes', 200, 30),
  ...at('Martes', 420, 30),
  ...at('Miércoles', GRID.mie, 30),
  ...at('Jueves', 860, 30),
  ...at('Viernes', 1080, 30),
  ...at('Sábado', GRID.sab, 30),
];
const axis = () =>
  ['9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm'].flatMap(
    (t, i) => at(t, 20, 110 + i * 90),
  );
/** The block of the Wednesday class as OCR returned it, with the stray axis label "12pm" at the end. */
const proyectosBlock = () => [
  ...at('1900-2030', GRID.mie, 920),
  ...at('ZISXA-Proyectos II', GRID.mie, 944),
  ...at('REMOTO Proyecto 12pm', GRID.mie, 968),
];
const practicasBlock = () => [
  ...at('1400-1615', GRID.sab, 560),
  ...at('ZISXA-Practicas', GRID.sab, 584),
  ...at('Empresariales Practica', GRID.sab, 608),
  ...at('Empresariales 207 12pm', GRID.sab, 632),
];
const axisAsOneBlock = () => at('1pm 2pm 3pm 4pm 5pm pm 7pm E 12pm', 640 - 400, 300);

describe('compact ranges win over axis labels, and the axis is not a class', () => {
  it('the range is the time of the class; the stray "12pm" is ignored and leaves the title', () => {
    const d = doc(dayHeader(), axis(), proyectosBlock());
    expect(summarize(d)).toEqual([[3, '19:00', '20:30', 'ZISXA-Proyectos II REMOTO Proyecto']]);
  });

  it('the Saturday block: range 14:00–16:15, no new field for the room', () => {
    const d = doc(dayHeader(), axis(), practicasBlock());
    const [c] = extractClassCandidates(d).candidates;
    expect(c).toMatchObject({ weekday: 6, startTime: '14:00', endTime: '16:15' });
    expect(c!.label).not.toMatch(/1400|1615|12pm/);
    expect(c!.label).toMatch(/^ZISXA-Practicas Empresariales Practica Empresariales/);
  });

  it('the full case: exactly 2 classes, on Wednesday and Saturday, and no proposal made of the axis', () => {
    const d = doc(dayHeader(), axis(), proyectosBlock(), practicasBlock(), axisAsOneBlock());
    const found = summarize(d);
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.slice(0, 3))).toEqual([
      [3, '19:00', '20:30'],
      [6, '14:00', '16:15'],
    ]);
    for (const [, , , label] of found) expect(label).not.toMatch(/\d{4}-\d{4}|\b\d{1,2}\s?pm\b/i);
  });

  it('the exact OCR strings of the real case, one line per block', () => {
    const d = doc(
      dayHeader(),
      axis(),
      at('1900-2030 ZISXA-Proyectos II REMOTO Proyecto 12pm', GRID.mie, 920),
      at('1400-1615 ZISXA-Practicas Empresariales Practica Empresariales 207 12pm', GRID.sab, 560),
      at('1pm 2pm 3pm 4pm 5pm pm 7pm E 12pm', 200, 300),
    );
    const found = extractClassCandidates(d).candidates;
    expect(found.map((c) => [c.weekday, c.startTime, c.endTime])).toEqual([
      [3, '19:00', '20:30'],
      [6, '14:00', '16:15'],
    ]);
    expect(found[0]!.label).toBe('ZISXA-Proyectos II REMOTO Proyecto');
    // the room number the OCR read ("207") may stay: there is no room field and nothing is invented for it
    expect(found[1]!.label).toMatch(/^ZISXA-Practicas Empresariales Practica Empresariales\b/);
    expect(found[1]!.label).not.toMatch(/12pm|1400|1615/);
  });

  it('a cell with its own time does not borrow the label of the axis row into the text it shows', () => {
    const d = doc(dayHeader(), axis(), [
      ...at('1900-2030', GRID.mie, 920),
      ...at('ZISXA-Proyectos II', GRID.mie, 944),
      ...at('REMOTO Proyecto', GRID.mie, 968),
    ]);
    const [c] = extractClassCandidates(d).candidates;
    expect(c!.raw).toBe('1900-2030 ZISXA-Proyectos II REMOTO Proyecto');
    // a cell WITHOUT its own time still shows the row label it took its time from
    const bare = extractClassCandidates(doc(dayHeader(), axis(), at('Redes', GRID.mie, 920)))
      .candidates[0]!;
    expect(bare.raw).toMatch(/Redes .*(pm|am)/);
  });

  it('a line made almost only of axis labels is not a class (whatever the OCR slips)', () => {
    for (const text of [
      '1pm 2pm 3pm 4pm 5pm 6pm 7pm 8pm',
      '1pm 2pm 3pm 4pm 5pm pm 7pm E 12pm',
      'lpm 2pm 3pm 4pm Spm 6pm 7pm',
      '9am 10am 11am 12pm 1pm',
    ]) {
      expect(summarize(doc(dayHeader(), axis(), at(text, 200, 400))), text).toEqual([]);
    }
    // the same noise in a list layout, under a day heading
    expect(
      summarize(doc(at('Sábado', 20, 30), at('1pm 2pm 3pm 4pm 5pm 6pm 7pm 8pm', 20, 70))),
    ).toEqual([]);
  });

  it('a real class whose title has a number is still a class', () => {
    const list = doc(at('Sábado', 20, 30), at('1400-1615 Proyecto 2', 20, 70));
    expect(summarize(list)).toEqual([[6, '14:00', '16:15', 'Proyecto 2']]);
    const grid = doc(dayHeader(), axis(), [
      ...at('1400-1615', GRID.sab, 560),
      ...at('Proyecto 2', GRID.sab, 584),
    ]);
    expect(summarize(grid)).toEqual([[6, '14:00', '16:15', 'Proyecto 2']]);
  });

  it('a lone time is still the start of a class when there is no range (nothing is invented)', () => {
    expect(summarize(doc(at('Sábado', 20, 30), at('Redes 7pm', 20, 70)))).toEqual([
      [6, '19:00', null, 'Redes'],
    ]);
  });

  it('subjects: the label that CONTAINS a whole subject name matches it (existing rule); one that does not stays unmatched', () => {
    const subjects: SubjectRef[] = [
      { id: '66666666-6666-4666-8666-666666666666', name: 'Proyectos II' },
      { id: '77777777-7777-4777-8777-777777777777', name: 'Prácticas Empresariales' },
    ];
    const d = doc(dayHeader(), axis(), proyectosBlock(), practicasBlock());
    const proposals = buildScheduleProposals(extractClassCandidates(d).candidates, {
      subjects,
      period: PERIOD,
    });
    expect(
      proposals.map((p) => [p.weekday, p.startTime, p.endTime, p.subjectMatch.status]),
    ).toEqual([
      [3, '19:00', '20:30', 'EXACT'],
      [6, '14:00', '16:15', 'EXACT'],
    ]);
    // a similar but different name is never guessed
    const close = buildScheduleProposals(
      extractClassCandidates(doc(dayHeader(), axis(), proyectosBlock())).candidates,
      {
        subjects: [{ id: '88888888-8888-4888-8888-888888888888', name: 'Proyecto II' }],
        period: PERIOD,
      },
    );
    expect(close[0]!.subjectId).toBeNull();
    // too different to suggest: it is a NEW subject proposal, with the text as read (minus the institutional code)
    expect(close[0]!.subjectMatch.status).toBe('MISSING');
    expect(close[0]!.status).toBe('READY');
    expect(close[0]!.proposedName).toBe('Proyectos II REMOTO Proyecto');
    expect(close[0]!.sourcePrefix).toBe('ZISXA'); // the code the cleaning dropped, kept as review evidence
  });
});

// ───────────────────────── A1: the name proposed for a new subject ─────────────────────────

describe('proposeSubjectName', () => {
  it('keeps the text as read, tidying spaces and edge punctuation only', () => {
    expect(proposeSubjectName('Química')).toBe('Química');
    expect(proposeSubjectName('  Cálculo   Diferencial  ')).toBe('Cálculo Diferencial');
    expect(proposeSubjectName('- Física II :')).toBe('Física II');
  });

  it('drops only a leading institutional code (4-8 capitals, a hyphen, a Capitalised word)', () => {
    expect(proposeSubjectName('ZISXA-Proyectos II REMOTO Proyecto')).toBe(
      'Proyectos II REMOTO Proyecto',
    );
    expect(proposeSubjectName('ZISXA-Practicas Empresariales')).toBe('Practicas Empresariales');
  });

  it('does not touch what could be part of a real name', () => {
    expect(proposeSubjectName('TCP-IP Redes')).toBe('TCP-IP Redes'); // 3 capitals
    expect(proposeSubjectName('HTML-CSS')).toBe('HTML-CSS'); // what follows is not a Capitalised word
    expect(proposeSubjectName('Proyectos II REMOTO')).toBe('Proyectos II REMOTO'); // modality stays
    expect(proposeSubjectName('Redes-Computadores')).toBe('Redes-Computadores');
  });

  it('never exceeds the length of a subject name', () => {
    expect(proposeSubjectName('A'.repeat(300)).length).toBe(100);
  });
});
