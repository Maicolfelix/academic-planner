import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApp,
  periodInput,
  postActivity,
  prisma,
  resetDb,
  setupUser,
} from '../../test/helpers.js';

/**
 * Ownership, as ONE matrix over every resource: user A attacks the ids, foreign keys and aggregates of user B.
 * The assertions are the strong ones:
 *  - a foreign id answers EXACTLY like an id that does not exist (same status, same body): no oracle;
 *  - nothing in the database changed after the whole attack (rows compared before and after);
 *  - nothing of B (ids, titles, names, counts) appears in what A can read.
 */

let now = new Date('2026-10-05T17:00:00.000Z');
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = new Date('2026-10-05T17:00:00.000Z');
  await resetDb();
});
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
const ghost = () => randomUUID();

/** B's whole account: a period, two subjects, an activity (with its AUTO reminders), a manual reminder, a class. */
async function world() {
  const a = await setupUser(app, 'a@example.com', 'Materia A');
  const b = await setupUser(app, 'b@example.com', 'Materia B');
  const secondSubject = (
    await b.agent.post('/api/subjects').send({ periodId: b.period.id, name: 'Secreta de B' })
  ).body.subject as { id: string };
  const activity = (
    await postActivity(b.agent, b.subject.id, {
      title: 'Tarea secreta de B',
      type: 'EXAM',
      dueDate: '2026-10-12',
      dueTime: '10:00',
    })
  ).body.activity as { id: string };
  // F1: a general activity (no subject) of B. It has no subject to be reached through, only its period and its id.
  const generalActivity = (
    await b.agent
      .post('/api/activities')
      .send({ title: 'Trámite secreto de B', dueDate: '2026-10-14', type: 'EXAM' })
  ).body.activity as { id: string };
  const reminder = (
    await b.agent
      .post('/api/reminders')
      .send({ activityId: activity.id, remindDate: '2026-10-08', remindTime: '09:00' })
  ).body.reminder as { id: string };
  const block = (
    await b.agent.post('/api/schedule').send({
      type: 'CLASS',
      subjectId: b.subject.id,
      title: 'Clase secreta de B',
      date: '2026-08-03',
      startTime: '08:00',
      endTime: '10:00',
      recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
    })
  ).body.block as { id: string };
  // A formation of B (a study): reachable only through its id, which is exactly what must not work for A.
  const studyTrack = (
    await b.agent
      .post('/api/study-tracks')
      .send({ name: 'Estudio secreto de B', type: 'OTHER_ACADEMIC' })
  ).body.studyTrack as { id: string };
  // Grades (D36): B's and A's own graded period (a period of a study, with its scale, a cut, a subject and a scored evaluation).
  const graded = async (who: typeof a, trackId: string, label: string) => {
    const period = (
      await who.agent
        .post('/api/periods')
        .send({ ...periodInput, name: `Notas de ${label}`, studyTrackId: trackId })
    ).body.period as { id: string };
    const subject = (
      await who.agent.post('/api/subjects').send({ periodId: period.id, name: `Notas ${label}` })
    ).body.subject as { id: string };
    await who.agent
      .post(`/api/periods/${period.id}/grading`)
      .send({ minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 });
    const cut = (
      await who.agent.post(`/api/subjects/${subject.id}/grading/setup`).send({
        gradingPeriods: [
          { name: `Corte secreto de ${label}`, finalShareBp: 5000 },
          { name: `Otro corte de ${label}`, finalShareBp: 5000 },
        ],
      })
    ).body.gradingPeriods[0] as { id: string };
    const evaluation = (
      await who.agent.post('/api/evaluations').send({
        subjectId: subject.id,
        gradingPeriodId: cut.id,
        name: `Parcial secreto de ${label}`,
        periodShareBp: 5000,
        scoreMilli: 4300,
      })
    ).body.evaluation as { id: string };
    return { period, subject, cut, evaluation };
  };
  const gradedB = await graded(b, studyTrack.id, 'B');
  // A's own graded period is built on demand: a second current period of A would change what A's summaries show.
  const gradeA = async () => {
    const aTrack = (
      await a.agent.post('/api/study-tracks').send({ name: 'Estudio de A', type: 'UNIVERSITY' })
    ).body.studyTrack as { id: string };
    return graded(a, aTrack.id, 'A');
  };
  return {
    a,
    b,
    secondSubject,
    activity,
    generalActivity,
    reminder,
    block,
    studyTrack,
    gradeA,
    gradedB,
  };
}

