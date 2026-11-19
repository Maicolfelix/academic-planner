import { describe, expect, it } from 'vitest';
import { parseCaptureProposals } from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';

/**
 * Spanish the way students write it, with a KNOWN answer: hand-written cases (each one was wrong before) and seeded generators
 * (fixed seeds: a failure is a reproducible regression, never a flaky test). "Today" is Wednesday 18 November 2026, 15:00 in
 * Bogotá. Wednesday is left out of the generators on purpose: "el miércoles" said on a Wednesday is today by the documented rule.
 */
const NOW = new Date('2026-11-18T20:00:00.000Z');
const SUBJECTS = ['Redes', 'Cálculo', 'Física', 'Programación Web', 'Bases de Datos', 'Inglés'];
const ctx = (): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects: SUBJECTS.map((name, i) => ({
    id: `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`,
    name,
  })),
  period: { startDate: '2026-08-03', endDate: '2026-12-28' },
});
const read = (text: string) => parseCaptureProposals(text, ctx(), 'QUICK');
const row = (p: ReturnType<typeof read>['proposals'][number]) =>
  `${p.type.value} ${p.date.value ?? '-'} ${p.time?.value ?? '-'} ${p.subject.kind === 'EXISTING' ? p.subject.name : '-'}`;
const rows = (text: string) => read(text).proposals.map(row);

const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
};
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const pad = (n: number) => String(n).padStart(2, '0');

const DAY_DATE: Record<string, string> = {
  lunes: '2026-11-23',
  martes: '2026-11-24',
  jueves: '2026-11-19',
  viernes: '2026-11-20',
  sábado: '2026-11-21',
  domingo: '2026-11-22',
};
const SUBJECT_FORMS: [string, string][] = [
  ['redes', 'Redes'],
  ['cálculo', 'Cálculo'],
  ['calculo', 'Cálculo'],
  ['física', 'Física'],
  ['fisica', 'Física'],
  ['programación web', 'Programación Web'],
  ['programacion web', 'Programación Web'],
  ['bases de datos', 'Bases de Datos'],
  ['inglés', 'Inglés'],
  ['ingles', 'Inglés'],
];
const TYPE_WORDS: [string, string][] = [
  ['parcial', 'EXAM'],
  ['examen', 'EXAM'],
  ['evaluación', 'EXAM'],
  ['evaluacion', 'EXAM'],
  ['prueba', 'EXAM'],
  ['quiz', 'QUIZ'],
  ['control', 'QUIZ'],
  ['cuestionario', 'QUIZ'],
  ['taller', 'WORKSHOP'],
  ['laboratorio', 'WORKSHOP'],
  ['práctica', 'WORKSHOP'],
  ['tarea', 'TASK'],
  ['trabajo', 'TASK'],
  ['informe', 'TASK'],
  ['proyecto', 'PROJECT'],
  ['exposición', 'PRESENTATION'],
  ['presentación', 'PRESENTATION'],
  ['sustentación', 'PRESENTATION'],
  ['defensa', 'PRESENTATION'],
  ['lectura', 'READING'],
];
const NOISE =
  /tengo|toca|recu[eé]rdame|olvidar|viernes|lunes|martes|jueves|para|hasta|antes|redes|c[aá]lculo|f[ií]sica|ingl[eé]s/i;

