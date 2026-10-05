import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_INBOX_MAX_LENGTH,
  ACADEMIC_INBOX_MAX_PROPOSALS,
  ACADEMIC_INBOX_MESSAGES,
  academicInboxRequestSchema,
  academicInboxResultSchema,
  extractAcademicCandidates,
  markPossibleDuplicates,
  parseAcademicInbox,
  parseQuickCapture,
  splitSentences,
  titlesAreRelated,
  type AcademicInboxProposal,
  type AcademicInboxResult,
  type QuickCaptureContext,
} from './index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REDES = { id: uuid(1), name: 'Redes' };
const BASES = { id: uuid(2), name: 'Bases de Datos' };
const PROG1 = { id: uuid(3), name: 'Programación I' };
const PROG2 = { id: uuid(4), name: 'Programación II' };
const SUBJECTS = [REDES, BASES];

const MONDAY = new Date('2026-10-05T17:00:00.000Z'); // Monday 5 Oct 2026, 12:00 in Bogotá
const TUESDAY_3PM = new Date('2026-10-06T20:00:00.000Z');
const PERIOD = { startDate: '2026-08-03', endDate: '2026-11-28' };

const ctx = (over: Partial<QuickCaptureContext> = {}): QuickCaptureContext => ({
  now: MONDAY,
  timeZone: 'America/Bogota',
  subjects: SUBJECTS,
  period: PERIOD,
  ...over,
});
/** Parses and checks the result is a valid, serialisable one. */
const inbox = (text: string, over: Partial<QuickCaptureContext> = {}): AcademicInboxResult => {
  const result = parseAcademicInbox(text, ctx(over));
  expect(academicInboxResultSchema.safeParse(result).success, text).toBe(true);
  return result;
};
const brief = (r: AcademicInboxResult) =>
  r.proposals.map((p) => [p.type, p.title, p.subjectId, p.dueDate, p.dueTime] as const);
const codes = (p: AcademicInboxProposal) => p.warnings.map((w) => w.code);

describe('splitSentences', () => {
  it('splits on periods, line breaks, semicolons, question and exclamation marks', () => {
    expect(splitSentences('Uno. Dos. Tres.')).toEqual(['Uno.', 'Dos.', 'Tres.']);
    expect(splitSentences('Primera línea\nSegunda línea\r\nTercera')).toEqual([
      'Primera línea',
      'Segunda línea',
      'Tercera',
    ]);
    expect(splitSentences('Parcial el martes; taller el viernes')).toEqual([
      'Parcial el martes;',
      'taller el viernes',
    ]);
    expect(splitSentences('¿Listos? Sí. ¡Perfecto! Vamos')).toEqual([
      '¿Listos?',
      'Sí.',
      '¡Perfecto!',
      'Vamos',
    ]);
  });

  it('"a. m." and "p. m." do not break a sentence', () => {
    expect(splitSentences('El parcial es a las 10:00 a. m. en el salón 3')).toEqual([
      'El parcial es a las 10:00 a. m. en el salón 3',
    ]);
    expect(splitSentences('Nos vemos a las 2 p. m. en el laboratorio')).toHaveLength(1);
    expect(splitSentences('Es a las 10 a.m. en el salón')).toHaveLength(1);
    expect(splitSentences('Es a las 10 a.m. del martes. Después hay taller')).toHaveLength(2);
  });

  it('but a sentence that ends right after "a. m." and a capital does end', () => {
    expect(
      splitSentences('El parcial es a las 10:00 a. m. Además, el viernes hay taller.'),
    ).toEqual(['El parcial es a las 10:00 a. m.', 'Además, el viernes hay taller.']);
  });

  it('abbreviations, initials, decimals and list numbers are not sentence ends', () => {
    expect(splitSentences('Habla con el Prof. Pérez sobre el parcial')).toHaveLength(1);
    expect(splitSentences('La nota vale 4.5 puntos en total')).toHaveLength(1);
    expect(splitSentences('El Dr. A. Gómez y la Sra. Ruiz asisten')).toHaveLength(1);
    expect(splitSentences('1. Parcial de Redes\n2. Taller de Bases')).toEqual([
      '1. Parcial de Redes',
      '2. Taller de Bases',
    ]);
    expect(splitSentences('Llevar lápices, etc. y calculadora')).toHaveLength(1);
  });

  it('ignores empty pieces and never throws', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n\n  ')).toEqual([]);
    expect(splitSentences('....')).toBeDefined();
    expect(splitSentences('.'.repeat(500)).length).toBeLessThanOrEqual(500);
  });
});