const snapshot = async () => ({
  users: await prisma.user.findMany({ orderBy: { id: 'asc' } }),
  periods: await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }),
  subjects: await prisma.subject.findMany({ orderBy: { id: 'asc' } }),
  activities: await prisma.activity.findMany({ orderBy: { id: 'asc' } }),
  reminders: await prisma.reminder.findMany({ orderBy: { id: 'asc' } }),
  blocks: await prisma.scheduleBlock.findMany({ orderBy: { id: 'asc' } }),
  studyTracks: await prisma.studyTrack.findMany({ orderBy: { id: 'asc' } }),
  gradingProfiles: await prisma.gradingProfile.findMany({ orderBy: { id: 'asc' } }),
  gradingPeriods: await prisma.gradingPeriod.findMany({ orderBy: { id: 'asc' } }),
  evaluations: await prisma.evaluation.findMany({ orderBy: { id: 'asc' } }),
});

const same = (r: request.Response) => ({ status: r.status, body: r.body });

describe('a foreign id is indistinguishable from an id that does not exist', () => {
  /** [label, how to call it for a given id] — every route that takes an id. */
  const byId: [string, (a: Agent, id: string) => request.Test][] = [
    ['GET /subjects/:id', (a, id) => a.get(`/api/subjects/${id}`)],
    ['PATCH /subjects/:id', (a, id) => a.patch(`/api/subjects/${id}`).send({ name: 'Hackeada' })],
    ['DELETE /subjects/:id', (a, id) => a.delete(`/api/subjects/${id}`)],
    ['GET /activities/:id', (a, id) => a.get(`/api/activities/${id}`)],
    ['GET /activities/:id/calendar.ics', (a, id) => a.get(`/api/activities/${id}/calendar.ics`)],
    [
      'PATCH /activities/:id',
      (a, id) => a.patch(`/api/activities/${id}`).send({ title: 'Hackeada' }),
    ],
    [
      'PATCH /activities/:id status',
      (a, id) => a.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' }),
    ],
    ['DELETE /activities/:id', (a, id) => a.delete(`/api/activities/${id}`)],
    ['GET /activities/:id (general)', (a, id) => a.get(`/api/activities/${id}`)],
    [
      'GET /activities/:id/calendar.ics (general)',
      (a, id) => a.get(`/api/activities/${id}/calendar.ics`),
    ],
    [
      'PATCH /activities/:id (general)',
      (a, id) => a.patch(`/api/activities/${id}`).send({ title: 'Hackeada', subjectId: null }),
    ],
    ['DELETE /activities/:id (general)', (a, id) => a.delete(`/api/activities/${id}`)],
    ['GET /schedule/:id', (a, id) => a.get(`/api/schedule/${id}`)],
    ['PATCH /schedule/:id', (a, id) => a.patch(`/api/schedule/${id}`).send({ title: 'Hackeada' })],
    [
      'PATCH /schedule/:id dryRun',
      (a, id) => a.patch(`/api/schedule/${id}?dryRun=true`).send({ title: 'Hackeada' }),
    ],
    ['DELETE /schedule/:id', (a, id) => a.delete(`/api/schedule/${id}`)],
    [
      'PATCH /reminders/:id',
      (a, id) =>
        a.patch(`/api/reminders/${id}`).send({ remindDate: '2026-10-09', remindTime: '08:00' }),
    ],
    ['DELETE /reminders/:id', (a, id) => a.delete(`/api/reminders/${id}`)],
    ['GET /periods/:id', (a, id) => a.get(`/api/periods/${id}`)],
    ['PATCH /periods/:id', (a, id) => a.patch(`/api/periods/${id}`).send({ name: 'Hackeado' })],
    ['DELETE /periods/:id', (a, id) => a.delete(`/api/periods/${id}`)],
    [
      'PATCH /study-tracks/:id',
      (a, id) => a.patch(`/api/study-tracks/${id}`).send({ name: 'Hackeado' }),
    ],
    [
      'PATCH /study-tracks/:id type',
      (a, id) => a.patch(`/api/study-tracks/${id}`).send({ type: 'UNIVERSITY' }),
    ],
    [
      'POST /study-tracks/:id/make-primary',
      (a, id) => a.post(`/api/study-tracks/${id}/make-primary`),
    ],
    ['POST /study-tracks/:id/archive', (a, id) => a.post(`/api/study-tracks/${id}/archive`)],
    ['POST /study-tracks/:id/restore', (a, id) => a.post(`/api/study-tracks/${id}/restore`)],
    [
      'POST /periods/:id/grading',
      (a, id) =>
        a
          .post(`/api/periods/${id}/grading`)
          .send({ minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 }),
    ],
    [
      'POST /subjects/:id/grading/setup',
      (a, id) =>
        a.post(`/api/subjects/${id}/grading/setup`).send({
          profile: { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 },
          gradingPeriods: [{ name: 'Robado', finalShareBp: 10000 }],
        }),
    ],
    ['GET /periods/:id/grading', (a, id) => a.get(`/api/periods/${id}/grading`)],
    [
      'PATCH /periods/:id/grading',
      (a, id) => a.patch(`/api/periods/${id}/grading`).send({ passMilli: 2000 }),
    ],
    [
      'POST /subjects/:id/grading-periods',
      (a, id) =>
        a.post(`/api/subjects/${id}/grading-periods`).send({ name: 'Robado', finalShareBp: 100 }),
    ],
    [
      'POST /subjects/:id/grading-periods/distribution',
      (a, id) =>
        a.post(`/api/subjects/${id}/grading-periods/distribution`).send({
          gradingPeriods: [{ id: '00000000-0000-4000-8000-000000000001', finalShareBp: 10000 }],
        }),
    ],
    [
      'PATCH /grading-periods/:id',
      (a, id) => a.patch(`/api/grading-periods/${id}`).send({ name: 'Hackeado' }),
    ],
    ['DELETE /grading-periods/:id', (a, id) => a.delete(`/api/grading-periods/${id}`)],
    [
      'PATCH /evaluations/:id',
      (a, id) => a.patch(`/api/evaluations/${id}`).send({ scoreMilli: 5000 }),
    ],
    ['DELETE /evaluations/:id', (a, id) => a.delete(`/api/evaluations/${id}`)],
    ['GET /subjects/:id/grades', (a, id) => a.get(`/api/subjects/${id}/grades`)],
  ];

  const target = (label: string, w: Awaited<ReturnType<typeof world>>) =>
    label.includes('/subjects/:id/grading')
      ? w.gradedB.subject.id
      : label.includes('/grading-periods/:id')
        ? w.gradedB.cut.id
        : label.includes('/evaluations/:id')
          ? w.gradedB.evaluation.id
          : label.includes('/grading')
            ? w.gradedB.period.id
            : label.includes('/study-tracks')
              ? w.studyTrack.id
              : label.includes('/subjects')
                ? w.b.subject.id
                : label.includes('(general)')
                  ? w.generalActivity.id
                  : label.includes('/activities')
                    ? w.activity.id
                    : label.includes('/schedule')
                      ? w.block.id
                      : label.includes('/reminders')
                        ? w.reminder.id
                        : w.b.period.id;

  it.each(byId.map(([label, call]) => [label, call] as const))(
    '%s: B’s id gets the exact answer of a random id, and nothing changes',
    async (label, call) => {
      const w = await world();
      const before = await snapshot();
      const foreign = await call(w.a.agent, target(label, w));
      const missing = await call(w.a.agent, ghost());
      expect(foreign.status, label).toBe(404);
      expect(same(foreign), label).toEqual(same(missing));
      expect(await snapshot()).toEqual(before);
    },
  );

  it('deleting B’s subject does not reveal that it has activities (404, never a 409 with a count)', async () => {
    const w = await world();
    const foreign = await w.a.agent.delete(`/api/subjects/${w.b.subject.id}`);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toMatch(/actividad|\d/);
    // The owner, in contrast, does learn it (their own data).
    const own = await w.b.agent.delete(`/api/subjects/${w.b.subject.id}`);
    expect(own.status).toBe(409);
  });
});

