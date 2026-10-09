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
  signUp,
} from '../../test/helpers.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('authentication', () => {
  it('every activity endpoint requires a session', async () => {
    const id = randomUUID();
    const calls = [
      request(app).get('/api/activities'),
      request(app)
        .post('/api/activities')
        .send({ subjectId: id, title: 'x', dueDate: '2099-01-01' }),
      request(app).get(`/api/activities/${id}`),
      request(app).patch(`/api/activities/${id}`).send({ title: 'x' }),
      request(app).delete(`/api/activities/${id}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('POST /api/activities', () => {
  it('creates with only title, subject and date; defaults are applied and it persists', async () => {
    const { agent, user, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id);

    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({
      subjectId: subject.id,
      title: 'Parcial 1',
      description: null,
      type: 'TASK',
      priority: 'MEDIUM',
      status: 'PENDING',
      hasTime: false,
      completedAt: null,
    });

    const row = await prisma.activity.findUniqueOrThrow({ where: { id: res.body.activity.id } });
    expect(row).toMatchObject({
      userId: user.id,
      subjectId: subject.id,
      title: 'Parcial 1',
      type: 'TASK',
      priority: 'MEDIUM',
      status: 'PENDING',
      hasTime: false,
      completedAt: null,
    });
    expect(res.body.activity.userId).toBeUndefined(); // internal field not exposed
  });

  it('stores a date without time as the end of the Bogotá day (UTC-5) with hasTime=false', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id, { dueDate: '2026-10-10' });
    expect(res.body.activity.dueAt).toBe('2026-10-11T04:59:59.999Z');
    expect(res.body.activity.hasTime).toBe(false);
  });

  it('stores a date with time as that Bogotá wall time in UTC with hasTime=true', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id, { dueDate: '2026-10-10', dueTime: '14:00' });
    expect(res.body.activity.dueAt).toBe('2026-10-10T19:00:00.000Z');
    expect(res.body.activity.hasTime).toBe(true);
    const row = await prisma.activity.findFirstOrThrow();
    expect(row.dueAt.toISOString()).toBe('2026-10-10T19:00:00.000Z');
  });

  it('uses the timezone of the authenticated user, not a hard-coded one', async () => {
    const { agent, user, subject } = await setupUser(app, 'a@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Pacific/Auckland' } });

    const end = await postActivity(agent, subject.id, { dueDate: '2026-10-10', title: 'a' });
    const timed = await postActivity(agent, subject.id, {
      dueDate: '2026-10-10',
      dueTime: '10:00',
      title: 'b',
    });
    expect(end.body.activity.dueAt).toBe('2026-10-10T10:59:59.999Z'); // 23:59:59.999 at +13
    expect(timed.body.activity.dueAt).toBe('2026-10-09T21:00:00.000Z'); // 10:00 at +13
  });

  it('accepts the advanced options and trims text', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id, {
      title: '  Proyecto final  ',
      type: 'PROJECT',
      priority: 'HIGH',
      description: '  Entregar informe y código  ',
    });
    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({
      title: 'Proyecto final',
      type: 'PROJECT',
      priority: 'HIGH',
      description: 'Entregar informe y código',
      status: 'PENDING',
    });
  });

  it.each([
    ['empty title', { title: '   ' }, 'title'],
    ['title over 150 chars', { title: 'x'.repeat(151) }, 'title'],
    ['invalid type', { type: 'HOMEWORK' }, 'type'],
    ['invalid priority', { priority: 'URGENT' }, 'priority'],
    ['impossible date', { dueDate: '2026-02-30' }, 'dueDate'],
    ['malformed date', { dueDate: '10/10/2026' }, 'dueDate'],
    ['missing date', { dueDate: undefined }, 'dueDate'],
    ['invalid time', { dueTime: '24:00' }, 'dueTime'],
    ['description over 2000 chars', { description: 'x'.repeat(2001) }, 'description'],
    ['malformed subjectId', { subjectId: 'nope' }, 'subjectId'],
  ])('rejects %s', async (_l, patch, field) => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id, patch);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[field]).toBeDefined();
    expect(await prisma.activity.count()).toBe(0);
  });

  it('rejects a body with userId, status, completedAt or periodId', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { user: other } = await signUp(app, 'b@example.com');
    for (const extra of [
      { userId: other.id },
      { status: 'COMPLETED' },
      { completedAt: '2026-01-01T00:00:00.000Z' },
      { periodId: randomUUID() },
    ]) {
      expect((await postActivity(agent, subject.id, extra)).status).toBe(400);
    }
    expect(await prisma.activity.count()).toBe(0);
  });

  it('answers 404 when the subject does not exist', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, randomUUID());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.activity.count()).toBe(0);
  });

  it('answers 404 when the subject belongs to another user, creating nothing', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com');
    const res = await postActivity(a.agent, b.subject.id);
    expect(res.status).toBe(404);
    expect(await prisma.activity.count()).toBe(0);
  });
});

describe('GET /api/activities/:id', () => {
  it('returns an own activity; a malformed id is 404 like an unknown one', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await postActivity(agent, subject.id)).body.activity;
    expect((await agent.get(`/api/activities/${id}`)).body.activity.title).toBe('Parcial 1');

    const bad = await agent.get('/api/activities/not-a-uuid');
    const unknown = await agent.get(`/api/activities/${randomUUID()}`);
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual(unknown.body);
  });
});

describe('PATCH /api/activities/:id', () => {
  async function create(body: object = {}) {
    const ctx = await setupUser(app, 'a@example.com');
    const id = (await postActivity(ctx.agent, ctx.subject.id, body)).body.activity.id as string;
    return { ...ctx, id };
  }

  it('edits title, priority, type and description', async () => {
    const { agent, id } = await create();
    const res = await agent
      .patch(`/api/activities/${id}`)
      .send({ title: 'Parcial 2', priority: 'HIGH', type: 'EXAM', description: 'Corte 2' });
    expect(res.status).toBe(200);
    expect(res.body.activity).toMatchObject({
      title: 'Parcial 2',
      priority: 'HIGH',
      type: 'EXAM',
      description: 'Corte 2',
    });
    const row = await prisma.activity.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ title: 'Parcial 2', priority: 'HIGH', type: 'EXAM' });
  });

  it('clears the description with null or empty text and leaves omitted fields alone', async () => {
    const { agent, id } = await create({ description: 'algo', priority: 'LOW' });
    const res = await agent.patch(`/api/activities/${id}`).send({ description: '' });
    expect(res.body.activity).toMatchObject({
      description: null,
      priority: 'LOW',
      title: 'Parcial 1',
    });
  });

  it('moves the activity to another subject of the same user', async () => {
    const { agent, period, id } = await create();
    const other = (await agent.post('/api/subjects').send({ periodId: period.id, name: 'Bases' }))
      .body.subject;
    const res = await agent.patch(`/api/activities/${id}`).send({ subjectId: other.id });
    expect(res.status).toBe(200);
    expect(res.body.activity.subjectId).toBe(other.id);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).subjectId).toBe(other.id);
  });

  it('refuses to move the activity to a subject of another user, leaving it where it was', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com');
    const id = (await postActivity(a.agent, a.subject.id)).body.activity.id;

    const res = await a.agent.patch(`/api/activities/${id}`).send({ subjectId: b.subject.id });
    expect(res.status).toBe(404);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).subjectId).toBe(
      a.subject.id,
    );
  });

  it('answers 404 when moving to a subject that does not exist', async () => {
    const { agent, id } = await create();
    expect(
      (await agent.patch(`/api/activities/${id}`).send({ subjectId: randomUUID() })).status,
    ).toBe(404);
  });

  describe('due date', () => {
    it('changing only the date keeps the stored time', async () => {
      const { agent, id } = await create({ dueDate: '2026-10-10', dueTime: '14:00' });
      const res = await agent.patch(`/api/activities/${id}`).send({ dueDate: '2026-10-12' });
      expect(res.body.activity).toMatchObject({ dueAt: '2026-10-12T19:00:00.000Z', hasTime: true });
    });

    it('changing only the date of an all-day activity keeps it all-day', async () => {
      const { agent, id } = await create({ dueDate: '2026-10-10' });
      const res = await agent.patch(`/api/activities/${id}`).send({ dueDate: '2026-10-12' });
      expect(res.body.activity).toMatchObject({
        dueAt: '2026-10-13T04:59:59.999Z',
        hasTime: false,
      });
    });

    it('adding a time to an all-day activity keeps its date', async () => {
      const { agent, id } = await create({ dueDate: '2026-10-10' });
      const res = await agent.patch(`/api/activities/${id}`).send({ dueTime: '09:30' });
      expect(res.body.activity).toMatchObject({ dueAt: '2026-10-10T14:30:00.000Z', hasTime: true });
    });

    it('dueTime null (or empty) removes the time: back to the end of the day', async () => {
      const { agent, id } = await create({ dueDate: '2026-10-10', dueTime: '14:00' });
      const res = await agent.patch(`/api/activities/${id}`).send({ dueTime: null });
      expect(res.body.activity).toMatchObject({
        dueAt: '2026-10-11T04:59:59.999Z',
        hasTime: false,
      });
    });

    it('changes date and time together', async () => {
      const { agent, id } = await create();
      const res = await agent
        .patch(`/api/activities/${id}`)
        .send({ dueDate: '2026-12-01', dueTime: '08:00' });
      expect(res.body.activity).toMatchObject({ dueAt: '2026-12-01T13:00:00.000Z', hasTime: true });
    });

    it('rejects invalid dates and times', async () => {
      const { agent, id } = await create();
      expect(
        (await agent.patch(`/api/activities/${id}`).send({ dueDate: '2026-02-30' })).status,
      ).toBe(400);
      expect((await agent.patch(`/api/activities/${id}`).send({ dueTime: '99:99' })).status).toBe(
        400,
      );
    });
  });

  it('rejects userId, completedAt, invalid enums and empty titles', async () => {
    const { agent, id } = await create();
    for (const body of [
      { userId: randomUUID() },
      { completedAt: '2026-01-01T00:00:00.000Z' },
      { status: 'DONE' },
      { priority: 'URGENT' },
      { type: 'HOMEWORK' },
      { title: '  ' },
    ]) {
      expect(
        (await agent.patch(`/api/activities/${id}`).send(body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });

  it('an empty patch is a no-op that returns the activity', async () => {
    const { agent, id } = await create();
    const res = await agent.patch(`/api/activities/${id}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.activity.title).toBe('Parcial 1');
  });
});