describe('extractAcademicCandidates', () => {
  const extract = (text: string) => extractAcademicCandidates(text, { subjects: SUBJECTS });

  it('a greeting or a thank-you has no candidates', () => {
    expect(extract('Buenas tardes estudiantes. Gracias por su atención.').candidates).toEqual([]);
    expect(extract('Hablaremos del tema la próxima clase.').candidates).toEqual([]);
  });

  it('one candidate per activity word, in order', () => {
    const { candidates } = extract('El martes tendremos parcial. El viernes entregamos el taller.');
    expect(candidates.map((c) => c.sentenceIndex)).toEqual([0, 1]);
    expect(candidates.map((c) => c.rawSegment)).toEqual([
      'El martes tendremos parcial.',
      'El viernes entregamos el taller.',
    ]);
  });

  it('two activities in one sentence are cut at the conjunction', () => {
    const { candidates } = extract(
      'El martes tendremos parcial de Redes y el viernes entregamos el taller.',
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.rawSegment).toBe('El martes tendremos parcial de Redes');
    expect(candidates[1]!.rawSegment).toBe('el viernes entregamos el taller.');
  });

  it('a comma also separates them, and with neither the cut goes right before the second activity', () => {
    expect(
      extract('Parcial de Redes el martes, taller de Bases el viernes').candidates,
    ).toHaveLength(2);
    const bare = extract('parcial redes martes taller bases viernes').candidates;
    expect(bare.map((c) => c.text)).toEqual(['parcial redes martes', 'taller bases viernes']);
  });

  it('what a sentence says before its first activity is shared by the others', () => {
    const { candidates } = extract('El martes a las 10 tendremos parcial y exposición.');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.sharedText).toBe('');
    expect(candidates[1]!.sharedText).toBe('El martes a las 10 tendremos');
  });

  it('a type word inside a subject name is not an activity', () => {
    const subjects = [{ id: uuid(9), name: 'Taller de Redes' }];
    const { candidates } = extractAcademicCandidates(
      'El martes tendremos parcial de Taller de Redes.',
      { subjects },
    );
    expect(candidates).toHaveLength(1);
  });

  it('"presentación del proyecto" is one activity, not two', () => {
    expect(extract('La presentación del proyecto es el jueves.').candidates).toHaveLength(1);
    expect(extract('Entrega del taller de lectura el viernes.').candidates).toHaveLength(1);
  });

  it('wording without a type word can still be an activity ("entregar informe")', () => {
    const [c] = extract('Deben entregar el informe el viernes.').candidates;
    expect(c!.implicitType).toBe('TASK');
    const [r] = extract('Deben leer el capítulo 3 para el lunes.').candidates;
    expect(r!.implicitType).toBe('READING');
    // But not any noun.
    expect(extract('Deben entregar el café el viernes.').candidates).toEqual([]);
    expect(extract('Hablaremos del informe en clase.').candidates).toEqual([]);
  });

  it('counts the sentences', () => {
    expect(extract('Uno. Dos. Tres.').sentences).toBe(3);
  });
});