describe('hand-written: each one was wrong, silently or loudly', () => {
  it('"entrega de <type>" is ONE activity, of that type', () => {
    expect(rows('entrega de proyecto de redes el viernes')).toEqual(['PROJECT 2026-11-20 - Redes']);
    expect(rows('entrega del quiz de cálculo el lunes antes de las 11:59 pm')).toEqual([
      'QUIZ 2026-11-23 23:59 Cálculo',
    ]);
  });

  it('the new type words: evaluación, prueba, control, cuestionario, laboratorio, práctica, sustentación, defensa', () => {
    expect(rows('tengo evaluación de redes el viernes')).toEqual(['EXAM 2026-11-20 - Redes']);
    expect(rows('tengo control de lectura el jueves')).toEqual(['QUIZ 2026-11-19 - -']);
    expect(rows('laboratorio de física el martes')).toEqual(['WORKSHOP 2026-11-24 - Física']);
    expect(rows('sustentación del proyecto de redes el jueves')).toEqual([
      'PRESENTATION 2026-11-19 - Redes',
    ]);
    expect(read('tengo defensa de tesis el 12 de diciembre').proposals[0]!.title.value).toBe(
      'Defensa de tesis',
    );
  });

  it("a day right before the next activity word is that activity's own day", () => {
    expect(rows('tengo parcial de cálculo el martes y el jueves quiz de redes')).toEqual([
      'EXAM 2026-11-24 - Cálculo',
      'QUIZ 2026-11-19 - Redes',
    ]);
    expect(rows('tengo parcial el martes, el jueves quiz')).toEqual([
      'EXAM 2026-11-24 - -',
      'QUIZ 2026-11-19 - -',
    ]);
    // …but two days of ONE activity stay together
    expect(rows('tengo parcial de redes el martes y el jueves')).toEqual([
      'EXAM 2026-11-24 - Redes',
      'EXAM 2026-11-26 - Redes', // a list of days is one run: the Thursday after that Tuesday
    ]);
  });

  it('spoken hours: y media, y cuarto, menos cuarto, mediodía, medianoche, 24-hour with a leading zero', () => {
    const at = (when: string) => rows(`parcial de redes el viernes ${when}`)[0];
    expect(at('a las 8 y media de la mañana')).toBe('EXAM 2026-11-20 08:30 Redes');
    expect(at('a las 3 y media de la tarde')).toBe('EXAM 2026-11-20 15:30 Redes');
    expect(at('a las 8 y cuarto am')).toBe('EXAM 2026-11-20 08:15 Redes');
    expect(at('a las 9 menos cuarto de la noche')).toBe('EXAM 2026-11-20 20:45 Redes');
    expect(at('al mediodía')).toBe('EXAM 2026-11-20 12:00 Redes');
    expect(at('a medianoche')).toBe('EXAM 2026-11-20 23:59 Redes');
    expect(at('a las 14:30 horas')).toBe('EXAM 2026-11-20 14:30 Redes');
    expect(at('a eso de las 3 pm')).toBe('EXAM 2026-11-20 15:00 Redes');
    expect(at('a las 7 en punto de la mañana')).toBe('EXAM 2026-11-20 07:00 Redes');
  });

  it('dates: "el día 24", "para el 24", "3 de dic", "del 2026", ISO and ranges', () => {
    expect(rows('parcial de redes el día 24')).toEqual(['EXAM 2026-11-24 - Redes']);
    expect(rows('entrega de física para el 24')).toEqual(['TASK 2026-11-24 - Física']);
    expect(rows('quiz de inglés el 3 de dic')).toEqual(['QUIZ 2026-12-03 - Inglés']);
    expect(rows('parcial de cálculo el 19 de noviembre del 2026')).toEqual([
      'EXAM 2026-11-19 - Cálculo',
    ]);
    expect(rows('parcial de redes 2026-12-04')).toEqual(['EXAM 2026-12-04 - Redes']);
    expect(rows('proyecto de redes del 23 al 27 de noviembre')).toEqual([
      'PROJECT 2026-11-27 - Redes',
    ]);
  });

  it('typed short and with slips: d, q, x, tngo, vienres, mañna, bd', () => {
    expect(rows('parcial d redes el viernes')).toEqual(['EXAM 2026-11-20 - Redes']);
    expect(rows('tngo parcial de redes el viernes')).toEqual(['EXAM 2026-11-20 - Redes']);
    expect(rows('parcial de bases de datos el vienres')).toEqual([
      'EXAM 2026-11-20 - Bases de Datos',
    ]);
    expect(rows('mañna tengo quiz de fisica')).toEqual(['QUIZ 2026-11-19 - Física']);
    expect(rows('parcial de bd el lunes')).toEqual(['EXAM 2026-11-23 - Bases de Datos']);
  });

  it('corrections and cancellations: "no el martes", "perdón el jueves", "se canceló", "no tengo"', () => {
    expect(rows('el parcial de redes es el lunes no el martes')).toEqual([
      'EXAM 2026-11-23 - Redes',
    ]);
    expect(rows('quiz de cálculo el martes, perdón el jueves')).toEqual([
      'QUIZ 2026-11-19 - Cálculo',
    ]);
    expect(read('se canceló el parcial de redes').proposals).toEqual([]);
    expect(read('no tengo parcial de redes esta semana').proposals).toEqual([]);
    // what is NOT cancelled in the same text is still read
    expect(rows('no tengo parcial de redes pero sí quiz de cálculo el lunes')).toEqual([
      'QUIZ 2026-11-23 - Cálculo',
    ]);
  });

  it('titles lose the words around the activity: recuérdame, me toca, se entrega, hoy mismo, en la tarde', () => {
    const title = (t: string) => read(t).proposals[0]!.title.value;
    expect(title('recuérdame entregar la tarea de física el viernes')).toBe('Entregar tarea');
    expect(title('me toca exposición de inglés el jueves')).toBe('Exposición');
    expect(title('el taller de redes se entrega el jueves')).toBe('Taller');
    expect(title('parcial de redes hoy mismo a las 6 pm')).toBe('Parcial');
    expect(title('parcial de redes el viernes en la tarde')).toBe('Parcial');
    expect(title('ayyy tengo parcial de redes el viernes')).toBe('Parcial');
  });

  it('a numbered list on one line: the numbers are not part of the titles', () => {
    expect(
      rows(
        '1. parcial de redes el lunes 2. quiz de cálculo el martes 3. taller de física el jueves',
      ),
    ).toEqual([
      'EXAM 2026-11-23 - Redes',
      'QUIZ 2026-11-24 - Cálculo',
      'WORKSHOP 2026-11-19 - Física',
    ]);
  });

  it('an hour for the second of two: "parcial a las 7 y otro a las 9"', () => {
    expect(read('tengo parcial a las 7 y otro a las 9 el viernes').proposals).toHaveLength(2);
  });

  it('a deadline range of days with no hour is ONE activity due on the last day', () => {
    expect(rows('taller de física del lunes al viernes')).toEqual(['WORKSHOP 2026-11-27 - Física']);
  });
});

