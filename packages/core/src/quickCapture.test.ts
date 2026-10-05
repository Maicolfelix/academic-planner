import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  QUICK_CAPTURE_MAX_LENGTH,
  QUICK_CAPTURE_MESSAGES,
  QUICK_CAPTURE_TYPE_ALIASES,
  parseQuickCapture,
  quickCaptureRequestSchema,
  quickCaptureResultSchema,
  type QuickCaptureContext,
  type QuickCaptureResult,
} from './index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUBJECTS = {
  redes: { id: uuid(1), name: 'Redes' },
  bases: { id: uuid(2), name: 'Bases de Datos' },
  anatomia: { id: uuid(3), name: 'Anatomía' },
  programacion: { id: uuid(4), name: 'Programación' },
  epidemiologia: { id: uuid(5), name: 'Epidemiología' },
  inmunologia: { id: uuid(6), name: 'Inmunología' },
  bioestadistica: { id: uuid(7), name: 'Bioestadística' },
};
const BASE = Object.values(SUBJECTS);

const MONDAY = new Date('2026-10-05T17:00:00.000Z'); // Monday 5 Oct 2026, 12:00 in Bogotá
const TUESDAY_3PM = new Date('2026-10-06T20:00:00.000Z'); // Tuesday 6 Oct, 15:00 in Bogotá
const PERIOD = { startDate: '2026-08-03', endDate: '2026-11-28' };

const ctx = (over: Partial<QuickCaptureContext> = {}): QuickCaptureContext => ({
  now: MONDAY,
  timeZone: 'America/Bogota',
  subjects: BASE,
  period: PERIOD,
  ...over,
});
/** Parses and also checks that whatever comes out is a valid, serialisable result. */
const parse = (text: string, over: Partial<QuickCaptureContext> = {}): QuickCaptureResult => {
  const result = parseQuickCapture(text, ctx(over));
  expect(quickCaptureResultSchema.safeParse(result).success, text).toBe(true);
  return result;
};
const codes = (r: QuickCaptureResult) => r.warnings.map((w) => w.code);

describe('the mandatory examples', () => {
  it.each([
    ['parcial redes martes 10am', 'EXAM', 'redes', '2026-10-06', '10:00', 'Parcial'],
    ['tarea bases viernes', 'TASK', 'bases', '2026-10-09', null, 'Tarea'],
    ['quiz anatomia mañana 8am', 'QUIZ', 'anatomia', '2026-10-06', '08:00', 'Quiz'],
    ['proyecto programacion 15/10', 'PROJECT', 'programacion', '2026-10-15', null, 'Proyecto'],
    [
      'exposicion epidemiologia jueves 2pm',
      'PRESENTATION',
      'epidemiologia',
      '2026-10-08',
      '14:00',
      'Exposición',
    ],
    ['lectura inmunologia hoy', 'READING', 'inmunologia', '2026-10-05', null, 'Lectura'],
    [
      'taller bioestadistica 20/10 14:30',
      'WORKSHOP',
      'bioestadistica',
      '2026-10-20',
      '14:30',
      'Taller',
    ],
  ] as const)('%s', (text, type, subject, date, time, title) => {
    const r = parse(text);
    expect(r).toMatchObject({
      status: 'OK',
      type,
      subjectId: SUBJECTS[subject].id,
      dueDate: date,
      dueTime: time,
      hasTime: time !== null,
      title,
      missingFields: [],
    });
    expect(r.warnings).toEqual([]);
  });

  it('parcial redes unidad 3 martes 10am keeps the useful text in the title', () => {
    expect(parse('parcial redes unidad 3 martes 10am').title).toBe('Parcial unidad 3');
    expect(parse('parcial redes capítulo 3 martes 10am').title).toBe('Parcial capítulo 3');
  });

  it('parcial programacion martes is ambiguous when there are two Programación subjects', () => {
    const subjects = [
      ...BASE.filter((s) => s.id !== SUBJECTS.programacion.id),
      { id: uuid(10), name: 'Programación I' },
      { id: uuid(11), name: 'Programación II' },
    ];
    const r = parse('parcial programacion martes', { subjects });
    expect(r.subjectId).toBeNull();
    expect(r.certainty.subject).toBe('AMBIGUOUS');
    expect(r.ambiguities).toEqual([
      {
        field: 'subject',
        candidates: [
          { id: uuid(10), name: 'Programación I' },
          { id: uuid(11), name: 'Programación II' },
        ],
      },
    ]);
    expect(codes(r)).toContain('AMBIGUOUS_SUBJECT');
    expect(r.missingFields).toEqual(['subject']);
    expect(r.recognizedFields).toEqual(['type', 'date']);
  });

  it('parcial mañana is understood in part: type and date, but no subject', () => {
    const r = parse('parcial mañana');
    expect(r).toMatchObject({
      type: 'EXAM',
      title: 'Parcial',
      dueDate: '2026-10-06',
      subjectId: null,
    });
    expect(r.missingFields).toEqual(['subject']);
    expect(codes(r)).toEqual(['MISSING_SUBJECT']);
    expect(r.recognizedFields).toEqual(['type', 'date']);
  });
});