describe('the examples of the brief', () => {
  it('a full message: an exam with an ordinal, a date and a time, then a workshop with no subject', () => {
    const r = inbox(
      'Buenas tardes estudiantes. Les recuerdo que el próximo martes 13 de octubre tendremos el primer parcial de Redes a las 10:00 a. m. Además, el viernes deben entregar el taller 2.',
    );
    expect(r.status).toBe('OK');
    expect(brief(r)).toEqual([
      ['EXAM', 'Parcial 1', REDES.id, '2026-10-13', '10:00'],
      ['WORKSHOP', 'Taller 2', null, '2026-10-09', null],
    ]);
    expect(r.proposals.map((p) => p.status)).toEqual(['COMPLETE', 'INCOMPLETE']);
    expect(r.proposals[1]!.missingFields).toEqual(['subject']);
    expect(codes(r.proposals[1]!)).toContain('MISSING_SUBJECT');
    expect(r.proposals[0]!.rawSegment).toContain('primer parcial de Redes');
    expect(r.proposals[1]!.rawSegment).toBe('el viernes deben entregar el taller 2.');
  });

  it('the exam and workshop of the e2e flow', () => {
    const r = inbox(
      'El martes tendremos parcial de Redes a las 10am y el viernes debemos entregar el taller de Bases.',
    );
    expect(brief(r)).toEqual([
      ['EXAM', 'Parcial', REDES.id, '2026-10-06', '10:00'],
      ['WORKSHOP', 'Taller', BASES.id, '2026-10-09', null],
    ]);
    expect(r.proposals.map((p) => p.status)).toEqual(['COMPLETE', 'COMPLETE']);
  });

  it('"Entregar taller el viernes." is a useful partial proposal, not an error', () => {
    const r = inbox('Entregar taller el viernes.');
    expect(brief(r)).toEqual([['WORKSHOP', 'Taller', null, '2026-10-09', null]]);
    expect(r.proposals[0]!.status).toBe('INCOMPLETE');
    expect(r.proposals[0]!.recognizedFields).toEqual(['type', 'date']);
  });

  it('"Buenas tardes. Gracias." gives nothing', () => {
    const r = inbox('Buenas tardes. Gracias.');
    expect(r.status).toBe('OK');
    expect(r.proposals).toEqual([]);
    expect(ACADEMIC_INBOX_MESSAGES.NO_ACTIVITIES).toBe(
      'No encontramos actividades claras en este mensaje.',
    );
  });
});

describe('subject context', () => {
  it('a subject named before the activities applies to all of them in that sentence', () => {
    const r = inbox('En Redes tendremos parcial el martes y entregaremos el taller el viernes.');
    expect(brief(r)).toEqual([
      ['EXAM', 'Parcial', REDES.id, '2026-10-06', null],
      ['WORKSHOP', 'Taller', REDES.id, '2026-10-09', null],
    ]);
    expect(codes(r.proposals[0]!)).not.toContain('SUBJECT_INHERITED');
    expect(codes(r.proposals[1]!)).toContain('SUBJECT_INHERITED'); // said, so the student can verify it
    expect(r.proposals[1]!.certainty.subject).toBe('LIKELY');
  });

  it('each sentence keeps its own subject: Redes is not spread over the whole message', () => {
    const r = inbox(
      'En Redes tendremos parcial el martes. En Bases de Datos entregaremos proyecto el viernes.',
    );
    expect(brief(r)).toEqual([
      ['EXAM', 'Parcial', REDES.id, '2026-10-06', null],
      ['PROJECT', 'Proyecto', BASES.id, '2026-10-09', null],
    ]);
  });

  it('"Redes parcial martes. Bases proyecto viernes." also gives each its own', () => {
    const r = inbox('Redes parcial martes. Bases proyecto viernes.');
    expect(r.proposals.map((p) => p.subjectId)).toEqual([REDES.id, BASES.id]);
  });

  it('a subject is NOT inherited across sentences, even if only one is mentioned in the message', () => {
    const r = inbox('En Redes tendremos parcial el martes. El taller se entrega el viernes.');
    expect(r.proposals.map((p) => p.subjectId)).toEqual([REDES.id, null]);
    expect(r.proposals[1]!.certainty.subject).toBe('MISSING');
  });

  it('a subject written inside an activity belongs to that activity only', () => {
    const r = inbox('El martes parcial de Redes y quiz de Bases.');
    expect(r.proposals.map((p) => p.subjectId)).toEqual([REDES.id, BASES.id]);
  });

  it('an own subject beats the shared one', () => {
    const r = inbox('En Redes tendremos parcial el martes y quiz de Bases el viernes.');
    expect(r.proposals.map((p) => p.subjectId)).toEqual([REDES.id, BASES.id]);
  });

  it('an ambiguous subject is not chosen: the candidates are offered', () => {
    const r = inbox('El martes tendremos parcial de Programación.', {
      subjects: [REDES, PROG1, PROG2],
    });
    const [p] = r.proposals;
    expect(p!.subjectId).toBeNull();
    expect(p!.certainty.subject).toBe('AMBIGUOUS');
    expect(p!.ambiguities[0]!.candidates.map((c) => c.name)).toEqual([
      'Programación I',
      'Programación II',
    ]);
    expect(p!.status).toBe('INCOMPLETE');
    expect(
      inbox('El martes parcial de Programación II.', { subjects: [PROG1, PROG2] }).proposals[0]!
        .subjectId,
    ).toBe(PROG2.id);
  });

  it('a subject that is not the user’s is never matched', () => {
    const r = inbox('El martes tendremos parcial de Redes.', { subjects: [BASES] });
    expect(r.proposals[0]!.subjectId).toBeNull();
    expect(
      inbox('El martes tendremos parcial de Redes.', { subjects: [] }).proposals[0]!.subjectId,
    ).toBeNull();
  });
});