describe('generated: the same activity said many ways', () => {
  it('800 hours in 11 spoken and written formats', () => {
    const r = lcg(31);
    const bad: string[] = [];
    for (let n = 0; n < 800; n++) {
      const h = 1 + Math.floor(r() * 12);
      const mer = r() < 0.5 ? 'am' : 'pm';
      const minute = pick(r, [0, 15, 30, 45]);
      const hh24 = (h % 12) + (mer === 'pm' ? 12 : 0);
      const want = `${pad(hh24)}:${pad(minute)}`;
      const mm = minute === 0 ? '' : `:${pad(minute)}`;
      const part =
        mer === 'am' ? 'de la mañana' : h <= 6 || h === 12 ? 'de la tarde' : 'de la noche';
      const options: [string, string][] = [
        [`a las ${h}${mm} ${mer}`, want],
        [`a las ${h}${mm}${mer}`, want],
        [`a las ${h}${mm} ${mer === 'am' ? 'a. m.' : 'p. m.'}`, want],
      ];
      // "de la mañana/tarde/noche" only settles the hours where the phrase leaves no doubt (see meridiemWords)
      if (mer === 'am' && h >= 6 && h <= 11) options.push([`a las ${h}${mm} ${part}`, want]);
      if (mer === 'pm' && h >= 1 && h <= 8) options.push([`a las ${h}${mm} de la tarde`, want]);
      if (mer === 'pm' && h >= 6 && h <= 11) options.push([`a las ${h}${mm} de la noche`, want]);
      if (minute === 30) options.push([`a las ${h} y media ${mer}`, want]);
      if (minute === 15) options.push([`a las ${h} y cuarto ${mer}`, want]);
      if (minute === 45 && h < 12) options.push([`a las ${h + 1} menos cuarto ${mer}`, want]);
      if (hh24 >= 13) options.push([`a las ${hh24}:${pad(minute)}`, want]);
      if (hh24 >= 13) options.push([`a las ${hh24}:${pad(minute)} horas`, want]);
      options.push([`a eso de las ${h}${mm} ${mer}`, want]);
      const [when, expected] = pick(r, options);
      const [subjectText, subject] = pick(r, SUBJECT_FORMS);
      const day = pick(r, Object.keys(DAY_DATE));
      const text = `parcial de ${subjectText} el ${day} ${when}`;
      const got = rows(text);
      const exp = [`EXAM ${DAY_DATE[day]} ${expected} ${subject}`];
      if (JSON.stringify(got) !== JSON.stringify(exp))
        bad.push(`${JSON.stringify(text)} → ${JSON.stringify(got)} (wanted ${exp[0]})`);
    }
    expect(bad.slice(0, 12)).toEqual([]);
  }, 60_000);

  it('800 dates in 8 formats', () => {
    const r = lcg(41);
    const MONTHS = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];
    const ABBR = [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ];
    const bad: string[] = [];
    for (let n = 0; n < 800; n++) {
      // a date from today to the end of January 2027
      const offset = Math.floor(r() * 75);
      const d = new Date(Date.UTC(2026, 10, 18 + offset));
      const D = d.getUTCDate();
      const M = d.getUTCMonth() + 1;
      const Y = d.getUTCFullYear();
      const want = `${Y}-${pad(M)}-${pad(D)}`;
      const options: string[] = [
        `el ${D} de ${MONTHS[M - 1]}`,
        `el ${D} de ${MONTHS[M - 1]} de ${Y}`,
        `${D}/${M}`,
        `${D}/${pad(M)}/${Y}`,
        `${D}-${M}-${Y}`,
        `${Y}-${pad(M)}-${pad(D)}`,
      ];
      if (ABBR[M - 1] !== 'mar' && ABBR[M - 1] !== 'may')
        options.push(`el ${D} de ${ABBR[M - 1]}`, `${D} ${ABBR[M - 1]}`);
      // "el día D" / "para el D" name no month: the next time the calendar shows that day
      if (M === 11 || (M === 12 && D < 18)) options.push(`el día ${D}`, `para el ${D}`);
      const when = pick(r, options);
      const [subjectText, subject] = pick(r, SUBJECT_FORMS);
      const text = `quiz de ${subjectText} ${when}`;
      const got = rows(text);
      const exp = `QUIZ ${want} - ${subject}`;
      if (got.length !== 1 || got[0] !== exp)
        bad.push(`${JSON.stringify(text)} → ${JSON.stringify(got)} (wanted ${exp})`);
    }
    expect(bad.slice(0, 12)).toEqual([]);
  }, 60_000);

  it('1200 activities with any type word, lead-in and day phrase: type, subject, date and a clean title', () => {
    const r = lcg(51);
    const LEADS = [
      '',
      'tengo ',
      'hay ',
      'me toca ',
      'recuérdame ',
      'no olvidar ',
      'toca ',
      'tengo que entregar ',
    ];
    const bad: string[] = [];
    for (let n = 0; n < 1200; n++) {
      const [word, type] = pick(r, TYPE_WORDS);
      const [subjectText, subject] = pick(r, SUBJECT_FORMS);
      const day = pick(r, Object.keys(DAY_DATE));
      const dayPhrase = pick(r, [`el ${day}`, `para el ${day}`, `este ${day}`]);
      // "entregar un parcial" is not a sentence, and "entregar el laboratorio" hands in a report (a TASK): the delivery verb goes
      // with the work words only
      const lead = pick(
        r,
        LEADS.filter(
          (l) =>
            !l.includes('entregar') ||
            ['tarea', 'trabajo', 'informe', 'proyecto', 'taller'].includes(word),
        ),
      );
      const text = `${lead}${word} de ${subjectText} ${dayPhrase}`;
      const got = read(text).proposals;
      const ok =
        got.length === 1 &&
        got[0]!.type.value === type &&
        got[0]!.date.value === DAY_DATE[day] &&
        got[0]!.subject.kind === 'EXISTING' &&
        got[0]!.subject.name === subject &&
        !NOISE.test(got[0]!.title.value.replace(/entregar/i, ''));
      if (!ok)
        bad.push(
          `${JSON.stringify(text)} → ${JSON.stringify(got.map((p) => `${p.type.value}|${p.title.value}|${p.date.value}|${p.subject.kind === 'EXISTING' ? p.subject.name : '-'}`))}`,
        );
    }
    expect(bad.slice(0, 12)).toEqual([]);
  }, 60_000);

  it('1000 texts of 2 to 4 activities joined any way', () => {
    const r = lcg(61);
    const CONNECTORS = [
      ', ',
      ' y ',
      '; ',
      '. ',
      ' además ',
      ' también ',
      ' y también ',
      ' luego ',
      ' y luego ',
      ' y después ',
    ];
    const bad: string[] = [];
    for (let n = 0; n < 1000; n++) {
      const count = 2 + Math.floor(r() * 3);
      const days = ['lunes', 'martes', 'jueves', 'viernes'].sort(() => r() - 0.5).slice(0, count);
      const subjects = [...SUBJECT_FORMS].sort(() => r() - 0.5);
      const used = new Set<string>();
      const parts: string[] = [];
      const want: string[] = [];
      for (let k = 0; k < count; k++) {
        const [word, type] = pick(
          r,
          TYPE_WORDS.filter(([w]) => !['informe', 'trabajo', 'defensa', 'control'].includes(w)),
        );
        const [subjectText, subject] = subjects.find(([, s]) => !used.has(s))!;
        used.add(subject);
        parts.push(`${word} de ${subjectText} el ${days[k]}`);
        want.push(`${type} ${DAY_DATE[days[k]!]} - ${subject}`);
      }
      let text = parts[0]!;
      for (let k = 1; k < count; k++) text += pick(r, CONNECTORS) + parts[k];
      const got = rows(text);
      if (JSON.stringify(got) !== JSON.stringify(want))
        bad.push(
          `${JSON.stringify(text)} → ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`,
        );
    }
    expect(bad.slice(0, 12)).toEqual([]);
  }, 60_000);

  it('600 weekdays typed with one slip', () => {
    const r = lcg(71);
    const bad: string[] = [];
    const names = Object.keys(DAY_DATE).filter((d) => d.length >= 5);
    for (let n = 0; n < 600; n++) {
      const day = pick(r, names);
      const letters = [...day.normalize('NFD').replace(/\p{M}/gu, '')];
      const i = 1 + Math.floor(r() * (letters.length - 2)); // never the first letter
      const kind = pick(r, ['swap', 'drop', 'double'] as const);
      const slip = [...letters];
      if (kind === 'swap' && i + 1 < letters.length)
        [slip[i], slip[i + 1]] = [slip[i + 1]!, slip[i]!];
      else if (kind === 'drop') slip.splice(i, 1);
      else slip.splice(i, 0, letters[i]!);
      const typed = slip.join('');
      const text = `parcial de redes el ${typed}`;
      const clean = typed.length >= 5 && typed !== letters.join('');
      if (!clean) continue;
      const got = rows(text);
      const exp = [`EXAM ${DAY_DATE[day]} - Redes`];
      if (JSON.stringify(got) !== JSON.stringify(exp))
        bad.push(`${JSON.stringify(text)} → ${JSON.stringify(got)}`);
    }
    expect(bad.slice(0, 12)).toEqual([]);
  }, 60_000);
});