describe('activity types', () => {
  it('maps every alias to its type', () => {
    for (const [alias, type] of Object.entries(QUICK_CAPTURE_TYPE_ALIASES)) {
      const r = parse(`${alias} redes viernes`);
      expect(r.type, alias).toBe(type);
      expect(r.certainty.type, alias).toBe('EXACT');
      expect(r.title, alias).toBe(ACTIVITY_TYPE_LABELS[type]);
    }
  });

  it('covers all eight ActivityType values', () => {
    expect(new Set(Object.values(QUICK_CAPTURE_TYPE_ALIASES))).toEqual(new Set(ACTIVITY_TYPES));
  });

  it.each([
    ['tarea', 'TASK'],
    ['trabajo', 'TASK'], // documented: "trabajo" is read as a task; "proyecto" is the explicit way to say project
    ['parcial', 'EXAM'],
    ['examen', 'EXAM'],
    ['quiz', 'QUIZ'],
    ['quizz', 'QUIZ'],
    ['prueba corta', 'QUIZ'],
    ['proyecto', 'PROJECT'],
    ['exposición', 'PRESENTATION'],
    ['exposicion', 'PRESENTATION'],
    ['presentación', 'PRESENTATION'],
    ['presentacion', 'PRESENTATION'],
    ['taller', 'WORKSHOP'],
    ['lectura', 'READING'],
    ['otro', 'OTHER'],
  ] as const)('"%s" is %s', (word, type) => {
    expect(parse(`${word} redes viernes`).type).toBe(type);
  });

  it('without a type word the type stays TASK, like a manual activity, and says it was not recognised', () => {
    const r = parse('informe redes viernes');
    expect(r.type).toBe('TASK');
    expect(r.certainty.type).toBe('MISSING');
    expect(r.recognizedFields).not.toContain('type');
    expect(r.title).toBe('Informe');
  });

  it('works in any case, with or without accents', () => {
    for (const word of ['EXPOSICIÓN', 'Exposición', 'exposicion', 'ExPoSiCiOn']) {
      expect(parse(`${word} redes viernes`).type, word).toBe('PRESENTATION');
    }
  });
});