describe('dates and times of each activity', () => {
  it('each activity gets its own date', () => {
    const r = inbox(
      'Parcial de Redes el martes, taller de Bases el viernes y quiz de Redes el 15/10.',
    );
    expect(r.proposals.map((p) => p.dueDate)).toEqual(['2026-10-06', '2026-10-09', '2026-10-15']);
  });

  it('a date said before the activities is shared (two proposals, same date)', () => {
    const r = inbox('El martes parcial de Redes y quiz de Bases.');
    expect(r.proposals.map((p) => p.dueDate)).toEqual(['2026-10-06', '2026-10-06']);
  });

  it('a date written inside one activity is not given to the next', () => {
    const r = inbox('Parcial de Redes el martes y quiz de Bases.');
    expect(r.proposals.map((p) => p.dueDate)).toEqual(['2026-10-06', null]);
    expect(r.proposals[1]!.missingFields).toContain('date');
  });

  it('a time said before the activities is shared; one inside an activity is not', () => {
    const shared = inbox('El martes a las 10am tendremos parcial de Redes y quiz de Bases.');
    expect(shared.proposals.map((p) => p.dueTime)).toEqual(['10:00', '10:00']);
    const own = inbox('El martes tendremos parcial de Redes a las 10am y quiz de Bases.');
    expect(own.proposals.map((p) => p.dueTime)).toEqual(['10:00', null]);
  });

  it('an own date or time wins over the shared one, silently', () => {
    const r = inbox(
      'El martes a las 10am tendremos parcial de Redes y quiz de Bases el viernes a las 2pm.',
    );
    expect(brief(r)).toEqual([
      ['EXAM', 'Parcial', REDES.id, '2026-10-06', '10:00'],
      ['QUIZ', 'Quiz', BASES.id, '2026-10-09', '14:00'],
    ]);
    expect(codes(r.proposals[1]!)).not.toContain('MULTIPLE_ACTIVITIES');
  });

  it('an hour without am/pm ("a las 10") is read and marked LIKELY', () => {
    const r = inbox('El martes a las 10 tendremos parcial y exposición.');
    expect(r.proposals.map((p) => [p.type, p.dueTime, p.certainty.time])).toEqual([
      ['EXAM', '10:00', 'LIKELY'],
      ['PRESENTATION', '10:00', 'LIKELY'],
    ]);
    expect(parseQuickCapture('parcial redes viernes a las 2', ctx()).dueTime).toBe('14:00');
    expect(parseQuickCapture('parcial redes viernes a las 14', ctx()).dueTime).toBe('14:00');
    expect(parseQuickCapture('parcial redes viernes a las 10am', ctx()).certainty.time).toBe(
      'EXACT',
    );
  });

  it('a date without a year is resolved with now and flagged when it leaves the period', () => {
    const inside = inbox('El parcial de Redes es el 15/10.');
    expect(inside.proposals[0]!.dueDate).toBe('2026-10-15');
    const outside = inbox('El parcial de Redes es el 15/12.');
    expect(outside.proposals[0]!.dueDate).toBe('2026-12-15');
    expect(codes(outside.proposals[0]!)).toContain('DATE_OUTSIDE_PERIOD');
  });

  it('weekday names: "este" includes today, "próximo" means the next one after today', () => {
    const today = { now: TUESDAY_3PM };
    expect(inbox('Este martes tenemos parcial de Redes.', today).proposals[0]!.dueDate).toBe(
      '2026-10-06',
    );
    expect(inbox('El próximo martes tenemos parcial de Redes.', today).proposals[0]!.dueDate).toBe(
      '2026-10-13',
    );
    expect(inbox('El martes tenemos parcial de Redes.', today).proposals[0]!.dueDate).toBe(
      '2026-10-06',
    );
    expect(inbox('El próximo martes tenemos parcial de Redes.').proposals[0]!.dueDate).toBe(
      '2026-10-06',
    ); // from a Monday
    expect(inbox('Para el lunes deben entregar el taller de Bases.').proposals[0]!.dueDate).toBe(
      '2026-10-05',
    );
  });

  it('a weekday written next to a date only qualifies it: the date wins and a mismatch is reported', () => {
    const ok = inbox('El próximo martes 13 de octubre tendremos parcial de Redes.');
    expect(ok.proposals[0]!.dueDate).toBe('2026-10-13');
    expect(codes(ok.proposals[0]!)).not.toContain('WEEKDAY_MISMATCH');
    expect(codes(ok.proposals[0]!)).not.toContain('MULTIPLE_ACTIVITIES');
    const wrong = inbox('El martes 14 de octubre tendremos parcial de Redes.');
    expect(wrong.proposals[0]!.dueDate).toBe('2026-10-14');
    expect(codes(wrong.proposals[0]!)).toContain('WEEKDAY_MISMATCH');
  });

  it('the same rule in quick capture', () => {
    expect(parseQuickCapture('parcial redes martes 13/10', ctx()).dueDate).toBe('2026-10-13');
    expect(
      parseQuickCapture('parcial redes martes 14/10', ctx()).warnings.map((w) => w.code),
    ).toContain('WEEKDAY_MISMATCH');
    expect(
      parseQuickCapture('parcial redes próximo martes', { ...ctx(), now: TUESDAY_3PM }).dueDate,
    ).toBe('2026-10-13');
    expect(
      parseQuickCapture('parcial redes este martes', { ...ctx(), now: TUESDAY_3PM }).dueDate,
    ).toBe('2026-10-06');
  });

  it('uses the user’s timezone', () => {
    const now = new Date('2026-10-06T03:00:00.000Z'); // Mon 22:00 Bogotá = Tue 12:00 Tokyo
    expect(
      inbox('Hoy tenemos parcial de Redes.', { now, timeZone: 'America/Bogota' }).proposals[0]!
        .dueDate,
    ).toBe('2026-10-05');
    expect(
      inbox('Hoy tenemos parcial de Redes.', { now, timeZone: 'Asia/Tokyo' }).proposals[0]!.dueDate,
    ).toBe('2026-10-06');
  });
});