describe('the Inbox: messages a teacher sends', () => {
  const inbox = (text: string) => parseCaptureProposals(text, ctx(), 'INBOX');
  const inboxRows = (text: string) => inbox(text).proposals.map(row);

  it('greetings, "les recuerdo", "se aplazó" and the room are not part of the titles', () => {
    const one = inbox(
      'Estimados estudiantes, les recuerdo que el parcial de Redes será el próximo martes 24 de noviembre a las 8:00 am en el salón 301. Traer calculadora.',
    );
    expect(one.proposals.map(row)).toEqual(['EXAM 2026-11-24 08:00 Redes']);
    expect(one.proposals[0]!.title.value).toBe('Parcial');
    const two = inbox(
      'Buenas tardes. Informo que la entrega del proyecto final de Programación Web se aplazó para el 4 de diciembre a las 11:59 pm. El quiz de Cálculo sigue para este viernes.',
    );
    expect(two.proposals.map(row)).toEqual([
      'PROJECT 2026-12-04 23:59 Programación Web',
      'QUIZ 2026-11-20 - Cálculo',
    ]);
    expect(two.proposals.map((p) => p.title.value)).toEqual(['Proyecto final', 'Quiz']);
  });

  it('"se entrega el jueves … antes de las 6 pm" is one workshop', () => {
    expect(
      inboxRows(
        'Hola grupo, el taller de Bases de Datos se entrega el jueves 26 de noviembre antes de las 6 pm por la plataforma. La exposición de Inglés es el lunes 30 de noviembre.',
      ),
    ).toEqual(['WORKSHOP 2026-11-26 18:00 Bases de Datos', 'PRESENTATION 2026-11-30 - Inglés']);
  });

  it('three finals in a row, each with its own hour', () => {
    expect(
      inboxRows(
        'Recuerden: parcial final de Cálculo el 2 de diciembre, 7 am. Parcial final de Redes el 3 de diciembre, 7 am. Parcial final de Física el 4 de diciembre, 10 am.',
      ),
    ).toEqual([
      'EXAM 2026-12-02 07:00 Cálculo',
      'EXAM 2026-12-03 07:00 Redes',
      'EXAM 2026-12-04 10:00 Física',
    ]);
  });

  it('a change of date keeps only the new day: "ahora será el miércoles … en lugar del martes"', () => {
    expect(
      inboxRows(
        'Se cambia la fecha del parcial de Redes: ahora será el miércoles 25 de noviembre en lugar del martes.',
      ),
    ).toEqual(['EXAM 2026-11-25 - Redes']);
  });

  it('a schedule numbered "1) … 2) …" with its preamble', () => {
    const got = inbox(
      'Les comparto el cronograma: 1) quiz de Redes el 24/11 2) taller de Inglés el 26/11 3) parcial de Física el 1/12 4) entrega del proyecto de Cálculo el 8/12',
    );
    expect(got.proposals.map(row)).toEqual([
      'QUIZ 2026-11-24 - Redes',
      'WORKSHOP 2026-11-26 - Inglés',
      'EXAM 2026-12-01 - Física',
      'PROJECT 2026-12-08 - Cálculo',
    ]);
    expect(got.proposals.map((p) => p.title.value)).toEqual([
      'Quiz',
      'Taller',
      'Parcial',
      'Proyecto',
    ]);
  });

  it('a forum open until Sunday', () => {
    expect(
      inboxRows(
        'Recordatorio: foro de Inglés abierto hasta el domingo 29 de noviembre a las 11:59 p. m.',
      ),
    ).toEqual(['TASK 2026-11-29 23:59 Inglés']);
  });

  it('"no habrá clase" says there is nothing to add', () => {
    expect(inbox('Profe: no habrá clase el viernes.').proposals).toEqual([]);
  });
});

