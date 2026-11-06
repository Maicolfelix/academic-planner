import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_BLOCKS, parseCaptureProposals } from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';

/**
 * Timetables and activities written the way students write them: many subjects in ONE text, with days, hours and dates in
 * every format. Two parts:
 *  - hand-written cases, each one a bug that was found with a real text (the first one is the QA report);
 *  - seeded generators that build thousands of texts with a KNOWN answer and check every subject, day, hour, type and date.
 * A generated text is a different sentence every time but the same sentence on every run (fixed seeds), so a failure here is
 * a reproducible regression, never a flaky test.
 */

// "Today" is Monday 12 October 2026, 15:00 in Bogotá.
const NOW = new Date('2026-10-12T20:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ctx = (subjects: string[] = []): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects: subjects.map((name, i) => ({ id: id(i + 1), name })),
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const parse = (text: string, subjects: string[] = []) =>
  parseCaptureProposals(text, ctx(subjects), 'QUICK');
const nl = String.fromCharCode(10);
const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad = (n: number) => String(n).padStart(2, '0');

/** "Subject: weekday@start-end,…" for every weekly schedule of the text. */
const schedules = (text: string, subjects: string[] = []) =>
  parse(text, subjects).suggestions.map(
    (s) =>
      `${s.title.value}: ${s.slots.map((x) => `${x.weekday}@${x.time.value}-${x.endTime.value}`).join(',')}`,
  );
/** "TYPE title date time" for every activity of the text. */
const activities = (text: string, subjects: string[] = []) =>
  parse(text, subjects).proposals.map(
    (p) => `${p.type.value} ${p.title.value} ${p.date.value} ${p.time?.value ?? '-'}`,
  );

describe('hand-written cases: every one was a real bug', () => {
  it('the QA report: an existing subject and one made up on the spot', () => {
    expect(
      schedules(
        'Tengo clase de farmacologia todos los jueves de 6:00 AM a 8:00 AM y los miercoles tengo fisiologia de 6:00 PM a 9:00 PM',
        ['Farmacologia'],
      ),
    ).toEqual(['Farmacologia: 4@06:00-08:00', 'Fisiologia: 3@18:00-21:00']);
  });

  it('names keep the small words inside them', () => {
    expect(
      schedules(
        'Tengo Introducción a la programación los martes de 4 a 6 pm y Estructuras de datos los jueves de 2 a 4 pm',
      ),
    ).toEqual([
      'Introducción a la programación: 2@16:00-18:00',
      'Estructuras de datos: 4@14:00-16:00',
    ]);
    expect(activities('Tengo parcial de Introducción a la programación el miércoles')).toEqual([
      'EXAM Parcial de Introducción a la programación 2026-10-14 -',
    ]);
  });

  it('the days of a list belong to the subject that follows, not to the one before', () => {
    expect(
      schedules(
        'los lunes tengo Física de 8 am a 11 am, los jueves, viernes y sábado tengo Farmacología de 6 pm a 7 pm',
      ),
    ).toEqual(['Física: 1@08:00-11:00', 'Farmacología: 4@18:00-19:00,5@18:00-19:00,6@18:00-19:00']);
    expect(
      schedules(
        'todos los lunes y jueves tengo Salud pública de 5 PM a 8 PM, todos los lunes y sábados tengo Ética profesional de 9 AM a 10 AM',
      ),
    ).toEqual([
      'Salud pública: 1@17:00-20:00,4@17:00-20:00',
      'Ética profesional: 1@09:00-10:00,6@09:00-10:00',
    ]);
  });

  it('a second subject with the same day does not lose its hours to the first', () => {
    expect(
      schedules(
        'Anatomía los lunes y viernes de 10 am a 12 pm, bioquímica los martes de 2 pm a 4 pm',
      ),
    ).toEqual(['Anatomía: 1@10:00-12:00,5@10:00-12:00', 'Bioquímica: 2@14:00-16:00']);
  });

  it('plural days, abbreviations and the hour in any of its forms', () => {
    expect(
      schedules(
        'Histología todos los sábados de 8 am a 11 am, Física los lun y mié de 6 pm a 8 pm',
      ),
    ).toEqual(['Histología: 6@08:00-11:00', 'Física: 1@18:00-20:00,3@18:00-20:00']);
    expect(schedules('Física lunes de 06:00 a 07:00, Redes martes de 09:00 a 12:00')).toEqual([
      'Física: 1@06:00-07:00',
      'Redes: 2@09:00-12:00',
    ]);
    expect(
      schedules('Física lunes de 7 A. M. A 10 A. M., Redes martes de 2 P.M. A 4 P.M.'),
    ).toEqual(['Física: 1@07:00-10:00', 'Redes: 2@14:00-16:00']);
    expect(
      schedules('Física lunes de 8 a 10 de la mañana, Redes martes de 7 a 9 de la noche'),
    ).toEqual(['Física: 1@08:00-10:00', 'Redes: 2@19:00-21:00']);
  });

  it('a range of hours with a dash or "entre las … y las …"', () => {
    expect(schedules('Fisiología lunes 7-9, Redes martes 2-4 pm')).toEqual([
      'Fisiología: 1@07:00-09:00',
      'Redes: 2@14:00-16:00',
    ]);
    expect(schedules('Fisiología lunes 8 am - 10 am, Redes martes 8am-10am')).toEqual([
      'Fisiología: 1@08:00-10:00',
      'Redes: 2@08:00-10:00',
    ]);
    expect(
      schedules('Fisiología lunes entre las 8 y las 10 am, Redes martes entre las 2 y las 4 pm'),
    ).toEqual(['Fisiología: 1@08:00-10:00', 'Redes: 2@14:00-16:00']);
  });

  it('a dash between two numbers is a date unless a weekday or an am/pm says hours', () => {
    expect(activities('Entrega el 15-10 del taller de redes').join('|')).toContain('2026-10-15');
    expect(activities('Entrega el 7-9')).toEqual(['TASK Entrega 2027-09-07 -']);
  });

  it('lists with line breaks, numbers, bullets and a heading', () => {
    const expected = ['Fisiología: 1@08:00-10:00', 'Anatomía: 2@14:00-16:00'];
    expect(
      schedules(['Fisiología lunes 8 am a 10 am', 'Anatomía martes 2 pm a 4 pm'].join(nl)),
    ).toEqual(expected);
    expect(
      schedules(['1) Fisiología lunes 8 am a 10 am', '2) Anatomía martes 2 pm a 4 pm'].join(nl)),
    ).toEqual(expected);
    expect(
      schedules(['- Fisiología lunes 8 am a 10 am', '- Anatomía martes 2 pm a 4 pm'].join(nl)),
    ).toEqual(expected);
    expect(
      schedules('Mi horario es: Fisiología lunes 8 am a 10 am, Anatomía martes 2 pm a 4 pm'),
    ).toEqual(expected);
  });

  it('an activity of a subject that does not exist offers to create it, whatever verb comes before the "de"', () => {
    for (const text of [
      'Parcial de Anatomía el viernes',
      'El viernes a las 8 am tengo parcial de Anatomía',
      'Tengo parcial de Anatomía el viernes',
      'El viernes entrego el parcial de Anatomía',
    ]) {
      const [p] = parse(text, ['Farmacología']).proposals;
      expect(p!.subject, text).toMatchObject({ kind: 'UNRESOLVED', suggestedName: 'Anatomía' });
    }
  });

  it('a heading never swallows the sentence before it', () => {
    const r = parse(
      'Mañana tengo quiz de Inglés. Este semestre: Física los martes de 2 pm a 4 pm y Redes los jueves de 8 am a 10 am',
    );
    expect(r.proposals.map((p) => `${p.type.value} ${p.date.value}`)).toEqual(['QUIZ 2026-10-13']);
    expect(r.suggestions.map((s) => s.title.value)).toEqual(['Física', 'Redes']);
  });

  it('the date and the hour written BEFORE an activity belong to it, not to the one before', () => {
    expect(
      activities(
        'El viernes a las 4:30 pm quiz de Macroeconomía, el sábado a las 2 pm taller de Dibujo técnico',
      ),
    ).toEqual([
      'QUIZ Quiz de Macroeconomía 2026-10-16 16:30',
      'WORKSHOP Taller de Dibujo técnico 2026-10-17 14:00',
    ]);
    expect(
      activities(
        'El miércoles a las 6 pm proyecto de Salud pública, el miércoles a las 2 pm taller de Microbiología',
      ),
    ).toEqual([
      'PROJECT Proyecto de Salud pública 2026-10-14 18:00',
      'WORKSHOP Taller de Microbiología 2026-10-14 14:00',
    ]);
  });

  it('an activity with its own day does not borrow the hour said for another', () => {
    expect(
      activities(
        'El 25 de octubre a las 10 am quiz de Epidemiología, el 20 de octubre taller de Inmunología',
      ),
    ).toEqual([
      'QUIZ Quiz de Epidemiología 2026-10-25 10:00',
      'WORKSHOP Taller de Inmunología 2026-10-20 -',
    ]);
  });

  it('timetable and activities in one text, each one where it belongs', () => {
    const r = parse(
      'Tengo Física los lunes de 8 a 10 am y Redes los martes de 2 a 4 pm. Además el viernes tengo parcial de Física a las 8 am y el lunes entrego el taller de Redes antes de las 11:59 pm',
    );
    expect(r.suggestions.map((s) => s.title.value)).toEqual(['Física', 'Redes']);
    expect(r.proposals.map((p) => `${p.type.value} ${p.title.value} ${p.time?.value}`)).toEqual([
      'EXAM Parcial de Física 08:00',
      'WORKSHOP Taller de Redes 23:59',
    ]);
  });
});

// ───────────────────────── Generators ─────────────────────────

/** Thousands of generated texts per test: well over vitest's 5 s default on a loaded machine. */
const GENERATED_TEST_TIMEOUT = 60_000;

const makeRandom = (start: number) => {
  let seed = start;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  const shuffled = <T>(a: readonly T[]): T[] => [...a].sort(() => rnd() - 0.5);
  return { rnd, pick, shuffled };
};

const SUBJECTS = [
  'Farmacología',
  'Fisiología',
  'Anatomía',
  'Bioquímica',
  'Histología',
  'Microbiología',
  'Inmunología',
  'Salud pública',
  'Epidemiología',
  'Cálculo II',
  'Álgebra lineal',
  'Inglés',
  'Física',
  'Química orgánica',
  'Derecho civil',
  'Introducción a la programación',
  'Estructuras de datos',
  'Redes de computadores',
  'Ética profesional',
  'Estadística',
  'Contabilidad',
  'Macroeconomía',
  'Psicología social',
  'Dibujo técnico',
  'Historia de Colombia',
  'Cirugía general',
  'Pediatría',
  'Ortodoncia',
  'Resistencia de materiales',
  'Termodinámica',
];
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ABBR: Record<string, string[]> = {
  lunes: ['lun', 'lunes'],
  martes: ['mar', 'martes'],
  miércoles: ['mié', 'mie', 'miércoles'],
  jueves: ['jue', 'jueves'],
  viernes: ['vie', 'viernes'],
  sábado: ['sáb', 'sab', 'sábado'],
};
const weekdayOf = (d: string) => DAYS.indexOf(d) + 1;
const T12 = (h: number) => ({ n: h % 12 === 0 ? 12 : h % 12, ap: h >= 12 ? 'pm' : 'am' });
const dayPart = (h: number) => (h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche');

interface Entry {
  subject: string;
  days: string[];
  h1: number;
  h2: number;
}
const TIME_FORMATS: ((e: Entry) => string)[] = [
  (e) => `de ${T12(e.h1).n} ${T12(e.h1).ap} a ${T12(e.h2).n} ${T12(e.h2).ap}`,
  (e) =>
    T12(e.h1).ap === T12(e.h2).ap
      ? `de ${T12(e.h1).n} a ${T12(e.h2).n} ${T12(e.h2).ap}`
      : `de ${T12(e.h1).n} ${T12(e.h1).ap} a ${T12(e.h2).n} ${T12(e.h2).ap}`,
  (e) =>
    `de ${T12(e.h1).n}:00 ${T12(e.h1).ap.toUpperCase()} a ${T12(e.h2).n}:00 ${T12(e.h2).ap.toUpperCase()}`,
  (e) => `de ${T12(e.h1).n} ${T12(e.h1).ap[0]}.m. a ${T12(e.h2).n} ${T12(e.h2).ap[0]}.m.`,
  (e) => `de ${T12(e.h1).n} ${T12(e.h1).ap[0]}. m. a ${T12(e.h2).n} ${T12(e.h2).ap[0]}. m.`,
  (e) => `de ${T12(e.h1).n}${T12(e.h1).ap} a ${T12(e.h2).n}${T12(e.h2).ap}`,
  (e) =>
    dayPart(e.h1) === dayPart(e.h2)
      ? `de ${T12(e.h1).n} a ${T12(e.h2).n} ${dayPart(e.h2)}`
      : `de ${T12(e.h1).n} ${dayPart(e.h1)} a ${T12(e.h2).n} ${dayPart(e.h2)}`,
  (e) => `de ${pad(e.h1)}:00 a ${pad(e.h2)}:00`,
  (e) => `desde las ${T12(e.h1).n} ${T12(e.h1).ap} hasta las ${T12(e.h2).n} ${T12(e.h2).ap}`,
  (e) => `de ${T12(e.h1).n} ${T12(e.h1).ap} hasta ${T12(e.h2).n} ${T12(e.h2).ap}`,
  // the same range with a dash, glued or spaced, and "entre las … y las …"
  (e) => `${T12(e.h1).n}${T12(e.h1).ap}-${T12(e.h2).n}${T12(e.h2).ap}`,
  (e) => `${T12(e.h1).n} ${T12(e.h1).ap} - ${T12(e.h2).n} ${T12(e.h2).ap}`,
  (e) => `${T12(e.h1).n}:00-${T12(e.h2).n}:00 ${T12(e.h2).ap}`,
  (e) => `entre las ${T12(e.h1).n} ${T12(e.h1).ap} y las ${T12(e.h2).n} ${T12(e.h2).ap}`,
];
const LAYOUTS: { dotted: boolean; join: (xs: string[]) => string }[] = [
  { dotted: false, join: (xs) => xs.join(', ') },
  { dotted: false, join: (xs) => xs.join(nl) },
  { dotted: false, join: (xs) => xs.map((x) => '- ' + x).join(nl) },
  { dotted: false, join: (xs) => xs.map((x, i) => `${i + 1}) ` + x).join(nl) },
  // a period between entries: with dotted hours ("p. m.") the period doubles ("p. m.."), which nobody writes
  { dotted: true, join: (xs) => xs.join('. ') },
  { dotted: false, join: (xs) => xs.join('; ') },
  { dotted: false, join: (xs) => xs.join(' y luego ') },
  { dotted: false, join: (xs) => xs.map((x) => '• ' + x).join(nl) },
  { dotted: false, join: (xs) => xs.join(nl + nl) },
];
const ENTRY_FORMATS: ((s: string, d: string, t: string) => string)[] = [
  (s, d, t) => `${s} ${d} ${t}`,
  (s, d, t) => `${s} los ${d} ${t}`,
  (s, d, t) => `${s} todos los ${d} ${t}`,
  (s, d, t) => `tengo ${s} los ${d} ${t}`,
  (s, d, t) => `tengo clase de ${s} los ${d} ${t}`,
  (s, d, t) => `${d}: ${s} ${t}`,
  (s, d, t) => `${d} ${s} ${t}`,
  (s, d, t) => `${s}: ${d} ${t}`,
  (s, d, t) => `${s} (${d}) ${t}`,
  (s, d, t) => `${s} - ${d} ${t}`,
  (s, d, t) => `veo ${s} los ${d} ${t}`,
  (s, d, t) => `los ${d} tengo ${s} ${t}`,
];
const INTROS = [
  '',
  '',
  '',
  'Mi horario es: ',
  'Este semestre tengo: ',
  'Hola, mi horario de este semestre: ',
  'Horario: ',
];
const dayList = (days: string[], abbr: boolean, joiner: string, plural: boolean) => {
  const names = days.map((d) => (abbr ? ABBR[d]![0]! : plural && d === 'sábado' ? 'sábados' : d));
  return names.length === 1
    ? names[0]!
    : names.slice(0, -1).join(', ') + ` ${joiner} ` + names.at(-1);
};

/** What the parser said about a timetable, compared with what the generator wrote. Empty = exact. */
function timetableProblems(entries: Entry[], text: string, subjects: string[] = []): string[] {
  const r = parse(text, subjects);
  const got = new Map(
    r.suggestions.map((s) => [
      norm(s.title.value),
      s.slots
        .map((x) => `${x.weekday}@${x.time.value}-${x.endTime.value}`)
        .sort()
        .join(','),
    ]),
  );
  const problems: string[] = [];
  for (const e of entries) {
    const expected = e.days
      .map((d) => `${weekdayOf(d)}@${pad(e.h1)}:00-${pad(e.h2)}:00`)
      .sort()
      .join(',');
    if (got.get(norm(e.subject)) !== expected) {
      problems.push(
        `${e.subject}: expected ${expected}, got ${got.get(norm(e.subject)) ?? 'nothing'}`,
      );
    }
  }
  if (r.suggestions.length !== entries.length) {
    problems.push(`${r.suggestions.length} schedules for ${entries.length} subjects`);
  }
  return problems;
}

describe('generated timetables: 2 to 14 subjects, any layout, any hour format, any case', () => {
  for (const seedStart of [7, 11, 23]) {
    it(
      `2000 texts, seed ${seedStart}: every subject, day and hour exact`,
      () => {
        const { rnd, pick, shuffled } = makeRandom(seedStart);
        const failures: string[] = [];
        let cases = 0;
        while (cases < 2000) {
          const subjects = shuffled(SUBJECTS).slice(0, pick([2, 3, 4, 5, 6, 8, 10, 12, 14]));
          const entries: Entry[] = subjects.map((subject) => {
            const h1 = pick([6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18]);
            return {
              subject,
              days: shuffled(DAYS)
                .slice(0, pick([1, 1, 2, 2, 3]))
                .sort((a, b) => weekdayOf(a) - weekdayOf(b)),
              h1,
              h2: h1 + pick([1, 2, 3]),
            };
          });
          // a capture holds a limited number of weekly blocks: more is refused on purpose
          if (entries.reduce((n, e) => n + e.days.length, 0) > CAPTURE_MAX_BLOCKS) continue;
          const timeFormat = pick(TIME_FORMATS);
          const layout = pick(LAYOUTS);
          const entryFormat = pick(ENTRY_FORMATS);
          const abbreviated = rnd() < 0.15;
          const joiner = pick(['y', 'y', 'y', 'e']);
          const isDotted =
            TIME_FORMATS.indexOf(timeFormat) === 3 || TIME_FORMATS.indexOf(timeFormat) === 4;
          if (layout.dotted && isDotted) continue;
          const letterCase = pick(['asis', 'lower', 'upper', 'noaccent']);
          let text =
            pick(INTROS) +
            layout.join(
              entries.map((e) =>
                entryFormat(
                  e.subject,
                  dayList(e.days, abbreviated, joiner, rnd() < 2),
                  timeFormat(e),
                ),
              ),
            );
          if (letterCase === 'lower') text = text.toLowerCase();
          if (letterCase === 'upper') text = text.toUpperCase();
          if (letterCase === 'noaccent') text = text.normalize('NFD').replace(/\p{M}/gu, '');
          cases++;
          const problems = timetableProblems(entries, text);
          if (problems.length > 0 && failures.length < 3) {
            failures.push(`${text.split(nl).join(' ⏎ ')}  =>  ${problems.slice(0, 2).join(' | ')}`);
          } else if (problems.length > 0) failures.push('…');
        }
        expect(failures).toEqual([]);
      },
      GENERATED_TEST_TIMEOUT,
    );
  }
});

// NOW is a Monday 15:00: the dates below are the next ones from there
const WHEN = [
  { text: 'el martes', date: '2026-10-13' },
  { text: 'el miércoles', date: '2026-10-14' },
  { text: 'el jueves', date: '2026-10-15' },
  { text: 'el viernes', date: '2026-10-16' },
  { text: 'el sábado', date: '2026-10-17' },
  { text: 'mañana', date: '2026-10-13' },
  { text: 'pasado mañana', date: '2026-10-14' },
  { text: 'el 20 de octubre', date: '2026-10-20' },
  { text: 'el 3 de noviembre', date: '2026-11-03' },
  { text: 'el 25 de octubre', date: '2026-10-25' },
];
const TYPES = [
  { word: 'parcial', type: 'EXAM' },
  { word: 'examen', type: 'EXAM' },
  { word: 'quiz', type: 'QUIZ' },
  { word: 'taller', type: 'WORKSHOP' },
  { word: 'tarea', type: 'TASK' },
  { word: 'proyecto', type: 'PROJECT' },
  { word: 'exposición', type: 'PRESENTATION' },
];
interface Activity {
  type: string;
  word: string;
  subject: string;
  when: (typeof WHEN)[number];
  hour: number | null;
  minute: number;
}
const activityText = (a: Activity, style: number): string => {
  const time =
    a.hour === null
      ? ''
      : ` a las ${T12(a.hour).n}${a.minute ? ':' + pad(a.minute) : ''} ${T12(a.hour).ap}`;
  switch (style) {
    case 0:
      return `${a.word} de ${a.subject} ${a.when.text}${time}`;
    case 1:
      return `${a.when.text} tengo ${a.word} de ${a.subject}${time}`;
    case 2:
      return `tengo ${a.word} de ${a.subject} ${a.when.text}${time}`;
    case 3:
      return `${a.word} de ${a.subject} para ${a.when.text}${time}`;
    default:
      return `${a.when.text}${time} ${a.word} de ${a.subject}`;
  }
};
const capitalise = (t: string) =>
  t
    .split(nl)
    .map((line) =>
      line.replace(/(^|[.]\s+)(\p{Ll})/gu, (_m, a: string, b: string) => a + b.toUpperCase()),
    )
    .join(nl);

describe('generated texts with a timetable AND activities in the same message', () => {
  for (const [seedStart, withTimetable] of [
    [5, true],
    [9, true],
    [5, false],
  ] as const) {
    it(
      `1500 texts, seed ${seedStart}${withTimetable ? ', timetable + activities' : ', only activities'}: all of it exact`,
      () => {
        const { rnd, pick, shuffled } = makeRandom(seedStart);
        const failures: string[] = [];
        let cases = 0;
        while (cases < 1500) {
          const subjectsCount = withTimetable ? pick([2, 3, 4, 5]) : 0;
          const activitiesCount = pick([1, 2, 3, 4]);
          const all = shuffled(SUBJECTS);
          const timetableSubjects = all.slice(0, subjectsCount);
          const activitySubjects = Array.from({ length: activitiesCount }, () =>
            rnd() < 0.6 && subjectsCount > 0
              ? pick(timetableSubjects)
              : pick(all.slice(subjectsCount)),
          );
          const entries: Entry[] = timetableSubjects.map((subject) => {
            const h1 = pick([6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18]);
            return {
              subject,
              days: shuffled(DAYS)
                .slice(0, pick([1, 1, 2, 3]))
                .sort((a, b) => weekdayOf(a) - weekdayOf(b)),
              h1,
              h2: h1 + pick([1, 2, 3]),
            };
          });
          if (entries.reduce((n, e) => n + e.days.length, 0) > CAPTURE_MAX_BLOCKS) continue;
          const used = new Set<string>();
          const activitiesList: Activity[] = activitySubjects.map((subject) => {
            for (let tries = 0; tries < 20; tries++) {
              const t = pick(TYPES);
              const when = pick(WHEN);
              const key = `${t.type}|${subject}|${when.date}`;
              if (used.has(key)) continue;
              used.add(key);
              return {
                type: t.type,
                word: t.word,
                subject,
                when,
                hour: rnd() < 0.8 ? pick([7, 8, 9, 10, 14, 15, 16, 18]) : null,
                minute: rnd() < 0.2 ? 30 : 0,
              };
            }
            return {
              type: 'TASK',
              word: 'tarea',
              subject,
              when: pick(WHEN),
              hour: null,
              minute: 0,
            };
          });
          const entryStyle = pick(['tengo S los D T', 'S los D T', 'D: S T']);
          const entryText = (e: Entry) => {
            const days = dayList(e.days, false, 'y', true);
            const time = `de ${T12(e.h1).n} ${T12(e.h1).ap} a ${T12(e.h2).n} ${T12(e.h2).ap}`;
            if (entryStyle === 'tengo S los D T') return `tengo ${e.subject} los ${days} ${time}`;
            if (entryStyle === 'S los D T') return `${e.subject} los ${days} ${time}`;
            return `${days}: ${e.subject} ${time}`;
          };
          const style = pick([0, 1, 2, 3, 4]);
          const timetableText = entries.map(entryText).join(pick([', ', '; ', ' y luego ']));
          const activitiesText = activitiesList
            .map((a) => activityText(a, style))
            .join(pick(['. ', '; ', ', ']));
          const intro = pick(['', 'Mi horario: ', 'Este semestre: ']);
          const joiner = pick(['. ', '.' + nl, '. Además ', '. También ']);
          const text =
            subjectsCount === 0
              ? activitiesText
              : pick(['first', 'last', 'first']) === 'first'
                ? `${intro}${timetableText}${joiner}${activitiesText}`
                : `${activitiesText}${joiner}${intro}${timetableText}`;
          const finalText = capitalise(text);
          cases++;
          const r = parse(finalText, timetableSubjects.slice(0, 2));
          const problems = timetableProblems(entries, finalText, timetableSubjects.slice(0, 2));
          const expectedActivities = activitiesList
            .map(
              (a) =>
                `${a.type}|${a.when.date}|${a.hour === null ? '-' : pad(a.hour) + ':' + pad(a.minute)}`,
            )
            .sort();
          const gotActivities = r.proposals
            .map((p) => `${p.type.value}|${p.date.value}|${p.time?.value ?? '-'}`)
            .sort();
          if (JSON.stringify(expectedActivities) !== JSON.stringify(gotActivities)) {
            problems.push(
              `activities: expected ${expectedActivities.join(' ; ')}, got ${gotActivities.join(' ; ')}`,
            );
          }
          const titles = r.proposals.map((p) => norm(p.title.value)).join(' | ');
          for (const a of activitiesList) {
            // a subject that exists is linked to the activity; one that does not is OFFERED to be created, never dropped silently
            const linked = r.proposals.some(
              (p) => 'name' in p.subject && norm(p.subject.name) === norm(a.subject),
            );
            const offered = r.proposals.some(
              (p) =>
                p.subject.kind === 'UNRESOLVED' &&
                norm(p.subject.suggestedName ?? '') === norm(a.subject),
            );
            // (a student with NO subjects at all is never asked about one: that is the design, not a gap)
            if (subjectsCount > 0 && !linked && !offered) {
              problems.push(`the subject ${a.subject} is neither linked nor offered: ${titles}`);
            }
          }
          if (problems.length > 0) {
            failures.push(
              failures.length < 3
                ? `${finalText.split(nl).join(' ⏎ ')}  =>  ${problems.slice(0, 2).join(' | ')}`
                : '…',
            );
          }
        }
        expect(failures).toEqual([]);
      },
      GENERATED_TEST_TIMEOUT,
    );
  }
});

describe('a line break after a timetable entry (no period)', () => {
  // Reported with the app: the last entry swallowed the next sentence ("Fisiología parcial" twice, no schedules, no Anatomía).
  const lines = [
    'Farmacología jueves de 6:00 AM a 8:00 AM',
    'Fisiología miércoles de 6:00 PM a 9:00 PM',
    'Mañana tengo parcial de Anatomía',
  ];

  it('reads both schedules and one exam, the same as with a period', () => {
    for (const text of [lines.join(nl), lines.join(nl).replace('9:00 PM', '9:00 PM.')]) {
      expect(schedules(text, ['Anatomía'])).toEqual([
        'Farmacología: 4@06:00-08:00',
        'Fisiología: 3@18:00-21:00',
      ]);
      const found = parse(text, ['Anatomía']).proposals;
      expect(found).toHaveLength(1);
      expect(found[0]!.title.value).not.toMatch(/fisiolog/i);
      expect(found[0]!.subject).toMatchObject({ kind: 'EXISTING', name: 'Anatomía' });
    }
  });

  it('offers the unknown subject of the exam', () => {
    const found = parse(lines.join(nl), []).proposals;
    expect(found).toHaveLength(1);
    expect(found[0]!.title.value).toMatch(/anatom/i);
  });

  it('does not split a sentence that goes on after the hour range', () => {
    const text = [
      'Física lunes de 8 a 10',
      'Y química martes de 2 a 4',
      'Mañana tengo parcial de Redes',
    ].join(nl);
    expect(schedules(text)).toEqual(['Física: 1@08:00-10:00', 'Química: 2@14:00-16:00']);
  });
});

describe('everything in one line, with no period, no line break and no "y"', () => {
  const a = 'Farmacología jueves de 6:00 AM a 8:00 AM';
  const b = 'Fisiología miércoles de 6:00 PM a 9:00 PM';
  const both = ['Farmacología: 4@06:00-08:00', 'Fisiología: 3@18:00-21:00'];

  it('splits the timetable from the exam that follows it', () => {
    for (const exam of [
      'Mañana tengo parcial de Anatomía',
      'mañana tengo parcial de anatomía',
      'y mañana tengo parcial de Anatomía',
    ]) {
      const text = `${a} ${b} ${exam}`;
      expect(schedules(text, ['Anatomía'])).toEqual(both);
      expect(activities(text, ['Anatomía'])).toEqual(['EXAM Parcial 2026-10-13 -']);
      expect(schedules(text)).toEqual(both);
      expect(activities(text)).toHaveLength(1);
    }
  });

  it('keeps the day of the next activity out of the schedule before it', () => {
    const text = `${a} ${b} el viernes entrego el taller de Bioquímica`;
    expect(schedules(text)).toEqual(both);
    expect(activities(text)).toEqual(['WORKSHOP Taller de Bioquímica 2026-10-16 -']);
  });

  it('reads a whole lowercase timetable typed on a phone and still finds the exam', () => {
    const text =
      'farmacologia jueves 6am a 8am fisiologia miercoles 6pm a 9pm anatomia viernes 2pm a 4pm mañana tengo parcial de bioquimica';
    expect(schedules(text)).toEqual([
      'Farmacologia: 4@06:00-08:00',
      'Fisiologia: 3@18:00-21:00',
      'Anatomia: 5@14:00-16:00',
    ]);
    expect(activities(text)).toEqual(['EXAM Parcial de bioquimica 2026-10-13 -']);
  });

  it('does not cut a range that goes on with "con", "en" or a second hour', () => {
    // the room and the teacher stay with their own class (the title can still be edited); nothing becomes a third thing
    const found = schedules(
      'Física lunes de 8 a 10 en el salón 204 y química martes de 2 a 4 con Pérez',
    );
    expect(found.map((s) => s.split(': ')[1])).toEqual(['1@08:00-10:00', '2@14:00-16:00']);
    expect(activities('Física lunes de 8 a 10 en el salón 204 y química martes de 2 a 4')).toEqual(
      [],
    );
  });
});