describe('titles', () => {
  it.each([
    ['El primer parcial de Redes es el martes.', 'Parcial 1'],
    ['El segundo parcial de Redes es el martes.', 'Parcial 2'],
    ['Parcial 2 de Redes el martes.', 'Parcial 2'],
    ['El tercer quiz de Bases es el viernes.', 'Quiz 3'],
    ['Deben entregar el taller 3 el viernes.', 'Taller 3'],
    ['Tendremos la presentación del proyecto el jueves.', 'Exposición proyecto'],
    ['Deben entregar el informe de laboratorio el viernes.', 'Informe de laboratorio'],
  ])('%s -> %s', (text, title) => {
    expect(inbox(text).proposals[0]!.title).toBe(title);
  });

  it('chatter is not part of the title', () => {
    const [p] = inbox(
      'Buenas tardes estudiantes, les recuerdo que el martes tendremos el parcial de Redes.',
    ).proposals;
    expect(p!.title).toBe('Parcial');
  });

  it('wording-based types are marked LIKELY and keep the object as the title', () => {
    const [p] = inbox('Deben entregar el informe el viernes.').proposals;
    expect(p).toMatchObject({ type: 'TASK', title: 'Informe', dueDate: '2026-10-09' });
    expect(p!.certainty.type).toBe('LIKELY');
    expect(inbox('Deben leer el capítulo 3 para el lunes.').proposals[0]).toMatchObject({
      type: 'READING',
      dueDate: '2026-10-05',
    });
  });
});