describe('foreign keys in a request body or query', () => {
  it('adopt-period: B’s period gets the exact answer of a random id, and nothing changes (a period id travels in the body)', async () => {
    const w = await world();
    const before = await snapshot();
    const adopt = (periodId: string) =>
      w.a.agent
        .post('/api/study-tracks/adopt-period')
        .send({ periodId, name: 'Robado', type: 'UNIVERSITY' });
    const foreign = await adopt(w.b.period.id);
    const missing = await adopt(ghost());
    expect(foreign.status).toBe(404);
    expect(same(foreign)).toEqual(same(missing));
    expect(await snapshot()).toEqual(before);
  });

  it('grades: B’s subject, cut and activity can not be used by A in an evaluation (same answer as non-existent ones)', async () => {
    const w = await world();
    const gradedA = await w.gradeA();
    const before = await snapshot();
    const own = {
      subjectId: gradedA.subject.id,
      gradingPeriodId: gradedA.cut.id,
      name: 'Robada',
      periodShareBp: 1000,
    };
    const attacks: [string, (id: 'real' | 'ghost') => request.Test][] = [
      [
        'evaluation on a foreign subject',
        (k) =>
          w.a.agent
            .post('/api/evaluations')
            .send({ ...own, subjectId: k === 'real' ? w.gradedB.subject.id : ghost() }),
      ],
      [
        'evaluation in a foreign cut',
        (k) =>
          w.a.agent
            .post('/api/evaluations')
            .send({ ...own, gradingPeriodId: k === 'real' ? w.gradedB.cut.id : ghost() }),
      ],
      [
        'evaluation linked to a foreign activity',
        (k) =>
          w.a.agent
            .post('/api/evaluations')
            .send({ ...own, activityId: k === 'real' ? w.activity.id : ghost() }),
      ],
      [
        'evaluation moved to a foreign cut',
        (k) =>
          w.a.agent
            .patch(`/api/evaluations/${gradedA.evaluation.id}`)
            .send({ gradingPeriodId: k === 'real' ? w.gradedB.cut.id : ghost() }),
      ],
      [
        'evaluation linked to a foreign activity (patch)',
        (k) =>
          w.a.agent
            .patch(`/api/evaluations/${gradedA.evaluation.id}`)
            .send({ activityId: k === 'real' ? w.activity.id : ghost() }),
      ],
    ];
    for (const [label, attack] of attacks) {
      const foreign = await attack('real');
      const missing = await attack('ghost');
      expect(foreign.status, label).toBe(404);
      expect(same(foreign), label).toEqual(same(missing));
    }
    expect(await snapshot()).toEqual(before);
  });

  it('B’s subject, activity and period can not be used by A (same answer as a non-existent one)', async () => {
    const w = await world();
    const before = await snapshot();
    const attacks: [string, (id: 'real' | 'ghost') => request.Test][] = [
      [
        'activity with a foreign subject',
        (k) =>
          w.a.agent.post('/api/activities').send({
            subjectId: k === 'real' ? w.b.subject.id : ghost(),
            title: 'X',
            dueDate: '2026-10-20',
          }),
      ],
      [
        'activity moved to a foreign subject',
        (k) =>
          w.a.agent
            .patch(`/api/activities/${ghost()}`)
            .send({ subjectId: k === 'real' ? w.b.subject.id : ghost() }),
      ],
      [
        'schedule block with a foreign subject',
        (k) =>
          w.a.agent.post('/api/schedule').send({
            type: 'CLASS',
            subjectId: k === 'real' ? w.b.subject.id : ghost(),
            title: 'X',
            date: '2026-08-03',
            startTime: '08:00',
            endTime: '09:00',
          }),
      ],
      [
        'schedule block in a foreign period',
        (k) =>
          w.a.agent.post('/api/schedule').send({
            type: 'STUDY',
            periodId: k === 'real' ? w.b.period.id : ghost(),
            title: 'X',
            date: '2026-08-03',
            startTime: '08:00',
            endTime: '09:00',
          }),
      ],
      [
        'reminder on a foreign activity',
        (k) =>
          w.a.agent.post('/api/reminders').send({
            activityId: k === 'real' ? w.activity.id : ghost(),
            remindDate: '2026-10-08',
            remindTime: '09:00',
          }),
      ],
      [
        'subject in a foreign period',
        (k) =>
          w.a.agent
            .post('/api/subjects')
            .send({ periodId: k === 'real' ? w.b.period.id : ghost(), name: 'X' }),
      ],
      [
        'period created in a foreign study',
        (k) =>
          w.a.agent.post('/api/periods').send({
            ...periodInput,
            studyTrackId: k === 'real' ? w.studyTrack.id : ghost(),
          }),
      ],
      [
        'own period moved to a foreign study',
        (k) =>
          w.a.agent
            .patch(`/api/periods/${w.a.period.id}`)
            .send({ studyTrackId: k === 'real' ? w.studyTrack.id : ghost() }),
      ],
      [
        'a foreign period moved to an own study',
        (k) =>
          w.a.agent
            .patch(`/api/periods/${k === 'real' ? w.b.period.id : ghost()}`)
            .send({ studyTrackId: null }),
      ],
      [
        'reminders of a foreign activity',
        (k) => w.a.agent.get(`/api/reminders?activityId=${k === 'real' ? w.activity.id : ghost()}`),
      ],
      [
        'mark a foreign reminder as seen',
        (k) =>
          w.a.agent
            .post('/api/reminders/seen')
            .send({ ids: [k === 'real' ? w.reminder.id : ghost()] }),
      ],
    ];
    for (const [label, call] of attacks) {
      const foreign = await call('real');
      const missing = await call('ghost');
      expect(foreign.status, label).toBeLessThan(500);
      expect(same(foreign), label).toEqual(same(missing));
      expect(foreign.status, label).not.toBe(201);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('the activity list never reaches B’s subject through a filter', async () => {
    const w = await world();
    const res = await w.a.agent.get(
      `/api/activities?subjectId=${w.b.subject.id}&subject=${w.b.subject.id}`,
    );
    expect(JSON.stringify(res.body)).not.toContain(w.activity.id);
    expect(JSON.stringify(res.body)).not.toContain('Tarea secreta de B');
  });
});

describe('nothing of B leaks through lists, aggregates or derived views', () => {
  it('A sees none of B’s ids, titles or names anywhere', async () => {
    const w = await world();
    const secrets = [
      w.b.subject.id,
      w.secondSubject.id,
      w.activity.id,
      w.reminder.id,
      w.block.id,
      w.b.period.id,
      w.studyTrack.id,
      'Estudio secreto de B',
      'Tarea secreta de B',
      'Clase secreta de B',
      'Secreta de B',
      'Materia B',
    ];
    const reads = [
      '/api/subjects',
      '/api/activities',
      '/api/periods',
      '/api/periods/home',
      '/api/periods/current',
      '/api/study-tracks',
      '/api/schedule?from=2026-10-05&to=2026-10-11',
      '/api/reminders',
      '/api/reminders/due',
      '/api/dashboard',
      '/api/radar',
      '/api/attention',
      '/api/progress',
      '/api/workload',
    ];
    for (const path of reads) {
      const res = await w.a.agent.get(path);
      expect(res.status, path).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of secrets) expect(text, `${path} leaks ${secret}`).not.toContain(secret);
    }
  });

  it('A’s counts and derived views ignore B’s data entirely', async () => {
    const w = await world();
    const dashboard = (await w.a.agent.get('/api/dashboard')).body.dashboard;
    expect(dashboard.summary.total).toBe(0);
    expect(dashboard.subjectCount).toBe(1);
    expect((await w.a.agent.get('/api/radar')).body.radar.summary).toMatchObject({
      immediate: 0,
      upcoming: 0,
      plannable: 0,
      underControl: 0,
    });
    expect((await w.a.agent.get('/api/attention')).body.attention.recommendation).toBeNull();
    expect((await w.a.agent.get('/api/progress')).body.progress.general).toMatchObject({
      total: 0,
    });
    expect((await w.a.agent.get('/api/workload')).body.workload.totals.activityCount).toBe(0);
  });

  it('confirming a capture never touches another user: their subject, their data, their activities', async () => {
    const w = await world();
    const before = await prisma.activity.count();
    const attempt = (subjectId: string) =>
      w.a.agent.post('/api/capture/confirm').send({
        items: [
          {
            clientId: 'c1',
            title: 'Z',
            dueDate: '2026-10-08',
            subject: { kind: 'EXISTING', subjectId },
          },
        ],
      });
    const foreign = await attempt(w.b.subject.id);
    const missing = await attempt(randomUUID());
    expect(foreign.status).toBe(400);
    expect(foreign.body).toEqual(missing.body); // exactly the same answer: existence is not confirmed
    expect(JSON.stringify(foreign.body)).not.toContain(w.b.subject.id);
    expect(await prisma.activity.count()).toBe(before);

    // A new subject is created for A, in A's period; B's data is untouched.
    const ok = await w.a.agent.post('/api/capture/confirm').send({
      items: [
        {
          clientId: 'c1',
          title: 'Z',
          dueDate: '2026-10-08',
          subject: { kind: 'NEW', name: 'Nueva de A' },
        },
      ],
    });
    expect(ok.status).toBe(201);
    const created = await prisma.subject.findFirstOrThrow({ where: { name: 'Nueva de A' } });
    expect(created.userId).toBe(w.a.user.id);
    expect(created.periodId).toBe(w.a.period.id);
    const bSide = await prisma.activity.count({ where: { userId: w.b.user.id } });
    expect(bSide).toBe(await prisma.activity.count({ where: { userId: w.b.user.id } }));
  });

  it('Quick Capture and the Academic Inbox only match A’s own subjects', async () => {
    const w = await world();
    const quick = await w.a.agent
      .post('/api/quick-capture/parse')
      .send({ text: 'parcial secreta de B viernes 10am' });
    expect(JSON.stringify(quick.body)).not.toContain(w.secondSubject.id);
    expect(quick.body.capture.subjectId).toBeNull();
    const capture = await w.a.agent
      .post('/api/capture/parse')
      .send({ text: 'parcial de Materia B y de Secreta de B el viernes' });
    expect(JSON.stringify(capture.body)).not.toContain(w.b.subject.id);
    expect(JSON.stringify(capture.body)).not.toContain(w.secondSubject.id);
    const inbox = await w.a.agent
      .post('/api/academic-inbox/parse')
      .send({ text: 'El viernes tendremos parcial de Materia B y de Secreta de B.' });
    expect(JSON.stringify(inbox.body)).not.toContain(w.b.subject.id);
    expect(JSON.stringify(inbox.body)).not.toContain(w.secondSubject.id);
  });

  it('duplicate warnings and conflicts are computed against the user’s own data only', async () => {
    const w = await world();
    // A has a subject with the same name as B's and the same activity: no duplicate warning from B's.
    await w.a.agent.post('/api/subjects').send({ periodId: w.a.period.id, name: 'Secreta de B' });
    const inbox = await w.a.agent
      .post('/api/academic-inbox/parse')
      .send({ text: 'El martes 13 de octubre tendremos parcial de Materia A.' });
    expect(
      inbox.body.inbox.proposals.every((p: { duplicateOf: unknown }) => p.duplicateOf === null),
    ).toBe(true);
    const dry = await w.a.agent.post('/api/schedule?dryRun=true').send({
      type: 'CLASS',
      subjectId: w.a.subject.id,
      title: 'Materia A',
      date: '2026-08-03',
      startTime: '08:00',
      endTime: '10:00',
      recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
    });
    expect(dry.body.warnings).toEqual([]); // B has a class at that hour; A does not see a conflict with it
  });

  it('after B is removed from the picture A’s answers are identical (no hidden dependence on B)', async () => {
    const w = await world();
    const paths = [
      '/api/dashboard',
      '/api/radar',
      '/api/progress',
      '/api/workload',
      '/api/subjects',
    ];
    const strip = (o: unknown) =>
      JSON.parse(
        JSON.stringify(o, (k, v) => (k === 'timestamp' || k === 'generatedAt' ? undefined : v)),
      );
    const withB = await Promise.all(paths.map(async (p) => strip((await w.a.agent.get(p)).body)));
    await prisma.user.delete({
      where: { id: (await prisma.user.findFirstOrThrow({ where: { email: 'b@example.com' } })).id },
    });
    const withoutB = await Promise.all(
      paths.map(async (p) => strip((await w.a.agent.get(p)).body)),
    );
    expect(withB).toEqual(withoutB);
  });
});

describe('strict bodies: no mass assignment', () => {
  const evil = {
    userId: '00000000-0000-4000-8000-000000000001',
    id: '00000000-0000-4000-8000-000000000002',
    passwordHash: 'x',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    completedAt: '2000-01-01T00:00:00.000Z',
    kind: 'AUTO',
    isPrimary: true,
    status: 'ARCHIVED',
  };

  it.each(Object.entries(evil))('every write refuses the internal field %s', async (key, value) => {
    const w = await world();
    const mine = (await postActivity(w.a.agent, w.a.subject.id, { title: 'Mía' })).body
      .activity as { id: string };
    const myTrack = (
      await w.a.agent.post('/api/study-tracks').send({ name: 'Mío', type: 'SCHOOL' })
    ).body.studyTrack as { id: string };
    const before = await snapshot();
    const attempts: request.Test[] = [
      w.a.agent.post('/api/study-tracks').send({ name: 'Z', type: 'SCHOOL', [key]: value }),
      w.a.agent.post('/api/study-tracks/setup').send({
        track: { name: 'Z', type: 'SCHOOL' },
        period: { name: 'Z', startDate: '2026-08-03', endDate: '2026-11-28' },
        [key]: value,
      }),
      w.a.agent.post('/api/study-tracks/setup').send({
        track: { name: 'Z', type: 'SCHOOL', [key]: value },
        period: { name: 'Z', startDate: '2026-08-03', endDate: '2026-11-28' },
      }),
      w.a.agent.post('/api/study-tracks/setup').send({
        track: { name: 'Z', type: 'SCHOOL' },
        period: { name: 'Z', startDate: '2026-08-03', endDate: '2026-11-28', [key]: value },
      }),
      w.a.agent
        .post('/api/study-tracks/adopt-period')
        .send({ periodId: w.a.period.id, name: 'Z', type: 'SCHOOL', [key]: value }),
      w.a.agent.patch(`/api/study-tracks/${myTrack.id}`).send({ name: 'Z', [key]: value }),
      w.a.agent.post('/api/subjects').send({ periodId: w.a.period.id, name: 'Z', [key]: value }),
      w.a.agent.patch(`/api/subjects/${w.a.subject.id}`).send({ name: 'Z', [key]: value }),
      w.a.agent
        .post('/api/activities')
        .send({ subjectId: w.a.subject.id, title: 'Z', dueDate: '2026-12-01', [key]: value }),
      w.a.agent.post('/api/activities').send({ title: 'Z', dueDate: '2026-12-01', [key]: value }),
      w.a.agent.patch(`/api/activities/${mine.id}`).send({ title: 'Z', [key]: value }),
      w.a.agent.post('/api/schedule').send({
        type: 'STUDY',
        title: 'Z',
        date: '2026-08-03',
        startTime: '08:00',
        endTime: '09:00',
        [key]: value,
      }),
      w.a.agent
        .post('/api/reminders')
        .send({ activityId: mine.id, remindDate: '2026-10-08', remindTime: '09:00', [key]: value }),
      w.a.agent.patch(`/api/periods/${w.a.period.id}`).send({ name: 'Z', [key]: value }),
      w.a.agent.post('/api/periods').send({ ...periodInput, [key]: value }),
      w.a.agent.post('/api/quick-capture/parse').send({ text: 'x', [key]: value }),
      w.a.agent.post('/api/capture/parse').send({ text: 'x', [key]: value }),
      w.a.agent.post('/api/capture/confirm').send({
        items: [{ clientId: 'c1', title: 'Z', dueDate: '2026-10-08', subject: { kind: 'NONE' } }],
        [key]: value,
      }),
      w.a.agent.post('/api/capture/confirm').send({
        items: [
          {
            ...{ clientId: 'c1', title: 'Z', dueDate: '2026-10-08', subject: { kind: 'NONE' } },
            [key]: value,
          },
        ],
      }),
      w.a.agent.post('/api/academic-inbox/parse').send({ text: 'x', [key]: value }),
    ];
    for (const r of await Promise.all(attempts)) {
      expect(r.status, `${key}: ${r.request.method} ${r.request.url}`).toBe(400);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('registration refuses internal fields too', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'M',
      email: 'm@example.com',
      password: 'correct horse battery',
      passwordHash: 'x',
      id: evil.id,
    });
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { email: 'm@example.com' } })).toBe(0);
  });

  it('completedAt only ever comes from the status change, made by the server', async () => {
    const w = await world();
    const mine = (await postActivity(w.a.agent, w.a.subject.id, { title: 'Mía' })).body
      .activity as { id: string };
    expect(
      (
        await w.a.agent
          .patch(`/api/activities/${mine.id}`)
          .send({ completedAt: '2000-01-01T00:00:00.000Z' })
      ).status,
    ).toBe(400);
    const done = await w.a.agent.patch(`/api/activities/${mine.id}`).send({ status: 'COMPLETED' });
    expect(done.status).toBe(200);
    // The instant comes from the server's clock, not from anything the client sent.
    expect(done.body.activity.completedAt).toBe(now.toISOString());
  });
});

