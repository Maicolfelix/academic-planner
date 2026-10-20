import type { Express } from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];
const post = async (a: Agent, path: string, data: object) => {
  const res = await a.post(path).send(data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};
const cal = (...events: string[][]) =>
  Buffer.from(
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', ...events.flat(), 'END:VCALENDAR'].join(
      '\r\n',
    ),
    'utf8',
  );
let n = 0;
const vevent = (...lines: string[]) => ['BEGIN:VEVENT', `UID:u${++n}`, ...lines, 'END:VEVENT'];
const BOG = 'TZID=America/Bogota';
const weeklyClass = (name: string, byday = 'TU', extra: string[] = []) =>
  vevent(
    `SUMMARY:${name}`,
    `DTSTART;${BOG}:20261020T070000`,
    `DTEND;${BOG}:20261020T090000`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byday}`,
    ...extra,
  );
const exam = (name: string) =>
  vevent(`SUMMARY:${name}`, `DTSTART;${BOG}:20261023T100000`, `DTEND;${BOG}:20261023T120000`);
const allDay = (name: string) => vevent(`SUMMARY:${name}`, 'DTSTART;VALUE=DATE:20261030');
const parse = (a: Agent, buffer: Buffer, name = 'calendario.ics') =>
  a.post('/api/ics-import/parse').attach('file', buffer, name);

/** Medicina (HOME): Anatomía · Ciberseguridad.  Diplomado: Ciberseguridad · Inglés. */
async function world(email = 'ana@example.com') {
  const { agent } = await signUp(app, email);
  const mk = async (name: string, type: 'UNIVERSITY' | 'OTHER_ACADEMIC') => {
    const st = (await post(agent, '/api/study-tracks', { name, type })).studyTrack;
    return (
      await post(agent, '/api/periods', { ...periodInput, name: `P ${name}`, studyTrackId: st.id })
    ).period;
  };
  const med = await mk('Medicina', 'UNIVERSITY');
  const dip = await mk('Diplomado', 'OTHER_ACADEMIC');
  const subj = async (periodId: string, name: string) =>
    (await post(agent, '/api/subjects', { periodId, name })).subject as { id: string };
  return {
    agent,
    med,
    dip,
    anatomia: await subj(med.id, 'Anatomía'),
    cyberMed: await subj(med.id, 'Ciberseguridad'),
    cyberDip: await subj(dip.id, 'Ciberseguridad'),
    ingles: await subj(dip.id, 'Inglés'),
  };
}
const counts = async () => ({
  activities: await prisma.activity.count(),
  blocks: await prisma.scheduleBlock.count(),
});

describe('POST /api/ics-import/parse', () => {
  it('requires a session, is no-store and creates nothing', async () => {
    const anon = await request(app)
      .post('/api/ics-import/parse')
      .attach('file', cal(exam('X')), 'a.ics');
    expect(anon.status).toBe(401);
    const w = await world();
    const res = await parse(
      w.agent,
      cal(weeklyClass('Anatomía'), exam('Anatomía - Parcial'), allDay('Entrega final')),
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await counts()).toEqual({ activities: 0, blocks: 0 });
  });

  it('proposes a weekly class as a block, a single event as an activity and an all-day event with no time', async () => {
    const w = await world();
    const { proposals, summary, fileName } = (
      await parse(
        w.agent,
        cal(weeklyClass('Anatomía'), exam('Anatomía - Parcial 1'), allDay('Entrega final')),
      )
    ).body;
    expect(fileName).toBe('calendario.ics');
    expect(proposals.map((p: { kindProposal: string }) => p.kindProposal)).toEqual([
      'SCHEDULE_BLOCK',
      'ACTIVITY',
      'ACTIVITY',
    ]);
    expect(proposals[0]).toMatchObject({
      date: '2026-10-20',
      startTime: '07:00',
      endTime: '09:00',
      repeats: 'WEEKLY',
      subject: { kind: 'EXISTING', id: w.anatomia.id },
    });
    expect(proposals[1]).toMatchObject({ date: '2026-10-23', startTime: '10:00', type: 'EXAM' });
    expect(proposals[2]).toMatchObject({ date: '2026-10-30', startTime: null, allDay: true });
    expect(summary).toMatchObject({ total: 3, activities: 2, scheduleBlocks: 1 });
  });

  it('two studies: a subject of the other study is proposed with ITS id; two equal names are a question between only those two', async () => {
    const w = await world();
    const { proposals, subjects } = (
      await parse(w.agent, cal(exam('Inglés - Quiz'), exam('Ciberseguridad - Parcial')))
    ).body;
    expect(proposals[0].subject).toMatchObject({
      kind: 'EXISTING',
      id: w.ingles.id,
      periodId: w.dip.id,
    });
    expect(proposals[1].subject.kind).toBe('AMBIGUOUS');
    expect(proposals[1].subject.candidates.map((c: { id: string }) => c.id).sort()).toEqual(
      [w.cyberDip.id, w.cyberMed.id].sort(),
    );
    expect(proposals[1]).toMatchObject({ status: 'NEEDS_REVIEW', selected: false });
    expect(subjects.map((s: { studyName: string }) => s.studyName).sort()).toEqual([
      'Diplomado',
      'Diplomado',
      'Medicina',
      'Medicina',
    ]);
  });

  it('a subject that does not exist is not replaced by another and never created', async () => {
    const w = await world();
    const { proposals } = (await parse(w.agent, cal(exam('Farmacología - Parcial')))).body;
    expect(proposals[0].subject).toEqual({ kind: 'NONE' });
    expect(await prisma.subject.count()).toBe(4);
  });

  it('flags what the Agenda already has (an activity and a weekly class) and leaves it unticked', async () => {
    const w = await world();
    await post(w.agent, '/api/activities', {
      subjectId: w.anatomia.id,
      title: 'Anatomía - Parcial 1',
      type: 'EXAM',
      dueDate: '2026-10-23',
      dueTime: '10:00',
    });
    await post(w.agent, '/api/schedule', {
      type: 'CLASS',
      subjectId: w.anatomia.id,
      periodId: w.med.id,
      title: 'Anatomía',
      date: '2026-10-20',
      startTime: '07:00',
      endTime: '09:00',
      recurrence: { frequency: 'WEEKLY', until: '2026-11-24' },
    });
    const { proposals } = (
      await parse(w.agent, cal(weeklyClass('Anatomía'), exam('Anatomía - Parcial 1')))
    ).body;
    for (const p of proposals) {
      expect(p.selected).toBe(false);
      expect(p.duplicateOf).toBe('AGENDA');
    }
  });

  it('refuses an empty file, text that is not a calendar, a NUL, too many events and an oversize file', async () => {
    const w = await world();
    expect((await parse(w.agent, Buffer.alloc(0))).status).toBe(400);
    expect((await parse(w.agent, Buffer.from('hola'))).status).toBe(400);
    expect(
      (
        await parse(
          w.agent,
          Buffer.from('BEGIN:VCALENDAR\r\nSUMMARY:a\u0000b\r\nEND:VCALENDAR\r\n'),
        )
      ).status,
    ).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) =>
      vevent(`SUMMARY:E${i}`, 'DTSTART:20261023T100000'),
    );
    const tooMany = await parse(w.agent, cal(...many));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.details.fields.file[0]).toMatch(/500 eventos/);
    const big = await parse(w.agent, Buffer.alloc(1_048_577, 0x41));
    expect(big.status).toBe(413);
    expect((await w.agent.post('/api/ics-import/parse').send({})).status).toBe(400); // no file
    expect(await counts()).toEqual({ activities: 0, blocks: 0 });
  });

  it('keeps accents and unfolds/unescapes the text', async () => {
    const w = await world();
    const buf = Buffer.from(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:x',
        'SUMMARY:Bioquímica\\, Programación e Inglés',
        'DESCRIPTION:uno\\ndos',
        'DTSTART:20261023T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    const { proposals } = (await parse(w.agent, buf)).body;
    expect(proposals[0].title).toBe('Bioquímica, Programación e Inglés');
    expect(proposals[0].description).toBe('uno\ndos');
  });
});

describe('POST /api/ics-import/confirm', () => {
  const activity = (clientId: string, subjectId: string | null, extra: object = {}) => ({
    clientId,
    kind: 'ACTIVITY',
    title: 'Parcial',
    subjectId,
    date: '2026-10-23',
    startTime: '10:00',
    type: 'EXAM',
    ...extra,
  });
  const block = (clientId: string, subjectId: string | null, extra: object = {}) => ({
    clientId,
    kind: 'BLOCK',
    title: 'Anatomía',
    subjectId,
    date: '2026-10-20',
    startTime: '07:00',
    endTime: '09:00',
    weekly: true,
    ...extra,
  });
  const confirm = (a: Agent, items: object[]) => a.post('/api/ics-import/confirm').send({ items });

  it('creates the activities and the weekly class together, in the period of each subject (two studies)', async () => {
    const w = await world();
    const res = await confirm(w.agent, [
      activity('a', w.anatomia.id),
      activity('b', w.ingles.id, { title: 'Quiz de inglés' }),
      activity('c', null, { title: 'Entrega', startTime: null, date: '2026-10-30' }),
      block('d', w.anatomia.id),
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdActivities).toHaveLength(3);
    expect(res.body.createdBlocks).toHaveLength(1);
    const acts = await prisma.activity.findMany({ orderBy: { createdAt: 'asc' } });
    expect(acts.find((x) => x.subjectId === w.ingles.id)!.periodId).toBe(w.dip.id);
    expect(acts.find((x) => x.subjectId === w.anatomia.id)!.periodId).toBe(w.med.id);
    const blocks = await prisma.scheduleBlock.findMany();
    expect(blocks[0]).toMatchObject({
      periodId: w.med.id,
      subjectId: w.anatomia.id,
      recurrenceType: 'WEEKLY',
    });
    expect(blocks[0]!.recurrenceUntil!.toISOString().slice(0, 10)).toBe('2026-11-28'); // no end in the file → the end of the period
  });

  it('is atomic: one invalid item and NOTHING is created', async () => {
    const w = await world();
    const res = await confirm(w.agent, [
      activity('a', w.anatomia.id),
      block('b', w.anatomia.id, { date: '2027-03-01' }),
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.details.items.map((i: { clientId: string }) => i.clientId)).toEqual([
      'b',
    ]);
    expect(await counts()).toEqual({ activities: 0, blocks: 0 });
  });

  it('a subject of another account is the same refusal as a missing one, and nothing is created', async () => {
    const w = await world();
    const other = await world('b@example.com');
    const forged = await confirm(w.agent, [activity('a', other.anatomia.id)]);
    const missing = await confirm(w.agent, [activity('a', '00000000-0000-4000-8000-0000000000aa')]);
    expect(forged.status).toBe(400);
    expect(forged.body.error.details.items[0].code).toBe('SUBJECT_NOT_FOUND');
    expect(forged.body).toEqual(missing.body);
    expect(await counts()).toEqual({ activities: 0, blocks: 0 });
  });

  it('a class needs a subject; an archived study’s subject is not accepted', async () => {
    const w = await world();
    expect((await confirm(w.agent, [block('a', null)])).status).toBe(400);
    const dip = await prisma.studyTrack.findFirstOrThrow({ where: { name: 'Diplomado' } });
    await w.agent.post(`/api/study-tracks/${dip.id}/archive`).send({}).expect(200);
    const res = await confirm(w.agent, [activity('a', w.ingles.id)]);
    expect(res.status).toBe(400);
    expect(res.body.error.details.items[0].code).toBe('SUBJECT_NOT_FOUND');
  });

  it('an exact copy of an activity is refused unless the student insists; a class already in the agenda is reused', async () => {
    const w = await world();
    await confirm(w.agent, [activity('a', w.anatomia.id), block('b', w.anatomia.id)]).expect(201);
    const again = await confirm(w.agent, [activity('a', w.anatomia.id)]);
    expect(again.status).toBe(400);
    expect(again.body.error.details.items[0].code).toBe('DUPLICATE_ACTIVITY');
    expect(
      (await confirm(w.agent, [activity('a', w.anatomia.id, { allowDuplicate: true })])).status,
    ).toBe(201);
    const reuse = await confirm(w.agent, [block('b', w.anatomia.id)]);
    expect(reuse.status).toBe(201);
    expect(reuse.body.reusedBlocks).toHaveLength(1);
    expect(await prisma.scheduleBlock.count()).toBe(1);
  });

  it('a NUL in a title, an unknown field (user, period) and a repeated clientId are refused', async () => {
    const w = await world();
    expect(
      (await confirm(w.agent, [activity('a', w.anatomia.id, { title: 'a\u0000b' })])).status,
    ).toBe(400);
    expect(
      (await confirm(w.agent, [activity('a', w.anatomia.id, { userId: w.anatomia.id })])).status,
    ).toBe(400);
    expect(
      (await confirm(w.agent, [activity('a', w.anatomia.id, { periodId: w.med.id })])).status,
    ).toBe(400);
    expect(
      (await confirm(w.agent, [activity('a', w.anatomia.id), activity('a', w.anatomia.id)])).status,
    ).toBe(400);
    expect(await counts()).toEqual({ activities: 0, blocks: 0 });
  });

  it('two confirmations at once create it once', async () => {
    const w = await world();
    const results = await Promise.all([
      confirm(w.agent, [activity('a', w.anatomia.id)]),
      confirm(w.agent, [activity('a', w.anatomia.id)]),
      confirm(w.agent, [activity('a', w.anatomia.id)]),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await counts()).activities).toBe(1);
  });

  it('requires a session', async () => {
    expect((await request(app).post('/api/ics-import/confirm').send({ items: [] })).status).toBe(
      401,
    );
  });
});