describe('status and completedAt (rule decided by the backend)', () => {
  let now = new Date('2026-10-05T10:00:00.000Z');
  const clockApp = buildApp({ clock: () => now });

  beforeEach(() => {
    now = new Date('2026-10-05T10:00:00.000Z');
  });

  async function create() {
    const ctx = await setupUser(clockApp, 'a@example.com');
    const id = (await postActivity(ctx.agent, ctx.subject.id)).body.activity.id as string;
    return { ...ctx, id };
  }

  it('COMPLETED stamps completedAt with the server clock', async () => {
    const { agent, id } = await create();
    const res = await agent.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' });
    expect(res.body.activity.status).toBe('COMPLETED');
    expect(res.body.activity.completedAt).toBe('2026-10-05T10:00:00.000Z');
    expect(
      (await prisma.activity.findUniqueOrThrow({ where: { id } })).completedAt?.toISOString(),
    ).toBe('2026-10-05T10:00:00.000Z');
  });

  it('IN_PROGRESS does not set completedAt', async () => {
    const { agent, id } = await create();
    const res = await agent.patch(`/api/activities/${id}`).send({ status: 'IN_PROGRESS' });
    expect(res.body.activity).toMatchObject({ status: 'IN_PROGRESS', completedAt: null });
  });

  it('re-saving a COMPLETED activity keeps the original completedAt', async () => {
    const { agent, id } = await create();
    await agent.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' });

    now = new Date('2026-10-09T18:00:00.000Z');
    const again = await agent.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' });
    expect(again.body.activity.completedAt).toBe('2026-10-05T10:00:00.000Z');
    const edited = await agent.patch(`/api/activities/${id}`).send({ title: 'Renombrada' });
    expect(edited.body.activity).toMatchObject({
      status: 'COMPLETED',
      completedAt: '2026-10-05T10:00:00.000Z',
    });
  });

  it('reopening clears completedAt, and completing again stamps the new time', async () => {
    const { agent, id } = await create();
    await agent.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' });

    const reopened = await agent.patch(`/api/activities/${id}`).send({ status: 'PENDING' });
    expect(reopened.body.activity).toMatchObject({ status: 'PENDING', completedAt: null });
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).completedAt).toBeNull();

    const toProgress = await agent.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' });
    expect(toProgress.body.activity.completedAt).toBe('2026-10-05T10:00:00.000Z');
    now = new Date('2026-10-20T00:00:00.000Z');
    await agent.patch(`/api/activities/${id}`).send({ status: 'IN_PROGRESS' });
    now = new Date('2026-10-21T00:00:00.000Z');
    const again = await agent.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' });
    expect(again.body.activity.completedAt).toBe('2026-10-21T00:00:00.000Z');
  });

  it('the client can never choose completedAt', async () => {
    const { agent, id } = await create();
    const res = await agent
      .patch(`/api/activities/${id}`)
      .send({ status: 'COMPLETED', completedAt: '2000-01-01T00:00:00.000Z' });
    expect(res.status).toBe(400);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });

  it('the database refuses an inconsistent status/completedAt pair, whoever writes it', async () => {
    const { agent, id } = await create();
    await expect(
      prisma.activity.update({ where: { id }, data: { status: 'COMPLETED', completedAt: null } }),
    ).rejects.toThrow();
    await expect(
      prisma.activity.update({
        where: { id },
        data: { status: 'PENDING', completedAt: new Date() },
      }),
    ).rejects.toThrow();
    expect((await agent.get(`/api/activities/${id}`)).body.activity.status).toBe('PENDING');
  });

  it('overdue is not stored: a past deadline leaves the status untouched', async () => {
    const { agent, subject } = await setupUser(clockApp, 'b@example.com');
    const res = await postActivity(agent, subject.id, { dueDate: '2020-01-01' });
    expect(res.body.activity.status).toBe('PENDING');
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'Activity'`;
    expect(columns.map((c) => c.column_name)).not.toContain('isOverdue');
    // The period, on the contrary, IS stored (F1): an activity always belongs to one, with or without a subject.
    expect(columns.map((c) => c.column_name)).toContain('periodId');
  });
});

describe('DELETE /api/activities/:id', () => {
  it('deletes an own activity and it is gone afterwards', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await postActivity(agent, subject.id)).body.activity;
    expect((await agent.delete(`/api/activities/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/activities/${id}`)).status).toBe(404);
    expect((await agent.delete(`/api/activities/${id}`)).status).toBe(404);
    expect(await prisma.activity.count()).toBe(0);
  });

  it('deleting a user removes their activities too (no orphans)', async () => {
    const { agent, user, subject } = await setupUser(app, 'a@example.com');
    await postActivity(agent, subject.id).expect(201);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.activity.count()).toBe(0);
  });
});

describe('subject deletion now that activities exist', () => {
  it('deletes a subject without activities', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    expect((await agent.delete(`/api/subjects/${subject.id}`)).status).toBe(204);
  });

  it('refuses with 409 SUBJECT_NOT_EMPTY when it has activities, leaving everything intact', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const created = (await postActivity(agent, subject.id)).body.activity;
    const before = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });

    const res = await agent.delete(`/api/subjects/${subject.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBJECT_NOT_EMPTY');
    expect(res.body.error.message).toBe(
      'La asignatura tiene actividades o bloques de agenda asociados.',
    );
    expect(await prisma.subject.count()).toBe(1);
    expect(await prisma.activity.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before);
  });

  it('can be deleted after its activities are deleted, or after they are moved away', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com');
    const a1 = (await postActivity(agent, subject.id, { title: 'uno' })).body.activity;
    const a2 = (await postActivity(agent, subject.id, { title: 'dos' })).body.activity;
    const other = (await agent.post('/api/subjects').send({ periodId: period.id, name: 'Bases' }))
      .body.subject;

    await agent.patch(`/api/activities/${a1.id}`).send({ subjectId: other.id }).expect(200); // moved
    expect((await agent.delete(`/api/subjects/${subject.id}`)).status).toBe(409); // a2 still there
    await agent.delete(`/api/activities/${a2.id}`).expect(204);
    expect((await agent.delete(`/api/subjects/${subject.id}`)).status).toBe(204);
    expect(await prisma.activity.count()).toBe(1); // a1 survives under the other subject
  });

  it('the foreign key itself refuses to drop a subject that has activities', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await postActivity(agent, subject.id).expect(201);
    await expect(prisma.subject.delete({ where: { id: subject.id } })).rejects.toThrow();
  });

  it('a period whose subjects have activities still cannot be deleted', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com');
    await postActivity(agent, subject.id).expect(201);
    expect((await agent.delete(`/api/periods/${period.id}`)).body.error.code).toBe(
      'PERIOD_NOT_EMPTY',
    );
  });
});