describe('every protected route refuses an anonymous caller', () => {
  const routes: [string, string][] = [
    ['get', '/api/auth/me'],
    ['get', '/api/periods'],
    ['get', '/api/periods/home'],
    ['get', '/api/periods/current'],
    ['post', '/api/periods'],
    ['patch', `/api/periods/${randomUUID()}`],
    ['post', '/api/onboarding/complete'],
    ['get', '/api/study-tracks'],
    ['post', '/api/study-tracks'],
    ['post', '/api/study-tracks/setup'],
    ['post', '/api/study-tracks/adopt-period'],
    ['patch', `/api/study-tracks/${randomUUID()}`],
    ['post', `/api/study-tracks/${randomUUID()}/make-primary`],
    ['post', `/api/study-tracks/${randomUUID()}/archive`],
    ['post', `/api/study-tracks/${randomUUID()}/restore`],
    ['get', '/api/subjects'],
    ['post', '/api/subjects'],
    ['get', `/api/subjects/${randomUUID()}`],
    ['patch', `/api/subjects/${randomUUID()}`],
    ['delete', `/api/subjects/${randomUUID()}`],
    ['get', '/api/activities'],
    ['post', '/api/activities'],
    ['get', `/api/activities/${randomUUID()}`],
    ['get', `/api/activities/${randomUUID()}/calendar.ics`],
    ['patch', `/api/activities/${randomUUID()}`],
    ['delete', `/api/activities/${randomUUID()}`],
    ['get', '/api/schedule'],
    ['post', '/api/schedule'],
    ['get', `/api/schedule/${randomUUID()}`],
    ['patch', `/api/schedule/${randomUUID()}`],
    ['delete', `/api/schedule/${randomUUID()}`],
    ['get', '/api/reminders'],
    ['get', '/api/reminders/due'],
    ['post', '/api/reminders'],
    ['post', '/api/reminders/seen'],
    ['patch', `/api/reminders/${randomUUID()}`],
    ['delete', `/api/reminders/${randomUUID()}`],
    ['get', '/api/dashboard'],
    ['get', '/api/radar'],
    ['get', '/api/attention'],
    ['get', '/api/progress'],
    ['get', '/api/workload'],
    ['post', '/api/quick-capture/parse'],
    ['post', '/api/capture/parse'],
    ['post', '/api/capture/confirm'],
    ['post', '/api/academic-inbox/parse'],
    ['post', '/api/schedule-import/parse'],
    ['post', '/api/schedule-import/confirm'],
  ];
  it.each(routes)('%s %s -> 401', async (method, path) => {
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
      method
    ]!(path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
