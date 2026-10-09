import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, credentials, prisma, resetDb, setupUser } from '../../test/helpers.js';

/**
 * Performance SMOKE (not a benchmark): a realistic heavy account answers every screen's query in well under a
 * couple of seconds. The bounds are generous on purpose: they only catch accidental disasters (an N+1, a
 * quadratic loop). The measured medians are written to the PERF_REPORT file when it is set.
 */

const app = buildApp();
const report: string[] = [];
afterAll(async () => {
  if (process.env.PERF_REPORT) fs.writeFileSync(process.env.PERF_REPORT, report.join('\n') + '\n');
  await prisma.$disconnect();
});

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
async function measure(
  label: string,
  runs: number,
  call: () => Promise<request.Response>,
  limitMs: number,
) {
  await call(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await call();
    times.push(performance.now() - t0);
    expect(res.status, label).toBeLessThan(400);
  }
  const m = median(times);
  report.push(label + ': median ' + m.toFixed(1) + ' ms (n=' + runs + ')');
  expect(m, label).toBeLessThan(limitMs);
}

describe('a heavy account', () => {
  let agent: request.Agent;
  beforeAll(async () => {
    await resetDb();
    const u = await setupUser(app, credentials.email, 'Redes');
    agent = u.agent;
    const subjects = [u.subject.id];
    for (const name of ['Bases de Datos', 'Bioestadística', 'Epidemiología', 'Farmacología']) {
      subjects.push(
        (await agent.post('/api/subjects').send({ periodId: u.period.id, name })).body.subject.id,
      );
    }
    const statuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
    await prisma.activity.createMany({
      data: Array.from({ length: 500 }, (_, i) => {
        const status = statuses[i % 3]!;
        return {
          userId: u.user.id,
          periodId: u.period.id,
          subjectId: subjects[i % subjects.length]!,
          title: 'Actividad ' + i,
          type: (['TASK', 'EXAM', 'QUIZ', 'PROJECT', 'WORKSHOP'] as const)[i % 5]!,
          status,
          // Spread from 30 days ago to 120 days ahead, so every Radar band is populated.
          dueAt: new Date(Date.now() + ((i % 150) - 30) * 86_400_000 + i * 60_000),
          completedAt: status === 'COMPLETED' ? new Date() : null,
        };
      }),
    });
    for (let d = 0; d < 5; d++) {
      await agent.post('/api/schedule').send({
        type: 'CLASS',
        subjectId: subjects[d]!,
        title: 'Clase ' + d,
        date: '2026-08-0' + (3 + d),
        startTime: '0' + (7 + d) + ':00',
        endTime: '0' + (9 + d) + ':00',
        recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
      });
    }
  }, 120_000);

  it('answers every screen quickly with 500 activities', async () => {
    await measure(
      'GET /api/dashboard (500 activities)',
      12,
      () => agent.get('/api/dashboard') as never,
      800,
    );
    await measure(
      'GET /api/activities (500 activities)',
      12,
      () => agent.get('/api/activities') as never,
      800,
    );
    await measure(
      'GET /api/radar (500 activities)',
      12,
      () => agent.get('/api/radar') as never,
      800,
    );
    await measure(
      'GET /api/attention (500 activities)',
      12,
      () => agent.get('/api/attention') as never,
      800,
    );
    await measure(
      'GET /api/progress (500 activities)',
      12,
      () => agent.get('/api/progress') as never,
      800,
    );
    await measure(
      'GET /api/workload (500 activities)',
      12,
      () => agent.get('/api/workload') as never,
      800,
    );
    await measure(
      'GET /api/schedule (one week)',
      12,
      () => agent.get('/api/schedule?from=2026-10-05&to=2026-10-11') as never,
      800,
    );
  });

  it('parses a 5000-character message into up to 10 proposals, and a quick phrase, fast', async () => {
    const message = Array.from(
      { length: 40 },
      (_, i) =>
        'El martes tendremos parcial de Redes a las 10am y el viernes entregamos el taller de Bases ' +
        i +
        '.',
    )
      .join(' ')
      .slice(0, 4990);
    await measure(
      'POST /api/academic-inbox/parse (5000 chars)',
      8,
      () => agent.post('/api/academic-inbox/parse').send({ text: message }) as never,
      1000,
    );
    await measure(
      'POST /api/quick-capture/parse',
      12,
      () =>
        agent.post('/api/quick-capture/parse').send({ text: 'parcial redes martes 10am' }) as never,
      500,
    );
  });

  it('signing in costs one Argon2id verification', async () => {
    await measure(
      'POST /api/auth/login (Argon2id)',
      4,
      () =>
        request(app)
          .post('/api/auth/login')
          .send({ email: credentials.email, password: credentials.password }) as never,
      1500,
    );
  });
});
