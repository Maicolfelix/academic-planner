import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

/**
 * PostgreSQL text columns cannot hold a NUL (\u0000): it would surface as a 500 from the database. Every text a student can
 * persist must be refused with a clear 400 BEFORE it reaches the database (never silently cleaned). This walks the writing
 * endpoints with a NUL in each persisted text field.
 */
const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const BAD = 'a\u0000b';
const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };

async function world() {
  const { agent } = await signUp(app, 'ana@example.com');
  const study = (
    await agent.post('/api/study-tracks').send({ name: 'Medicina', type: 'UNIVERSITY' }).expect(201)
  ).body.studyTrack;
  const period = (
    await agent
      .post('/api/periods')
      .send({ ...periodInput, studyTrackId: study.id })
      .expect(201)
  ).body.period;
  const subject = (
    await agent.post('/api/subjects').send({ periodId: period.id, name: 'Redes' }).expect(201)
  ).body.subject;
  const setup = (
    await agent
      .post(`/api/subjects/${subject.id}/grading/setup`)
      .send({
        profile: SCALE,
        gradingPeriods: [
          { name: 'Corte 1', finalShareBp: 5000 },
          { name: 'Corte 2', finalShareBp: 5000 },
        ],
      })
      .expect(201)
  ).body;
  const cut = setup.gradingPeriods[0];
  const activity = (
    await agent
      .post('/api/activities')
      .send({ subjectId: subject.id, title: 'Parcial', dueDate: '2099-03-15' })
      .expect(201)
  ).body.activity;
  const block = (
    await agent
      .post('/api/schedule')
      .send({
        type: 'CLASS',
        subjectId: subject.id,
        title: 'Clase',
        date: '2026-09-07',
        startTime: '08:00',
        endTime: '10:00',
      })
      .expect(201)
  ).body.block;
  const evaluation = (
    await agent
      .post('/api/evaluations')
      .send({
        subjectId: subject.id,
        gradingPeriodId: cut.id,
        name: 'Parcial',
        periodShareBp: 2000,
      })
      .expect(201)
  ).body.evaluation;
  return { agent, study, period, subject, cut, activity, block, evaluation };
}

type W = Awaited<ReturnType<typeof world>>;
type Probe = [label: string, run: (w: W) => request.Test];

