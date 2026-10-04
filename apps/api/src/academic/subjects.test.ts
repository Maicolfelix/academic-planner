import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function setup(email = 'a@example.com') {
  const session = await signUp(app, email);
  const period = (await session.agent.post('/api/periods').send(periodInput)).body.period;
  return { ...session, period };
}

const createSubject = (agent: request.Agent, body: object) =>
  agent.post('/api/subjects').send(body);

describe('authentication', () => {
  it('every subject endpoint requires a session', async () => {
    const id = randomUUID();
    const calls = [
      request(app).get('/api/subjects'),
      request(app).post('/api/subjects').send({ periodId: id, name: 'x' }),
      request(app).get(`/api/subjects/${id}`),
      request(app).patch(`/api/subjects/${id}`).send({ name: 'x' }),
      request(app).delete(`/api/subjects/${id}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('POST /api/subjects', () => {
  it('creates a subject owned by the session user, with defaults', async () => {
    const { agent, user, period } = await setup();
    const res = await createSubject(agent, { periodId: period.id, name: 'Redes' });

    expect(res.status).toBe(201);
    expect(res.body.subject).toMatchObject({
      periodId: period.id,
      name: 'Redes',
      color: '#3B82F6',
      professor: null,
      description: null,
    });
    expect(res.body.subject.userId).toBeUndefined(); // internal fields are not exposed
    expect(res.body.subject.nameKey).toBeUndefined();

    const row = await prisma.subject.findUniqueOrThrow({ where: { id: res.body.subject.id } });
    expect(row.userId).toBe(user.id);
    expect(row.nameKey).toBe('redes');
  });

  it('stores optional fields, trims text and normalises the color', async () => {
    const { agent, period } = await setup();
    const res = await createSubject(agent, {
      periodId: period.id,
      name: '  Bases de Datos  ',
      color: '#ef4444',
      professor: '  Ana Gómez ',
      description: ' Unidad 1: modelo relacional ',
    });
    expect(res.status).toBe(201);
    expect(res.body.subject).toMatchObject({
      name: 'Bases de Datos',
      color: '#EF4444',
      professor: 'Ana Gómez',
      description: 'Unidad 1: modelo relacional',
    });
  });

  it.each([
    ['empty name', { name: '   ' }, 'name'],
    ['name over 100 chars', { name: 'x'.repeat(101) }, 'name'],
    ['color outside the palette', { color: '#123456' }, 'color'],
    ['color as free text', { color: 'rojo' }, 'color'],
    ['color with an injection payload', { color: 'red;background:url(x)' }, 'color'],
    ['professor over 100 chars', { professor: 'x'.repeat(101) }, 'professor'],
    ['description over 500 chars', { description: 'x'.repeat(501) }, 'description'],
    ['malformed periodId', { periodId: 'nope' }, 'periodId'],
  ])('rejects %s', async (_l, patch, field) => {
    const { agent, period } = await setup();
    const res = await createSubject(agent, { periodId: period.id, name: 'Redes', ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[field]).toBeDefined();
    expect(await prisma.subject.count()).toBe(0);
  });

  it('rejects a client-sent userId instead of trusting it', async () => {
    const { agent, period } = await setup();
    const { user: other } = await signUp(app, 'b@example.com');
    const res = await createSubject(agent, {
      periodId: period.id,
      name: 'Redes',
      userId: other.id,
    });
    expect(res.status).toBe(400);
    expect(await prisma.subject.count()).toBe(0);
  });

  it('answers 404 when the periodId does not exist', async () => {
    const { agent } = await setup();
    const res = await createSubject(agent, { periodId: randomUUID(), name: 'Redes' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  describe('duplicates inside one period', () => {
    it.each([['Redes'], [' redes '], ['REDES'], ['Rédes']])(
      'refuses "%s" when "Redes" exists',
      async (dup) => {
        const { agent, period } = await setup();
        await createSubject(agent, { periodId: period.id, name: 'Redes' }).expect(201);

        const res = await createSubject(agent, { periodId: period.id, name: dup });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('SUBJECT_ALREADY_EXISTS');
        expect(res.body.error.details.fields.name).toBeDefined();
        expect(await prisma.subject.count()).toBe(1);
      },
    );

    it('keeps the name exactly as typed (trimmed) while comparing on the normalised key', async () => {
      const { agent, period } = await setup();
      const res = await createSubject(agent, { periodId: period.id, name: '  Matemáticas  II ' });
      expect(res.body.subject.name).toBe('Matemáticas  II');
      const row = await prisma.subject.findFirstOrThrow();
      expect(row.nameKey).toBe('matematicas ii');
    });

    it('allows the same name in a different period', async () => {
      const { agent, period } = await setup();
      const other = (
        await agent.post('/api/periods').send({
          ...periodInput,
          name: 'Primero 2027',
          startDate: '2027-02-01',
          endDate: '2027-06-01',
        })
      ).body.period;
      await createSubject(agent, { periodId: period.id, name: 'Matemáticas' }).expect(201);
      await createSubject(agent, { periodId: other.id, name: 'Matemáticas' }).expect(201);
    });

    it('two users can each have the same subject name', async () => {
      const a = await setup('a@example.com');
      const b = await setup('b@example.com');
      await createSubject(a.agent, { periodId: a.period.id, name: 'Redes' }).expect(201);
      await createSubject(b.agent, { periodId: b.period.id, name: 'Redes' }).expect(201);
    });

    it('is enforced by the database even for simultaneous requests', async () => {
      const { agent, period } = await setup();
      const results = await Promise.all(
        ['Redes', 'redes', 'REDES', ' Redes '].map((name) =>
          createSubject(agent, { periodId: period.id, name }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await prisma.subject.count()).toBe(1);
    });
  });
});

describe('GET /api/subjects and /api/subjects/:id', () => {
  it('lists only the own subjects, alphabetically, and can filter by period', async () => {
    const a = await setup('a@example.com');
    const b = await setup('b@example.com');
    const second = (
      await a.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Otro', startDate: '2027-02-01', endDate: '2027-06-01' })
    ).body.period;

    await createSubject(a.agent, { periodId: a.period.id, name: 'Redes' });
    await createSubject(a.agent, { periodId: a.period.id, name: 'Bases de Datos' });
    await createSubject(a.agent, { periodId: second.id, name: 'Álgebra' });
    await createSubject(b.agent, { periodId: b.period.id, name: 'Secreta de B' });

    const all = await a.agent.get('/api/subjects');
    expect(all.body.subjects.map((s: { name: string }) => s.name)).toEqual([
      'Álgebra',
      'Bases de Datos',
      'Redes',
    ]);

    const filtered = await a.agent.get(`/api/subjects?periodId=${a.period.id}`);
    expect(filtered.body.subjects.map((s: { name: string }) => s.name)).toEqual([
      'Bases de Datos',
      'Redes',
    ]);
  });

  it('a new user sees zero subjects', async () => {
    const a = await setup('a@example.com');
    await createSubject(a.agent, { periodId: a.period.id, name: 'Redes' });
    const b = await signUp(app, 'b@example.com');
    const res = await b.agent.get('/api/subjects');
    expect(res.status).toBe(200);
    expect(res.body.subjects).toEqual([]);
  });

  it('returns an own subject; malformed id is 404 like an unknown id', async () => {
    const { agent, period } = await setup();
    const { id } = (await createSubject(agent, { periodId: period.id, name: 'Redes' })).body
      .subject;
    expect((await agent.get(`/api/subjects/${id}`)).body.subject.name).toBe('Redes');

    const bad = await agent.get('/api/subjects/not-a-uuid');
    const unknown = await agent.get(`/api/subjects/${randomUUID()}`);
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual(unknown.body);
  });

  it('rejects an invalid periodId filter', async () => {
    const { agent } = await setup();
    expect((await agent.get('/api/subjects?periodId=zzz')).status).toBe(400);
  });
});

describe('PATCH /api/subjects/:id', () => {
  it('edits name, professor, color and description', async () => {
    const { agent, period } = await setup();
    const { id } = (await createSubject(agent, { periodId: period.id, name: 'Redes' })).body
      .subject;

    const res = await agent.patch(`/api/subjects/${id}`).send({
      name: 'Redes y Comunicaciones',
      professor: 'Carlos Pérez',
      color: '#10B981',
      description: 'Capa de transporte',
    });
    expect(res.status).toBe(200);
    expect(res.body.subject).toMatchObject({
      name: 'Redes y Comunicaciones',
      professor: 'Carlos Pérez',
      color: '#10B981',
      description: 'Capa de transporte',
      periodId: period.id,
    });
    expect((await prisma.subject.findUniqueOrThrow({ where: { id } })).nameKey).toBe(
      'redes y comunicaciones',
    );
  });

  it('clears optional fields with null or empty text and leaves omitted ones alone', async () => {
    const { agent, period } = await setup();
    const { id } = (
      await createSubject(agent, {
        periodId: period.id,
        name: 'Redes',
        professor: 'X',
        description: 'Y',
      })
    ).body.subject;

    const res = await agent.patch(`/api/subjects/${id}`).send({ professor: '', color: '#EF4444' });
    expect(res.body.subject).toMatchObject({
      professor: null,
      description: 'Y',
      color: '#EF4444',
      name: 'Redes',
    });
    expect(
      (await agent.patch(`/api/subjects/${id}`).send({ description: null })).body.subject
        .description,
    ).toBeNull();
  });

  it('refuses to change periodId or userId', async () => {
    const { agent, period } = await setup();
    const { id } = (await createSubject(agent, { periodId: period.id, name: 'Redes' })).body
      .subject;
    expect((await agent.patch(`/api/subjects/${id}`).send({ periodId: randomUUID() })).status).toBe(
      400,
    );
    expect((await agent.patch(`/api/subjects/${id}`).send({ userId: randomUUID() })).status).toBe(
      400,
    );
    expect((await prisma.subject.findUniqueOrThrow({ where: { id } })).periodId).toBe(period.id);
  });

  it('refuses a rename that duplicates another subject of the period, but allows re-casing itself', async () => {
    const { agent, period } = await setup();
    await createSubject(agent, { periodId: period.id, name: 'Redes' });
    const { id } = (await createSubject(agent, { periodId: period.id, name: 'Bases' })).body
      .subject;

    const dup = await agent.patch(`/api/subjects/${id}`).send({ name: ' REDES ' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SUBJECT_ALREADY_EXISTS');

    const recase = await agent.patch(`/api/subjects/${id}`).send({ name: 'BASES' });
    expect(recase.status).toBe(200);
    expect(recase.body.subject.name).toBe('BASES');
  });

  it('validates fields on edit', async () => {
    const { agent, period } = await setup();
    const { id } = (await createSubject(agent, { periodId: period.id, name: 'Redes' })).body
      .subject;
    expect((await agent.patch(`/api/subjects/${id}`).send({ name: '  ' })).status).toBe(400);
    expect((await agent.patch(`/api/subjects/${id}`).send({ color: '#000000' })).status).toBe(400);
  });
});

describe('DELETE /api/subjects/:id', () => {
  it('deletes an own subject and it is gone afterwards', async () => {
    const { agent, period } = await setup();
    const { id } = (await createSubject(agent, { periodId: period.id, name: 'Redes' })).body
      .subject;

    expect((await agent.delete(`/api/subjects/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/subjects/${id}`)).status).toBe(404);
    expect((await agent.delete(`/api/subjects/${id}`)).status).toBe(404);
    expect(await prisma.subject.count()).toBe(0);
  });

  it('frees the name for reuse in the same period', async () => {
    const { agent, period } = await setup();
    const { id } = (await createSubject(agent, { periodId: period.id, name: 'Redes' })).body
      .subject;
    await agent.delete(`/api/subjects/${id}`).expect(204);
    await createSubject(agent, { periodId: period.id, name: 'Redes' }).expect(201);
  });
});