describe('subject matching', () => {
  it('exact name, case and accents ignored', () => {
    for (const text of [
      'parcial bases de datos viernes',
      'PARCIAL BASES DE DATOS VIERNES',
      'parcial Bases De Datos viernes',
    ]) {
      const r = parse(text);
      expect(r.subjectId, text).toBe(SUBJECTS.bases.id);
      expect(r.certainty.subject, text).toBe('EXACT');
    }
    expect(parse('quiz anatomia viernes').subjectId).toBe(SUBJECTS.anatomia.id);
    expect(parse('quiz ANATOMÍA viernes').subjectId).toBe(SUBJECTS.anatomia.id);
  });

  it('an unambiguous prefix or word is LIKELY, not EXACT', () => {
    const r = parse('tarea bases viernes');
    expect(r.subjectId).toBe(SUBJECTS.bases.id);
    expect(r.certainty.subject).toBe('LIKELY');
    expect(parse('tarea datos viernes').subjectId).toBe(SUBJECTS.bases.id);
    expect(parse('tarea anato viernes').subjectId).toBe(SUBJECTS.anatomia.id); // prefix of 3+ letters
  });

  it('does not use prefixes shorter than three letters or a connector', () => {
    expect(parse('tarea ba viernes').subjectId).toBeNull();
    expect(parse('tarea de viernes').subjectId).toBeNull();
    expect(parse('tarea la viernes').subjectId).toBeNull();
  });

  it('a missing subject is never invented', () => {
    const r = parse('parcial fisica martes');
    expect(r.subjectId).toBeNull();
    expect(r.certainty.subject).toBe('MISSING');
    expect(codes(r)).toContain('MISSING_SUBJECT');
    expect(r.ambiguities).toEqual([]);
    expect(r.title).toBe('Parcial fisica');
  });

  describe('two subjects share a word', () => {
    const subjects = [
      { id: uuid(10), name: 'Programación I' },
      { id: uuid(11), name: 'Programación II' },
      { id: uuid(12), name: 'Redes de Computadores' },
      { id: uuid(13), name: 'Redes Neuronales' },
    ];
    it('the shared word is ambiguous: it never picks one', () => {
      expect(parse('parcial programacion martes', { subjects }).certainty.subject).toBe(
        'AMBIGUOUS',
      );
      expect(parse('parcial redes martes', { subjects }).ambiguities[0]!.candidates).toHaveLength(
        2,
      );
    });
    it('one more word that tells them apart resolves it', () => {
      expect(parse('parcial programacion ii martes', { subjects }).subjectId).toBe(uuid(11));
      expect(parse('parcial programación I martes', { subjects }).subjectId).toBe(uuid(10));
      expect(parse('parcial redes neuronales martes', { subjects }).subjectId).toBe(uuid(13));
      expect(parse('parcial redes de computadores martes', { subjects }).subjectId).toBe(uuid(12));
    });
    it('an exact name beats a prefix of a longer one', () => {
      const withShort = [
        { id: uuid(20), name: 'Redes' },
        { id: uuid(21), name: 'Redes Avanzadas' },
      ];
      const r = parse('parcial redes martes', { subjects: withShort });
      expect(r.subjectId).toBe(uuid(20));
      expect(r.certainty.subject).toBe('EXACT');
    });
  });

  it('a type word alone never selects a subject: "proyecto redes" is a project of Redes', () => {
    const subjects = [{ id: uuid(30), name: 'Proyecto Integrador' }, SUBJECTS.redes];
    const r = parse('proyecto redes martes', { subjects });
    expect(r.type).toBe('PROJECT');
    expect(r.subjectId).toBe(SUBJECTS.redes.id);
  });

  it('the same holds when the other subject is only a prefix match (no exact name to fall back on)', () => {
    // Without the rule, "proyecto" would also select "Proyecto Integrador" and the answer would be ambiguous.
    const subjects = [
      { id: uuid(32), name: 'Proyecto Integrador' },
      { id: uuid(33), name: 'Redes de Computadores' },
    ];
    const r = parse('proyecto redes martes', { subjects });
    expect(r.type).toBe('PROJECT');
    expect(r.subjectId).toBe(uuid(33));
    expect(r.certainty.subject).toBe('LIKELY');
    // With no other subject to name, "proyecto" alone still does not become a subject.
    const alone = parse('proyecto martes', { subjects });
    expect(alone.type).toBe('PROJECT');
    expect(alone.subjectId).toBeNull();
  });

  it('but a subject whose full name is typed wins, even when it contains a type word', () => {
    const subjects = [{ id: uuid(31), name: 'Taller de Redes' }, SUBJECTS.bases];
    const r = parse('parcial taller de redes viernes', { subjects });
    expect(r.subjectId).toBe(uuid(31));
    expect(r.certainty.subject).toBe('EXACT');
    expect(r.type).toBe('EXAM');
    expect(r.warnings.map((w) => w.code)).not.toContain('MULTIPLE_ACTIVITIES');
  });

  it('only the subjects it is given can be matched', () => {
    const r = parse('parcial anatomia martes', { subjects: [SUBJECTS.redes] });
    expect(r.subjectId).toBeNull();
    expect(parse('parcial redes martes', { subjects: [] }).subjectId).toBeNull();
  });

  it('works with 50 subjects', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: uuid(100 + i),
      name: `Asignatura número ${i + 1} de prueba`,
    }));
    const r = parse('parcial asignatura numero 37 martes', { subjects: many });
    // "numero 37" distinguishes it from the other 49
    expect(r.subjectId).toBe(many[36]!.id);
  });
});