describe('a count announced with a colon, then the list', () => {
  it('"dos evaluaciones: lunes 23 evaluación de Física y miércoles 25 evaluación de Cálculo" are two, not four', () => {
    for (const text of [
      'tengo dos evaluaciones: lunes 23 evaluación de Física y miércoles 25 evaluación de Cálculo',
      'la próxima semana tendremos dos evaluaciones: lunes 23 evaluación de Física y miércoles 25 evaluación de Cálculo',
    ]) {
      expect(rows(text)).toEqual(['EXAM 2026-11-23 - Física', 'EXAM 2026-11-25 - Cálculo']);
    }
  });

  it('one type word and two days, each with its own subject', () => {
    expect(rows('tengo evaluación el lunes 23 de Física y el miércoles 25 de Cálculo')).toEqual([
      'EXAM 2026-11-23 - Física',
      'EXAM 2026-11-25 - Cálculo',
    ]);
    expect(rows('tengo 2 parciales: uno de redes el jueves y otro de cálculo el viernes')).toEqual([
      'EXAM 2026-11-19 - Redes',
      'EXAM 2026-11-20 - Cálculo',
    ]);
  });
});

describe('round 5: one type word for several subjects, bare days, number runs, class lists', () => {
  const titles = (text: string) => read(text).proposals.map((p) => p.title.value);

  it('"parcial de Redes y Cálculo el viernes" are two exams, none lost', () => {
    expect(rows('Tengo parcial de Redes y Cálculo el viernes')).toEqual([
      'EXAM 2026-11-20 - Redes',
      'EXAM 2026-11-20 - Cálculo',
    ]);
    expect(rows('Parciales de Redes, Física y Cálculo el lunes')).toEqual([
      'EXAM 2026-11-23 - Redes',
      'EXAM 2026-11-23 - Física',
      'EXAM 2026-11-23 - Cálculo',
    ]);
    expect(rows('El viernes tengo parcial de Redes a las 8 am y de Cálculo a las 10 am')).toEqual([
      'EXAM 2026-11-20 08:00 Redes',
      'EXAM 2026-11-20 10:00 Cálculo',
    ]);
  });

  it('two different type words, or one subject twice, stay as they were', () => {
    expect(rows('Quiz de Redes y Cálculo el lunes y taller de Física el martes')).toEqual([
      'QUIZ 2026-11-23 - Redes',
      'QUIZ 2026-11-23 - Cálculo',
      'WORKSHOP 2026-11-24 - Física',
    ]);
    expect(rows('Taller de Redes el lunes y de Cálculo el martes')).toEqual([
      'WORKSHOP 2026-11-23 - Redes',
      'WORKSHOP 2026-11-24 - Cálculo',
    ]);
  });

  it('a day followed by "entrego/tengo" starts the next activity, it is not one more day of the one before', () => {
    expect(
      rows('Parcial de Física el martes y el jueves entrego proyecto de Programación Web'),
    ).toEqual(['EXAM 2026-11-24 - Física', 'PROJECT 2026-11-19 - Programación Web']);
    expect(rows('Parcial de Física el martes y el jueves tengo proyecto de Redes')).toEqual([
      'EXAM 2026-11-24 - Física',
      'PROJECT 2026-11-19 - Redes',
    ]);
  });

  it('"el 11", "el 25": a bare day of the month is the next one that has it', () => {
    expect(rows('Parcial de Física el 25')).toEqual(['EXAM 2026-11-25 - Física']);
    expect(rows('Proyecto de Redes para el 10 de diciembre. Sustentación el 11.')).toEqual([
      'PROJECT 2026-12-10 - Redes',
      'PRESENTATION 2026-12-11 - -',
    ]);
    expect(rows('Tengo 2 tareas: una el 25 y otra el 27')).toEqual([
      'TASK 2026-11-25 - -',
      'TASK 2026-11-27 - -',
    ]);
    expect(rows('Parcial de Cálculo el 3 a las 2 pm')).toEqual(['EXAM 2026-12-03 14:00 Cálculo']);
  });

  it('numbers after "capítulo, ejercicio, página, tema" are what is asked for, not hours, days or activities', () => {
    expect(titles('Leer capítulos 3 y 4 de Física para el martes')).toEqual([
      'Leer capítulos 3 y 4',
    ]);
    expect(titles('Tarea de Cálculo ejercicios 1, 2 y 3 para el viernes')).toEqual([
      'Tarea ejercicios 1, 2 y 3',
    ]);
    expect(rows('Taller de Redes páginas 10 a 15 para el lunes')).toEqual([
      'WORKSHOP 2026-11-23 - Redes',
    ]);
    expect(rows('Tarea de Cálculo ejercicios 1-10 para el jueves')).toEqual([
      'TASK 2026-11-19 - Cálculo',
    ]);
    // "tema 3 a las 8 am" is topic 3 at 8, never the hours 3 to 8
    expect(rows('Taller de Redes tema 3 a las 8 am el lunes')).toEqual([
      'WORKSHOP 2026-11-23 08:00 Redes',
    ]);
    expect(read('Taller de Redes tema 3').proposals[0]!.description?.value).toBe('Tema 3');
  });

  it('subjects with no type word, each with its own hour, are one activity each', () => {
    expect(rows('Redes mañana a las 7 am y Cálculo mañana a las 9 am')).toEqual([
      'TASK 2026-11-19 07:00 Redes',
      'TASK 2026-11-19 09:00 Cálculo',
    ]);
    expect(rows('Mañana 7 am clase de Redes y 9 am clase de Cálculo')).toEqual([
      'TASK 2026-11-19 07:00 Redes',
      'TASK 2026-11-19 09:00 Cálculo',
    ]);
  });

  it('"entrega final de todos los proyectos" is one project', () => {
    expect(rows('Entrega final de todos los proyectos el 10 de diciembre')).toEqual([
      'PROJECT 2026-12-10 - -',
    ]);
  });

  it('titles lose "oe", "me acabo de acordar", "recordarme", "sin falta", "lo de" and "aplazado"', () => {
    expect(titles('oe toca entregar lo de redes el viernes sin falta')).toEqual(['Entregar']);
    expect(titles('me acabo de acordar que mañana hay quiz de fisica')).toEqual(['Quiz']);
    expect(titles('recordarme estudiar para el parcial de calculo el viernes')).toEqual([
      'Estudiar parcial',
    ]);
    expect(titles('Quiz de Redes aplazado para el lunes')).toEqual(['Quiz']);
  });

  it('generated: 400 texts of one type word for 2 to 3 subjects and a day, plus a topic with numbers', () => {
    const rand = lcg(5115);
    const types: [string, string, string][] = [
      ['parcial', 'parciales', 'EXAM'],
      ['quiz', 'quices', 'QUIZ'],
      ['taller', 'talleres', 'WORKSHOP'],
      ['proyecto', 'proyectos', 'PROJECT'],
    ];
    const names = ['Redes', 'Cálculo', 'Física', 'Inglés'];
    const days = Object.keys(DAY_DATE);
    for (let n = 0; n < 400; n++) {
      const [one, many, type] = pick(rand, types);
      const count = 2 + Math.floor(rand() * 2);
      const chosen = [...names].sort(() => rand() - 0.5).slice(0, count);
      const day = pick(rand, days);
      const list = `${chosen.slice(0, -1).join(', ')} y ${chosen.at(-1)}`;
      const word = count > 2 && rand() < 0.5 ? many : one;
      const topic =
        rand() < 0.4 ? ` temas ${1 + Math.floor(rand() * 4)} y ${5 + Math.floor(rand() * 4)}` : '';
      const text = `${pick(rand, ['Tengo ', '', 'Hay '])}${word} de ${list}${topic} el ${day}`;
      expect(rows(text), text).toEqual(chosen.map((s) => `${type} ${DAY_DATE[day]} - ${s}`));
    }
  });

  it('a subject typed with a slip is offered as a question and never applied', () => {
    for (const [text, name] of [
      ['Parcial de calclulo el viernes', 'Cálculo'],
      ['Taller de fisca el jueves', 'Física'],
      ['Quiz de redez el lunes', 'Redes'],
    ] as const) {
      const subject = read(text).proposals[0]!.subject;
      expect(subject, text).toMatchObject({ kind: 'UNRESOLVED', reason: 'AMBIGUOUS' });
      expect(subject.kind === 'UNRESOLVED' && subject.candidates.map((c) => c.name), text).toEqual([
        name,
      ]);
    }
    // a different word is not a slip
    expect(read('Parcial de derecho el lunes').proposals[0]!.subject).toMatchObject({
      reason: 'UNKNOWN_NAME',
    });
  });
});