describe('what is NOT an activity', () => {
  it.each([
    'Buenas tardes estudiantes, espero que estén bien.',
    'Gracias por su atención.',
    'Hablaremos del tema en la próxima clase.',
    'Les recuerdo que el parcial es importante.',
    'El examen fue muy difícil para muchos.',
    'Cualquier duda me escriben.',
  ])('%s', (text) => {
    expect(inbox(text).proposals).toEqual([]);
  });

  it('a type word needs something to stand on: a date, a time, a subject or a "must be handed in" wording', () => {
    expect(inbox('El parcial.').proposals).toEqual([]);
    expect(inbox('Tendremos parcial.').proposals).toHaveLength(1); // "tendremos" says it will happen
    expect(inbox('El parcial de Redes.').proposals).toHaveLength(1); // a subject
    expect(inbox('El parcial el 20/10.').proposals).toHaveLength(1); // a date
  });
});

describe('several proposals', () => {
  it('two activities in two sentences', () => {
    const r = inbox('Parcial de Redes el martes. Taller de Bases el viernes.');
    expect(r.proposals.map((p) => p.type)).toEqual(['EXAM', 'WORKSHOP']);
    expect(r.proposals.map((p) => p.index)).toEqual([0, 1]);
  });

  it('works with line breaks and bullets', () => {
    const r = inbox(
      'Buenas tardes:\n- Parcial de Redes el martes a las 10am\n- Taller de Bases el viernes\n\nSaludos',
    );
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals[0]!.dueTime).toBe('10:00');
    const numbered = inbox('1. Parcial de Redes el martes\n2. Taller de Bases el viernes');
    expect(numbered.proposals).toHaveLength(2);
  });

  it('a greeting before and after changes nothing', () => {
    const plain = inbox('Parcial de Redes el martes.');
    const wrapped = inbox(
      'Buenas tardes estudiantes. Parcial de Redes el martes. Gracias y feliz tarde.',
    );
    expect(brief(wrapped)).toEqual(brief(plain));
  });

  it('the same reminder repeated is one proposal', () => {
    const r = inbox('Parcial de Redes el martes. Recuerden: el parcial de Redes es el martes.');
    expect(r.proposals).toHaveLength(1);
    expect(r.stats.candidates).toBe(2);
  });

  it('is limited to 10 proposals and says so', () => {
    const text = Array.from(
      { length: 12 },
      (_, i) => `Parcial de Redes el ${String(6 + i).padStart(2, '0')}/10.`,
    ).join('\n');
    const r = inbox(text);
    expect(r.proposals).toHaveLength(ACADEMIC_INBOX_MAX_PROPOSALS);
    expect(r.warnings.map((w) => w.code)).toEqual(['TOO_MANY_PROPOSALS']);
    expect(r.warnings[0]!.message).toContain('10');
    expect(r.stats.candidates).toBe(12);
    expect(r.proposals.at(-1)!.dueDate).toBe('2026-10-15'); // the first ten, in order
    // Exactly ten is fine.
    const ten = inbox(text.split('\n').slice(0, 10).join('\n'));
    expect(ten.proposals).toHaveLength(10);
    expect(ten.warnings).toEqual([]);
  });

  it('a proposal can be COMPLETE or INCOMPLETE, and keeps what it understood', () => {
    const r = inbox('El martes parcial de Redes. Entregar taller. Quiz de Bases.');
    expect(r.proposals.map((p) => p.status)).toEqual(['COMPLETE', 'INCOMPLETE', 'INCOMPLETE']);
    expect(r.proposals[2]!.recognizedFields).toEqual(['type', 'subject']);
  });
});

describe('input limits', () => {
  it('empty text is EMPTY', () => {
    for (const text of ['', '   ', '\n\t\n']) {
      const r = inbox(text);
      expect(r.status).toBe('EMPTY');
      expect(r.warnings.map((w) => w.code)).toEqual(['EMPTY']);
    }
  });

  it('5000 characters is allowed, 5001 is rejected', () => {
    expect(ACADEMIC_INBOX_MAX_LENGTH).toBe(5000);
    const filler = ' x'.repeat(2500);
    const ok = inbox(`Parcial de Redes el martes.${filler}`.slice(0, 5000));
    expect(ok.status).toBe('OK');
    const tooLong = inbox(`Parcial de Redes el martes.${filler}`.slice(0, 5001));
    expect(tooLong.status).toBe('TOO_LONG');
    expect(tooLong.proposals).toEqual([]);
    expect(tooLong.warnings[0]!.message).toBe(
      'El texto es demasiado largo. Pega únicamente el mensaje académico relevante.',
    );
  });

  it('the padding of the text does not count', () => {
    expect(inbox(`   ${'a'.repeat(4990)}   `).status).toBe('OK');
  });
});