describe('dates', () => {
  it.each([
    ['hoy', '2026-10-05'],
    ['mañana', '2026-10-06'],
    ['manana', '2026-10-06'],
    ['pasado mañana', '2026-10-07'],
    ['pasado manana', '2026-10-07'],
    ['lunes', '2026-10-05'], // today is Monday and there is no time: it is today
    ['martes', '2026-10-06'],
    ['miércoles', '2026-10-07'],
    ['miercoles', '2026-10-07'],
    ['jueves', '2026-10-08'],
    ['viernes', '2026-10-09'],
    ['sábado', '2026-10-10'],
    ['sabado', '2026-10-10'],
    ['domingo', '2026-10-11'],
    ['este martes', '2026-10-06'],
    ['próximo viernes', '2026-10-09'],
    ['el martes', '2026-10-06'],
  ])('%s -> %s', (word, date) => {
    const r = parse(`tarea redes ${word}`);
    expect(r.dueDate).toBe(date);
    expect(r.title).toBe('Tarea'); // the date words are not left in the title
  });

  it('absolute dates, day first (never MM/DD)', () => {
    expect(parse('tarea redes 15/10').dueDate).toBe('2026-10-15');
    expect(parse('tarea redes 15-10').dueDate).toBe('2026-10-15');
    expect(parse('tarea redes 15/10/2026').dueDate).toBe('2026-10-15');
    expect(parse('tarea redes 15-10-2026').dueDate).toBe('2026-10-15');
    expect(parse('tarea redes 15/10/26').dueDate).toBe('2026-10-15');
    expect(parse('tarea redes 10/11').dueDate).toBe('2026-11-10'); // 10 November, not 11 October
    expect(parse('tarea redes 1/11').dueDate).toBe('2026-11-01');
  });

  it('months written in Spanish', () => {
    for (const text of [
      '10 de octubre',
      '10 octubre',
      'octubre 10',
      '10 de octubre de 2026',
      '10 OCTUBRE',
    ]) {
      expect(parse(`tarea redes ${text}`).dueDate, text).toBe('2026-10-10');
    }
    expect(parse('tarea redes 3 de noviembre').dueDate).toBe('2026-11-03');
    expect(parse('tarea redes 25 diciembre').dueDate).toBe('2026-12-25');
  });

  it('crossing a month and a year', () => {
    const endOfSeptember = new Date('2026-09-30T17:00:00.000Z');
    expect(parse('tarea redes mañana', { now: endOfSeptember }).dueDate).toBe('2026-10-01');
    const newYearsEve = new Date('2026-12-31T17:00:00.000Z');
    expect(parse('tarea redes mañana', { now: newYearsEve }).dueDate).toBe('2027-01-01');
    expect(parse('tarea redes pasado mañana', { now: newYearsEve }).dueDate).toBe('2027-01-02');
    expect(parse('tarea redes 15/01', { now: newYearsEve }).dueDate).toBe('2027-01-15');
    expect(parse('tarea redes viernes', { now: newYearsEve }).dueDate).toBe('2027-01-01');
  });

  it('without a year it is the next occurrence of that day and month, today included', () => {
    expect(parse('tarea redes 05/10').dueDate).toBe('2026-10-05');
    expect(parse('tarea redes 04/10').dueDate).toBe('2027-10-04'); // yesterday: next year
    expect(parse('tarea redes 29/02').dueDate).toBe('2028-02-29'); // the next leap year
  });

  it('invalid dates are reported, not guessed', () => {
    for (const text of ['31/02', '31/04/2026', '30/02/2026', '00/10', '15/13']) {
      const r = parse(`tarea redes ${text}`);
      expect(r.dueDate, text).toBeNull();
      expect(codes(r), text).toContain('INVALID_DATE');
      expect(r.missingFields).toContain('date');
      expect(r.title, text).toBe('Tarea');
    }
    expect(codes(parse('tarea redes 31 de abril'))).toContain('INVALID_DATE');
  });

  it('a date without a year that is already past is explicit about it', () => {
    const r = parse('tarea redes 01/09/2026');
    expect(r.dueDate).toBe('2026-09-01');
    expect(codes(r)).toContain('PAST_DATE');
  });

  it('a missing date is reported', () => {
    const r = parse('tarea redes');
    expect(r.dueDate).toBeNull();
    expect(r.certainty.date).toBe('MISSING');
    expect(codes(r)).toEqual(['MISSING_DATE']);
    expect(r.missingFields).toEqual(['date']);
  });

  it('certainty: explicit dates are EXACT; a weekday or a date without a year is LIKELY', () => {
    expect(parse('tarea redes mañana').certainty.date).toBe('EXACT');
    expect(parse('tarea redes 15/10/2026').certainty.date).toBe('EXACT');
    expect(parse('tarea redes viernes').certainty.date).toBe('LIKELY');
    expect(parse('tarea redes 15/10').certainty.date).toBe('LIKELY');
  });

  it('uses the user’s timezone to decide what "today" is', () => {
    // Monday 5 Oct 22:00 in Bogotá is already Tuesday 6 Oct 12:00 in Tokyo.
    const now = new Date('2026-10-06T03:00:00.000Z');
    expect(parse('tarea redes hoy', { now, timeZone: 'America/Bogota' }).dueDate).toBe(
      '2026-10-05',
    );
    expect(parse('tarea redes hoy', { now, timeZone: 'Asia/Tokyo' }).dueDate).toBe('2026-10-06');
    expect(parse('tarea redes mañana', { now, timeZone: 'Asia/Tokyo' }).dueDate).toBe('2026-10-07');
  });

  it('the same day said twice is fine; two different days mean two activities', () => {
    const same = parse('tarea redes martes 6/10');
    expect(same.dueDate).toBe('2026-10-06');
    expect(codes(same)).not.toContain('MULTIPLE_ACTIVITIES');
    const two = parse('tarea redes martes y jueves');
    expect(two.dueDate).toBe('2026-10-06'); // the first
    expect(codes(two)).toContain('MULTIPLE_ACTIVITIES');
  });
});