const probes: Probe[] = [
  [
    'POST /subjects name',
    (w) => w.agent.post('/api/subjects').send({ periodId: w.period.id, name: BAD }),
  ],
  [
    'POST /subjects professor',
    (w) => w.agent.post('/api/subjects').send({ periodId: w.period.id, name: 'X', professor: BAD }),
  ],
  [
    'POST /subjects description',
    (w) =>
      w.agent.post('/api/subjects').send({ periodId: w.period.id, name: 'X', description: BAD }),
  ],
  [
    'PATCH /subjects name',
    (w) => w.agent.patch(`/api/subjects/${w.subject.id}`).send({ name: BAD }),
  ],
  [
    'PATCH /subjects professor',
    (w) => w.agent.patch(`/api/subjects/${w.subject.id}`).send({ professor: BAD }),
  ],
  [
    'PATCH /subjects description',
    (w) => w.agent.patch(`/api/subjects/${w.subject.id}`).send({ description: BAD }),
  ],
  [
    'POST /subjects/batch',
    (w) => w.agent.post('/api/subjects/batch').send({ periodId: w.period.id, names: ['Ok', BAD] }),
  ],
  ['POST /periods name', (w) => w.agent.post('/api/periods').send({ ...periodInput, name: BAD })],
  [
    'POST /periods studyLevelNote',
    (w) => w.agent.post('/api/periods').send({ ...periodInput, name: 'P', studyLevelNote: BAD }),
  ],
  ['PATCH /periods name', (w) => w.agent.patch(`/api/periods/${w.period.id}`).send({ name: BAD })],
  [
    'PATCH /periods studyLevelNote',
    (w) => w.agent.patch(`/api/periods/${w.period.id}`).send({ studyLevelNote: BAD }),
  ],
  [
    'POST /activities title',
    (w) =>
      w.agent
        .post('/api/activities')
        .send({ subjectId: w.subject.id, title: BAD, dueDate: '2099-03-15' }),
  ],
  [
    'POST /activities description',
    (w) =>
      w.agent
        .post('/api/activities')
        .send({ subjectId: w.subject.id, title: 'T', description: BAD, dueDate: '2099-03-15' }),
  ],
  [
    'PATCH /activities title',
    (w) => w.agent.patch(`/api/activities/${w.activity.id}`).send({ title: BAD }),
  ],
  [
    'PATCH /activities description',
    (w) => w.agent.patch(`/api/activities/${w.activity.id}`).send({ description: BAD }),
  ],
  [
    'POST /schedule title',
    (w) =>
      w.agent.post('/api/schedule').send({
        type: 'CLASS',
        subjectId: w.subject.id,
        title: BAD,
        date: '2026-09-07',
        startTime: '08:00',
        endTime: '10:00',
      }),
  ],
  [
    'PATCH /schedule title',
    (w) => w.agent.patch(`/api/schedule/${w.block.id}`).send({ title: BAD }),
  ],
  [
    'POST /study-tracks name',
    (w) => w.agent.post('/api/study-tracks').send({ name: BAD, type: 'UNIVERSITY' }),
  ],
  [
    'PATCH /study-tracks name',
    (w) => w.agent.patch(`/api/study-tracks/${w.study.id}`).send({ name: BAD }),
  ],
  [
    'POST /study-tracks/setup track name',
    (w) =>
      w.agent.post('/api/study-tracks/setup').send({
        track: { name: BAD, type: 'OTHER_ACADEMIC' },
        period: { name: 'P', startDate: '2026-08-03', endDate: '2026-11-28' },
      }),
  ],
  [
    'POST /study-tracks/setup period name',
    (w) =>
      w.agent.post('/api/study-tracks/setup').send({
        track: { name: 'T', type: 'OTHER_ACADEMIC' },
        period: { name: BAD, startDate: '2026-08-03', endDate: '2026-11-28' },
      }),
  ],
  [
    'POST /study-tracks/setup subject names',
    (w) =>
      w.agent.post('/api/study-tracks/setup').send({
        track: { name: 'T2', type: 'OTHER_ACADEMIC' },
        period: { name: 'P', startDate: '2026-08-03', endDate: '2026-11-28' },
        subjects: [BAD],
      }),
  ],
  ['PATCH /profile programName', (w) => w.agent.patch('/api/profile').send({ programName: BAD })],
  [
    'POST /evaluations name',
    (w) =>
      w.agent.post('/api/evaluations').send({
        subjectId: w.subject.id,
        gradingPeriodId: w.cut.id,
        name: BAD,
        periodShareBp: 1000,
      }),
  ],
  [
    'PATCH /evaluations name',
    (w) => w.agent.patch(`/api/evaluations/${w.evaluation.id}`).send({ name: BAD }),
  ],
  [
    'PATCH /grading-periods name',
    (w) => w.agent.patch(`/api/grading-periods/${w.cut.id}`).send({ name: BAD }),
  ],
  [
    'POST /grading-periods name',
    (w) =>
      w.agent
        .post(`/api/subjects/${w.subject.id}/grading-periods`)
        .send({ name: BAD, finalShareBp: 1000 }),
  ],
  [
    'POST /capture/confirm item title',
    (w) =>
      w.agent.post('/api/capture/confirm').send({
        items: [
          {
            clientId: 'a',
            title: BAD,
            type: 'EXAM',
            dueDate: '2099-03-15',
            subject: { kind: 'NONE' },
          },
        ],
      }),
  ],
  [
    'POST /capture/confirm item description',
    (w) =>
      w.agent.post('/api/capture/confirm').send({
        items: [
          {
            clientId: 'a',
            title: 'T',
            type: 'EXAM',
            dueDate: '2099-03-15',
            description: BAD,
            subject: { kind: 'NONE' },
          },
        ],
      }),
  ],
  [
    'POST /capture/confirm new subject name',
    (w) =>
      w.agent.post('/api/capture/confirm').send({
        items: [
          {
            clientId: 'a',
            title: 'T',
            type: 'EXAM',
            dueDate: '2099-03-15',
            subject: { kind: 'NEW', name: BAD },
          },
        ],
      }),
  ],
  [
    'POST /capture/confirm block title',
    (w) =>
      w.agent.post('/api/capture/confirm').send({
        items: [],
        blocks: [
          {
            clientId: 'b',
            type: 'CLASS',
            title: BAD,
            weekday: 1,
            startTime: '08:00',
            endTime: '10:00',
            subject: { kind: 'EXISTING', subjectId: w.subject.id },
          },
        ],
      }),
  ],
  [
    'POST /capture/confirm evaluation name',
    (w) =>
      w.agent.post('/api/capture/confirm').send({
        evaluations: [
          {
            clientId: 'e',
            action: 'CREATE_EVALUATION',
            subjectId: w.subject.id,
            gradingPeriodId: w.cut.id,
            name: BAD,
            periodShareBp: 1000,
          },
        ],
      }),
  ],
  [
    'POST /schedule-import/confirm class title',
    (w) =>
      w.agent.post('/api/schedule-import/confirm').send({
        classes: [
          {
            clientId: 'a',
            weekday: 1,
            startTime: '08:00',
            endTime: '10:00',
            title: BAD,
            until: '2026-11-28',
            subject: { kind: 'NONE' },
          },
        ],
      }),
  ],
  [
    'POST /schedule-import/confirm new subject name',
    (w) =>
      w.agent.post('/api/schedule-import/confirm').send({
        classes: [
          {
            clientId: 'a',
            weekday: 1,
            startTime: '08:00',
            endTime: '10:00',
            title: 'X',
            until: '2026-11-28',
            subject: { kind: 'NEW', name: BAD },
          },
        ],
      }),
  ],
];

describe('a NUL in any persisted text is a 400 before it reaches PostgreSQL', () => {
  it.each(probes)('%s', async (_label, run) => {
    const w = await world();
    const res = await run(w);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('register: the display name and the email', async () => {
    const name = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({ name: BAD, email: 'n@example.com', password: 'correct horse battery' });
    expect(name.status).toBe(400);
    const email = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({ name: 'N', email: 'a\u0000@example.com', password: 'correct horse battery' });
    expect(email.status).toBe(400);
  });

  it('texts that are only read (parse endpoints) never answer 500', async () => {
    const w = await world();
    for (const path of [
      '/api/capture/parse',
      '/api/quick-capture/parse',
      '/api/academic-inbox/parse',
    ]) {
      const res = await w.agent
        .post(path)
        .send({ text: `Parcial de redes ${BAD} el viernes`, mode: 'QUICK' });
      expect(res.status, path).toBeLessThan(500);
    }
  });
});