describe('robustness', () => {
  const weird = [
    '',
    ' ',
    '.',
    '....',
    '!!!!',
    '????',
    ';;;;',
    ',,,,',
    '- - - -',
    '———',
    '1. 2. 3. 4.',
    'a. m. a. m. a. m.',
    'x'.repeat(5000),
    'x '.repeat(2500),
    'a.'.repeat(2500),
    '. '.repeat(2500),
    '/'.repeat(5000),
    ':'.repeat(5000),
    'parcial '.repeat(600),
    'y '.repeat(2000),
    'martes '.repeat(600),
    'a las 10 '.repeat(500),
    'Parcial de Redes el martes. '.repeat(100),
    'taller y '.repeat(500),
    '10/10 '.repeat(800),
    '😀 parcial 😀 redes 😀 martes 😀',
    'ééé parcial',
    'ÁÉÍÓÚ ÑÜ parcial',
    'parcial\u0000redes\u0000martes',
    '\n'.repeat(500),
    '\r\n'.repeat(500),
    'parcial\nredes\nmartes\n'.repeat(100),
    '-----\n-----\n-----',
    'Parcial 1/1/1/1 99/99/9999 25:00 14:90 0pm',
    'octubre octubre octubre '.repeat(300),
    'primer primer primer parcial',
    'presentación del proyecto de la lectura del taller del examen del quiz',
  ];

  it('never throws and always returns a valid result', () => {
    for (const text of weird) {
      const r = inbox(text.slice(0, 5000));
      expect(['OK', 'EMPTY', 'TOO_LONG']).toContain(r.status);
      expect(r.proposals.length).toBeLessThanOrEqual(ACADEMIC_INBOX_MAX_PROPOSALS);
    }
    for (const text of weird) {
      expect(() =>
        parseAcademicInbox(text, ctx({ subjects: [], period: null, timeZone: 'Asia/Tokyo' })),
      ).not.toThrow();
    }
  });

  it('is deterministic', () => {
    for (const text of weird) {
      expect(parseAcademicInbox(text, ctx())).toEqual(parseAcademicInbox(text, ctx()));
    }
  });

  it('is fast with the longest text, 50 subjects and many activities (no catastrophic backtracking)', () => {
    const subjects = Array.from({ length: 50 }, (_, i) => ({
      id: uuid(100 + i),
      name: `Asignatura número ${i} de ingeniería`,
    }));
    const long = Array.from(
      { length: 80 },
      (_, i) =>
        `En Asignatura número ${i % 50} tendremos parcial el martes y entregaremos el taller el viernes a las 10am.`,
    )
      .join(' ')
      .slice(0, 5000);
    const started = Date.now();
    const r = parseAcademicInbox(long, ctx({ subjects }));
    for (const text of [
      'parcial '.repeat(600).slice(0, 5000),
      'y '.repeat(2500),
      'a.'.repeat(2500),
      '/'.repeat(5000),
    ]) {
      parseAcademicInbox(text, ctx({ subjects }));
    }
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.proposals).toHaveLength(ACADEMIC_INBOX_MAX_PROPOSALS);
  });

  it('treats the text as text only', () => {
    const r = inbox(
      'El martes tendremos parcial de Redes <script>alert(1)</script> ${process.exit(1)} $(rm -rf /)',
    );
    expect(r.status).toBe('OK');
    expect(r.proposals[0]!.type).toBe('EXAM');
  });
});