describe('the weekday rule when the day is today', () => {
  const tuesday = (text: string) => parse(text, { now: TUESDAY_3PM });

  it('with an explicit time that has already passed, it is the same day of next week', () => {
    const r = tuesday('parcial redes martes 10am');
    expect(r.dueDate).toBe('2026-10-13');
    expect(r.dueTime).toBe('10:00');
    expect(codes(r)).toEqual(['MOVED_TO_NEXT_WEEK']);
    expect(r.warnings[0]!.message).toBe(QUICK_CAPTURE_MESSAGES.MOVED_TO_NEXT_WEEK);
  });

  it('with a time still ahead, it stays today', () => {
    const r = tuesday('parcial redes martes 4pm');
    expect(r.dueDate).toBe('2026-10-06');
    expect(r.warnings).toEqual([]);
  });

  it('at the exact current minute it is not past yet: stays today', () => {
    expect(tuesday('parcial redes martes 3pm').dueDate).toBe('2026-10-06');
    expect(tuesday('parcial redes martes 15:00').dueDate).toBe('2026-10-06');
    expect(tuesday('parcial redes martes 15:01').dueDate).toBe('2026-10-06');
    expect(tuesday('parcial redes martes 14:59').dueDate).toBe('2026-10-13');
  });

  it('without a time it stays today', () => {
    const r = tuesday('parcial redes martes');
    expect(r.dueDate).toBe('2026-10-06');
    expect(r.warnings).toEqual([]);
  });

  it('only today is affected: other weekdays are never moved by the time', () => {
    expect(tuesday('parcial redes miércoles 8am').dueDate).toBe('2026-10-07');
    expect(tuesday('parcial redes lunes 8am').dueDate).toBe('2026-10-12'); // Monday already went by: next one
  });

  it('"hoy" with a past time stays today and warns', () => {
    const r = tuesday('parcial redes hoy 10am');
    expect(r.dueDate).toBe('2026-10-06');
    expect(codes(r)).toEqual(['PAST_TIME_TODAY']);
    expect(r.warnings[0]!.message).toBe('La hora indicada ya pasó para hoy.');
  });

  it('an explicit date that is today with a past time also warns, without moving', () => {
    const r = tuesday('parcial redes 06/10 10am');
    expect(r.dueDate).toBe('2026-10-06');
    expect(codes(r)).toEqual(['PAST_TIME_TODAY']);
  });

  it('is evaluated in the user’s timezone', () => {
    // 20:00Z is 15:00 in Bogotá but 05:00 (next day) in Tokyo.
    const tokyo = parse('parcial redes martes 10am', { now: TUESDAY_3PM, timeZone: 'Asia/Tokyo' });
    expect(tokyo.dueDate).toBe('2026-10-13'); // today in Tokyo is Wednesday: the next Tuesday
    const bogota = tuesday('parcial redes martes 10am');
    expect(bogota.dueDate).toBe('2026-10-13');
  });
});

describe('academic period', () => {
  it('a date outside the period is kept and flagged, never corrected', () => {
    const after = parse('tarea redes 15/12');
    expect(after.dueDate).toBe('2026-12-15');
    expect(codes(after)).toEqual(['DATE_OUTSIDE_PERIOD']);
    expect(after.warnings[0]!.message).toBe(
      'La fecha interpretada está fuera del periodo académico actual.',
    );
    const before = parse('tarea redes 01/08/2026');
    expect(before.dueDate).toBe('2026-08-01');
    expect(codes(before)).toContain('DATE_OUTSIDE_PERIOD');
  });

  it('the limits of the period are inside it', () => {
    expect(codes(parse('tarea redes 28/11'))).not.toContain('DATE_OUTSIDE_PERIOD');
    expect(codes(parse('tarea redes 03/08/2026'))).not.toContain('DATE_OUTSIDE_PERIOD');
    expect(codes(parse('tarea redes 29/11'))).toContain('DATE_OUTSIDE_PERIOD');
  });

  it('a date without a year that falls before today goes to next year and is flagged as outside the period', () => {
    const r = parse('tarea redes 10/03');
    expect(r.dueDate).toBe('2027-03-10');
    expect(codes(r)).toContain('DATE_OUTSIDE_PERIOD');
  });

  it('without a period there is nothing to compare with', () => {
    expect(codes(parse('tarea redes 15/12', { period: null }))).toEqual([]);
  });
});