describe('concurrency', () => {
  it('simultaneous status changes never leave status and completedAt inconsistent', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await postActivity(agent, subject.id)).body.activity;

    for (let round = 0; round < 4; round++) {
      const statuses = [
        'COMPLETED',
        'IN_PROGRESS',
        'COMPLETED',
        'PENDING',
        'COMPLETED',
        'IN_PROGRESS',
      ];
      const results = await Promise.all(
        statuses.map((status) => agent.patch(`/api/activities/${id}`).send({ status })),
      );
      for (const r of results) expect(r.status).toBe(200);
      const row = await prisma.activity.findUniqueOrThrow({ where: { id } });
      expect(row.status === 'COMPLETED').toBe(row.completedAt !== null);
    }
  });

  it('deleting a subject while activities are being created never errors and never orphans', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'inicial');
    for (let round = 0; round < 8; round++) {
      const subject = (
        await agent.post('/api/subjects').send({ periodId: period.id, name: `Materia ${round}` })
      ).body.subject;
      const results = await Promise.all([
        agent.delete(`/api/subjects/${subject.id}`),
        postActivity(agent, subject.id, { title: `a${round}` }),
        postActivity(agent, subject.id, { title: `b${round}` }),
      ]);
      for (const r of results)
        expect([201, 204, 404, 409], `round ${round}: ${r.status}`).toContain(r.status);

      const stillThere = await prisma.subject.findUnique({ where: { id: subject.id } });
      const orphans = await prisma.activity.count({ where: { subjectId: subject.id } });
      if (!stillThere) expect(orphans).toBe(0);
    }
  });
});

describe('period is derived, never duplicated', () => {
  it('lists activities of a period through the subject', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com');
    const second = (
      await agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Otro', startDate: '2027-02-01', endDate: '2027-06-01' })
    ).body.period;
    const otherSubject = (
      await agent.post('/api/subjects').send({ periodId: second.id, name: 'Redes' })
    ).body.subject;
    await postActivity(agent, subject.id, { title: 'del periodo 1' });
    await postActivity(agent, otherSubject.id, { title: 'del periodo 2' });

    const p1 = await agent.get(`/api/activities?periodId=${period.id}`);
    expect(p1.body.activities.map((a: { title: string }) => a.title)).toEqual(['del periodo 1']);
    const p2 = await agent.get(`/api/activities?periodId=${second.id}`);
    expect(p2.body.activities.map((a: { title: string }) => a.title)).toEqual(['del periodo 2']);
  });
});