describe('possible duplicates', () => {
  const proposal = (over: Partial<AcademicInboxProposal> = {}): AcademicInboxProposal => ({
    index: 0,
    rawSegment: 'x',
    status: 'COMPLETE',
    title: 'Parcial 1',
    type: 'EXAM',
    subjectId: REDES.id,
    dueDate: '2026-10-13',
    dueTime: '10:00',
    hasTime: true,
    certainty: { type: 'EXACT', subject: 'EXACT', date: 'EXACT', time: 'EXACT' },
    recognizedFields: ['type', 'subject', 'date', 'time'],
    missingFields: [],
    ambiguities: [],
    warnings: [],
    duplicateOf: null,
    ...over,
  });
  const existing = (over = {}) => ({
    id: uuid(50),
    title: 'Parcial 1',
    type: 'EXAM' as const,
    subjectId: REDES.id,
    dueAt: new Date('2026-10-13T15:00:00.000Z'),
    ...over,
  });
  const mark = (p: AcademicInboxProposal, ...others: ReturnType<typeof existing>[]) =>
    markPossibleDuplicates([p], others, 'America/Bogota')[0]!;

  it('flags the same subject, day, type and title', () => {
    const marked = mark(proposal(), existing());
    expect(marked.duplicateOf).toEqual({ id: uuid(50), title: 'Parcial 1' });
    expect(codes(marked)).toEqual(['POSSIBLE_DUPLICATE']);
    expect(marked.warnings[0]!.message).toBe('Ya existe una actividad similar.');
  });

  it('only warns: the proposal keeps everything else', () => {
    const marked = mark(proposal(), existing());
    expect({ ...marked, duplicateOf: null, warnings: [] }).toEqual(proposal());
  });

  it.each([
    ['another subject', { subjectId: BASES.id }],
    ['another day', { dueAt: new Date('2026-10-14T15:00:00.000Z') }],
    ['another type', { type: 'QUIZ' as const }],
    ['another numbered title', { title: 'Parcial 2' }],
    ['an unrelated title', { title: 'Taller de capas' }],
  ])('%s is not a duplicate', (_label, over) => {
    expect(mark(proposal(), existing(over)).duplicateOf).toBeNull();
  });

  it('a shorter or longer version of the title is related ("Parcial" / "Parcial 1")', () => {
    expect(mark(proposal({ title: 'Parcial' }), existing()).duplicateOf).not.toBeNull();
    expect(mark(proposal({ title: 'Parcial 1 de capas' }), existing()).duplicateOf).not.toBeNull();
  });

  it('is compared on the user’s local day, not on UTC', () => {
    // 23:30 in Bogotá on the 13th is already the 14th in UTC.
    const lateExisting = existing({ dueAt: new Date('2026-10-14T04:30:00.000Z') });
    expect(
      mark(proposal({ dueTime: null, hasTime: false }), lateExisting).duplicateOf,
    ).not.toBeNull();
    expect(
      markPossibleDuplicates([proposal()], [lateExisting], 'Asia/Tokyo')[0]!.duplicateOf,
    ).toBeNull();
  });

  it('proposals without a subject or a date can not be duplicates', () => {
    expect(mark(proposal({ subjectId: null }), existing()).duplicateOf).toBeNull();
    expect(mark(proposal({ dueDate: null }), existing()).duplicateOf).toBeNull();
  });

  it('titlesAreRelated', () => {
    expect(titlesAreRelated('Parcial 1', 'parcial 1')).toBe(true);
    expect(titlesAreRelated('Parcial', 'Parcial 1')).toBe(true);
    expect(titlesAreRelated('Parcial 1', 'Parcial 2')).toBe(false);
    expect(titlesAreRelated('Exposición', 'Exposicion')).toBe(true);
    expect(titlesAreRelated('', 'Parcial')).toBe(false);
  });
});

describe('request schema', () => {
  it('accepts only { text }', () => {
    expect(academicInboxRequestSchema.safeParse({ text: 'hola' }).success).toBe(true);
    expect(academicInboxRequestSchema.safeParse({ text: '' }).success).toBe(true); // the parser answers EMPTY
    expect(academicInboxRequestSchema.safeParse({}).success).toBe(false);
    expect(academicInboxRequestSchema.safeParse({ text: 5 }).success).toBe(false);
    expect(academicInboxRequestSchema.safeParse({ text: 'x', userId: uuid(1) }).success).toBe(
      false,
    );
    expect(academicInboxRequestSchema.safeParse({ text: 'x', subjects: [] }).success).toBe(false);
    expect(academicInboxRequestSchema.safeParse({ text: 'x'.repeat(20_001) }).success).toBe(false);
    expect(academicInboxRequestSchema.safeParse({ text: 'x'.repeat(20_000) }).success).toBe(true);
  });
});