describe('time', () => {
  it.each([
    ['10am', '10:00'],
    ['10 am', '10:00'],
    ['10AM', '10:00'],
    ['10 a.m.', '10:00'],
    ['10 a. m.', '10:00'],
    ['10a.m.', '10:00'],
    ['10:30', '10:30'],
    ['10:30am', '10:30'],
    ['10:30 am', '10:30'],
    ['14:00', '14:00'],
    ['2pm', '14:00'],
    ['2 pm', '14:00'],
    ['2 p.m.', '14:00'],
    ['2:15 pm', '14:15'],
    ['10:30pm', '22:30'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['12:30am', '00:30'],
    ['12:30pm', '12:30'],
    ['0:00', '00:00'],
    ['23:59', '23:59'],
    ['9:05', '09:05'],
    ['a las 10am', '10:00'],
    ['a las 2 pm', '14:00'],
    ['a la 1pm', '13:00'],
  ])('%s -> %s', (text, expected) => {
    const r = parse(`parcial redes viernes ${text}`);
    expect(r.dueTime).toBe(expected);
    expect(r.hasTime).toBe(true);
    expect(r.title).toBe('Parcial'); // the time words (and "a las") do not stay in the title
  });

  it.each(['25:00', '14:90', '0pm', '13pm', '0am', '10:75am', '24:00', '99:99'])(
    '%s is invalid and reported clearly',
    (text) => {
      const r = parse(`parcial redes viernes ${text}`);
      expect(r.dueTime).toBeNull();
      expect(r.hasTime).toBe(false);
      expect(codes(r)).toContain('INVALID_TIME');
      expect(r.warnings.find((w) => w.code === 'INVALID_TIME')!.message).toContain(
        text.replace(/\s+/g, ' '),
      );
      expect(r.dueDate).toBe('2026-10-09'); // the rest is still understood
      expect(r.title).toBe('Parcial');
    },
  );

  it('without a time there is none: no end-of-day is invented', () => {
    const r = parse('tarea redes viernes');
    expect(r.dueTime).toBeNull();
    expect(r.hasTime).toBe(false);
    expect(r.certainty.time).toBe('MISSING');
  });

  it('a bare number is not a time', () => {
    const r = parse('parcial redes viernes 3');
    expect(r.dueTime).toBeNull();
    expect(r.title).toBe('Parcial 3');
  });

  it('the first valid time wins', () => {
    expect(parse('parcial redes viernes 8am 2pm').dueTime).toBe('08:00');
  });
});

describe('title', () => {
  it('is the type label alone when nothing else is left', () => {
    expect(parse('parcial redes martes 10am').title).toBe('Parcial');
    expect(parse('quiz anatomia mañana 8am').title).toBe('Quiz');
  });

  it('keeps the rest of the text as typed (case and accents)', () => {
    expect(parse('parcial redes Capítulo 3 martes 10am').title).toBe('Parcial Capítulo 3');
    expect(parse('exposición redes sobre Árboles martes').title).toBe('Exposición sobre Árboles');
    expect(parse('tarea redes ejercicios 1 al 5 viernes').title).toBe('Tarea ejercicios 1 al 5');
  });

  it('a number next to the type stays: "parcial 1 redes" is "Parcial 1"', () => {
    expect(parse('parcial 1 redes martes').title).toBe('Parcial 1');
  });

  it('drops connectors at the edges but not inside', () => {
    expect(parse('parcial de redes para el martes').title).toBe('Parcial');
    expect(parse('parcial redes tema de capas para el martes a las 10am').title).toBe(
      'Parcial tema de capas',
    );
  });

  it('without a type, the leftover text becomes the title, capitalised', () => {
    expect(parse('informe de laboratorio redes viernes').title).toBe('Informe de laboratorio');
  });

  it('with no type and nothing left the title is missing', () => {
    const r = parse('redes viernes');
    expect(r.title).toBe('');
    expect(r.missingFields).toContain('title');
  });

  it('is cut at the Activity limit with a warning', () => {
    const r = parse(`tarea redes ${'palabra '.repeat(33)}viernes`);
    expect(r.title.length).toBeLessThanOrEqual(150);
    expect(codes(r)).toContain('TITLE_TRUNCATED');
  });
});

describe('normalisation', () => {
  const expected = {
    type: 'EXAM',
    dueDate: '2026-10-06',
    dueTime: '10:00',
    title: 'Parcial',
  } as const;
  it.each([
    'parcial redes martes 10am',
    'PARCIAL REDES MARTES 10AM',
    'Parcial Redes Martes 10AM',
    '  parcial    redes   martes   10am  ',
    'parcial redes, martes 10am',
    'parcial redes - martes - 10am',
    'parcial redes — martes — 10am',
    'parcial,redes,martes,10am',
    'parcial redes; martes; 10am',
    '¡parcial redes martes 10am!',
    'parcial\tredes\nmartes\t10am',
    '(parcial) redes (martes) 10am.',
  ])('%j', (text) => {
    const r = parse(text);
    expect(r).toMatchObject(expected);
    expect(r.subjectId).toBe(SUBJECTS.redes.id);
  });

  it('accents do not matter in the input', () => {
    expect(parse('Exposición epidemiología jueves 2pm')).toMatchObject({
      type: 'PRESENTATION',
      subjectId: SUBJECTS.epidemiologia.id,
      dueDate: '2026-10-08',
      dueTime: '14:00',
    });
    expect(parse('exposicion epidemiologia jueves 2pm')).toMatchObject({
      type: 'PRESENTATION',
      dueDate: '2026-10-08',
    });
  });

  it('keeps the original text', () => {
    expect(parse('  PARCIAL Redes ').rawText).toBe('  PARCIAL Redes ');
  });
});

describe('empty and long input', () => {
  it.each(['', ' ', '   \t\n  '])('%j is EMPTY', (text) => {
    const r = parse(text);
    expect(r.status).toBe('EMPTY');
    expect(codes(r)).toEqual(['EMPTY']);
    expect(r.warnings[0]!.message).toBe('Escribe una actividad para continuar.');
    expect(r.subjectId).toBeNull();
    expect(r.dueDate).toBeNull();
  });

  it('the limit is 300 characters', () => {
    expect(QUICK_CAPTURE_MAX_LENGTH).toBe(300);
    const ok = parse(`tarea redes ${'x'.repeat(QUICK_CAPTURE_MAX_LENGTH - 12)}`);
    expect(ok.status).toBe('OK');
    const long = parse(`tarea redes ${'x'.repeat(QUICK_CAPTURE_MAX_LENGTH - 11)}`);
    expect(long.status).toBe('TOO_LONG');
    expect(long.warnings[0]!.message).toBe(
      'Este texto parece demasiado largo para Captura rápida.',
    );
    expect(long.subjectId).toBeNull(); // nothing is interpreted
  });

  it('a pasted message is too long, not parsed', () => {
    const message =
      'Buenas tardes estudiantes, les recuerdo que el próximo martes tendremos el primer parcial de Redes a las 10am en el salón de siempre. Por favor traer calculadora y documento de identidad, y repasar los capítulos 1 al 4 del libro guía.';
    expect(message.length).toBeLessThanOrEqual(300 + 50);
    const r = parse(`${message} ${message}`);
    expect(r.status).toBe('TOO_LONG');
  });
});

describe('what it cannot understand', () => {
  it('asdf xyz is a partial result, never an error', () => {
    const r = parse('asdf xyz');
    expect(r).toMatchObject({
      status: 'OK',
      title: 'Asdf xyz',
      subjectId: null,
      dueDate: null,
      dueTime: null,
      type: 'TASK',
    });
    expect(r.missingFields).toEqual(['subject', 'date']);
    expect(r.recognizedFields).toEqual([]);
    expect(codes(r)).toEqual(['MISSING_SUBJECT', 'MISSING_DATE']);
  });

  it('"parcial" alone: type recognised, the rest missing', () => {
    const r = parse('parcial');
    expect(r).toMatchObject({ type: 'EXAM', title: 'Parcial' });
    expect(r.missingFields).toEqual(['subject', 'date']);
  });

  it('only a date, only a time, only a subject', () => {
    expect(parse('martes').dueDate).toBe('2026-10-06');
    expect(parse('10am').dueTime).toBe('10:00');
    expect(parse('redes').subjectId).toBe(SUBJECTS.redes.id);
    expect(parse('redes').missingFields).toEqual(['title', 'date']);
  });
});

describe('one activity at a time', () => {
  it.each([
    'parcial redes martes y tarea bases viernes',
    'parcial redes martes tarea bases',
    'parcial redes martes jueves',
    'tarea redes y bases viernes',
  ])('%j warns', (text) => {
    const r = parse(text);
    expect(codes(r)).toContain('MULTIPLE_ACTIVITIES');
    expect(r.warnings.find((w) => w.code === 'MULTIPLE_ACTIVITIES')!.message).toBe(
      'Captura rápida admite una actividad a la vez.',
    );
  });

  it('two different types alone (one date, one subject) are enough to warn', () => {
    const r = parse('parcial tarea redes martes');
    expect(codes(r)).toContain('MULTIPLE_ACTIVITIES');
    expect(r.type).toBe('EXAM'); // the first one
    // The same type twice is just emphasis, not two activities.
    expect(codes(parse('tarea tarea redes martes'))).not.toContain('MULTIPLE_ACTIVITIES');
    // Two words of the same type ("parcial" and "examen") are still one type.
    expect(codes(parse('parcial examen redes martes'))).not.toContain('MULTIPLE_ACTIVITIES');
  });

  it('two clearly named subjects alone (one type, one date) are enough to warn', () => {
    const r = parse('tarea redes anatomia martes');
    expect(codes(r)).toContain('MULTIPLE_ACTIVITIES');
  });

  it('a single activity never warns', () => {
    for (const text of [
      'parcial redes martes 10am',
      'tarea bases viernes',
      'parcial redes unidad 3 martes 10am',
    ]) {
      expect(codes(parse(text)), text).not.toContain('MULTIPLE_ACTIVITIES');
    }
  });

  it('still returns a proposal for the first one', () => {
    const r = parse('parcial redes martes y tarea bases viernes');
    expect(r).toMatchObject({ type: 'EXAM', subjectId: SUBJECTS.redes.id, dueDate: '2026-10-06' });
  });
});

describe('robustness', () => {
  const weird = [
    '',
    ' ',
    '-',
    '---',
    ',,,',
    '...',
    '¿¿??',
    '!!!!!!',
    ':',
    '::::',
    '10:',
    ':30',
    '10:30:30',
    '1/1/1/1',
    '99/99/9999',
    '0/0',
    '//',
    '-/-',
    'a. m.',
    'a m',
    'p.m.',
    '10 a. m. a. m.',
    'hoy hoy hoy',
    'mañana mañana pasado mañana',
    'lunes martes miércoles jueves viernes sábado domingo',
    'parcial parcial parcial',
    'de de de de',
    'a las',
    'a las a las a las',
    '😀 parcial 😀 redes 😀',
    'parcial\u0000redes',
    'ééé',
    'ÁÉÍÓÚ ÑÜ',
    'x'.repeat(300),
    'x '.repeat(150),
    '1 '.repeat(150),
    '/'.repeat(300),
    ':'.repeat(300),
    'a.'.repeat(150),
    '12/12/12/12/12',
    '31 de febrero de 2026',
    'octubre octubre octubre',
    '10 10 10 10 10 10',
    'pasado pasado mañana',
    'prueba prueba corta corta',
    '\n\n\n',
    'PARCIAL!!! REDES??? MARTES... 10AM,,,',
  ];

  it('never throws and always returns a valid result', () => {
    for (const text of weird) {
      expect(() => parseQuickCapture(text, ctx()), JSON.stringify(text)).not.toThrow();
      const r = parse(text);
      expect(['OK', 'EMPTY', 'TOO_LONG']).toContain(r.status);
      expect(r.title.length).toBeLessThanOrEqual(150);
    }
  });

  it('also with no subjects, no period and other timezones', () => {
    for (const text of weird) {
      for (const over of [
        { subjects: [] },
        { period: null },
        { timeZone: 'Asia/Tokyo' },
        { now: TUESDAY_3PM },
      ]) {
        expect(() => parseQuickCapture(text, ctx(over))).not.toThrow();
      }
    }
  });

  it('is deterministic', () => {
    for (const text of weird) {
      expect(parseQuickCapture(text, ctx())).toEqual(parseQuickCapture(text, ctx()));
    }
  });

  it('treats the text as text only: nothing in it is executed or interpreted as markup', () => {
    const r = parse(
      'parcial redes <script>alert(1)</script> ${process.exit(1)} $(rm -rf /) martes',
    );
    expect(r.status).toBe('OK');
    expect(r.title).toContain('alert(1)'); // kept as plain text in the title (edge punctuation aside)
    expect(r.type).toBe('EXAM');
  });

  it('is fast with 50 subjects and the longest input (no catastrophic backtracking)', () => {
    const subjects = Array.from({ length: 50 }, (_, i) => ({
      id: uuid(100 + i),
      name: `Asignatura ${i} de ingeniería y ciencias`,
    }));
    const worst = [
      'a'.repeat(300),
      '1/'.repeat(150),
      `${'redes '.repeat(50)}martes`,
      `${'1 '.repeat(100)}de octubre`,
      '-'.repeat(300),
    ];
    const started = Date.now();
    for (const text of worst) parseQuickCapture(text.slice(0, 300), ctx({ subjects }));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('result structure', () => {
  it('lists what was recognised, what is missing and how sure each field is', () => {
    const r = parse('parcial redes martes 10am');
    expect(r.recognizedFields).toEqual(['type', 'subject', 'date', 'time']);
    expect(r.missingFields).toEqual([]);
    expect(r.certainty).toEqual({ type: 'EXACT', subject: 'EXACT', date: 'LIKELY', time: 'EXACT' });
    expect(r.ambiguities).toEqual([]);
    expect(r.status).toBe('OK');
  });

  it('never exposes percentages: certainty is one of four words', () => {
    const r = parse('asdf');
    for (const value of Object.values(r.certainty))
      expect(['EXACT', 'LIKELY', 'AMBIGUOUS', 'MISSING']).toContain(value);
  });

  it('the status is PENDING-like: the parser proposes no priority, no status and no description', () => {
    const r = parse('parcial redes martes');
    expect(Object.keys(r).sort()).toEqual(
      [
        'ambiguities',
        'certainty',
        'dueDate',
        'dueTime',
        'hasTime',
        'missingFields',
        'rawText',
        'recognizedFields',
        'status',
        'subjectId',
        'title',
        'type',
        'warnings',
      ].sort(),
    );
  });
});

describe('request schema', () => {
  it('accepts only { text }', () => {
    expect(quickCaptureRequestSchema.safeParse({ text: 'parcial redes' }).success).toBe(true);
    expect(quickCaptureRequestSchema.safeParse({ text: '' }).success).toBe(true); // the parser answers EMPTY
    expect(quickCaptureRequestSchema.safeParse({}).success).toBe(false);
    expect(quickCaptureRequestSchema.safeParse({ text: 5 }).success).toBe(false);
    expect(quickCaptureRequestSchema.safeParse({ text: 'x', userId: uuid(1) }).success).toBe(false);
    expect(quickCaptureRequestSchema.safeParse({ text: 'x', subjects: [] }).success).toBe(false);
    expect(quickCaptureRequestSchema.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
  });
});
