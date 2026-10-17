import { randomUUID } from 'node:crypto';
import { resolveGrade, type CaptureConfirmEvaluation, type GradeSuggestion } from '@planner/core';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const NOW = new Date('2026-10-14T15:00:00.000Z'); // a Wednesday
const app: Express = buildApp({ clock: () => NOW });
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };

const post = async (a: Agent, path: string, data: object, status = 201) =>
  (await a.post(path).send(data).expect(status)).body;

/** A student with a study (home), a tracked period, and Farmacología 30/30/40 + Anatomía 50/50 with a pending "Parcial". */
async function world(email = 'ana@example.com') {
  const { agent, user } = await signUp(app, email);
  const study = (await post(agent, '/api/study-tracks', { name: 'Medicina', type: 'UNIVERSITY' }))
    .studyTrack;
  const period = (
    await post(agent, '/api/periods', {
      ...periodInput,
      startDate: '2026-08-03',
      endDate: '2026-12-20',
      studyTrackId: study.id,
    })
  ).period;
  const mk = async (name: string) =>
    (await post(agent, '/api/subjects', { periodId: period.id, name })).subject;
  const farma = await mk('Farmacología');
  const anatomia = await mk('Anatomía');
  const setup = async (subjectId: string, shares: number[], withScale: boolean) =>
    (
      await post(agent, `/api/subjects/${subjectId}/grading/setup`, {
        ...(withScale && { profile: SCALE }),
        gradingPeriods: shares.map((finalShareBp, i) => ({ name: `Corte ${i + 1}`, finalShareBp })),
      })
    ).gradingPeriods as { id: string; name: string }[];
  const farmaCuts = await setup(farma.id, [3000, 3000, 4000], true);
  const anatCuts = await setup(anatomia.id, [5000, 5000], false);
  const parcial = (
    await post(agent, '/api/evaluations', {
      subjectId: anatomia.id,
      gradingPeriodId: anatCuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 10_000,
    })
  ).evaluation as { id: string };
  return { agent, user, study, period, farma, anatomia, farmaCuts, anatCuts, parcial };
}

const parse = async (a: Agent, text: string) =>
  (await post(a, '/api/capture/parse', { text, mode: 'QUICK' }, 200)) as {
    capture: {
      proposals: {
        clientId: string;
        date: { value: string | null };
        subject: { kind: string; id?: string };
      }[];
    };
    grades: { suggestions: GradeSuggestion[] };
  };

/** What the client would send for the suggestions the engine left READY (or answered with `sel`). */
const evaluationsOf = (
  suggestions: GradeSuggestion[],
  sel: Record<string, object> = {},
): CaptureConfirmEvaluation[] =>
  suggestions.flatMap((s) => {
    const r = resolveGrade(s, sel[s.clientId] ?? {});
    return r.request ? [{ clientId: s.clientId, ...r.request } as CaptureConfirmEvaluation] : [];
  });
const confirm = (a: Agent, body: object) => a.post('/api/capture/confirm').send(body);

describe('parse: grades come with the capture', () => {
  it('a direct cut grade: ready, no activity proposed, subject and cut resolved within THAT subject', async () => {
    const w = await world();
    const res = await parse(w.agent, 'Saqué 4.3 en el Corte 2 de Farmacología');
    expect(res.capture.proposals).toEqual([]);
    expect(res.grades.suggestions).toHaveLength(1);
    const s = res.grades.suggestions[0]!;
    expect(s.status).toBe('READY');
    expect(resolveGrade(s, {}).request).toMatchObject({
      action: 'SET_CUT_GRADE',
      subjectId: w.farma.id,
      gradingPeriodId: w.farmaCuts[1]!.id,
      scoreMilli: 4300,
    });
  });

  it('without grade words nothing changes (grades empty, the activities as always)', async () => {
    const w = await world();
    const res = await parse(w.agent, 'Parcial de Anatomía el viernes');
    expect(res.grades.suggestions).toEqual([]);
    expect(res.capture.proposals).toHaveLength(1);
  });

  it('an evaluation with a date: one activity proposal AND one linked evaluation suggestion', async () => {
    const w = await world();
    const res = await parse(w.agent, 'Parcial 2 de Anatomía el viernes, vale 40% del Corte 1');
    expect(res.capture.proposals).toHaveLength(1);
    expect(res.capture.proposals[0]!.date.value).toBe('2026-10-16');
    const s = res.grades.suggestions[0]!;
    expect(s.activityClientId).toBe(res.capture.proposals[0]!.clientId);
    expect(resolveGrade(s, {}).request).toMatchObject({
      action: 'CREATE_EVALUATION',
      gradingPeriodId: w.anatCuts[0]!.id,
      periodShareBp: 4000,
      activityClientId: s.activityClientId,
    });
  });

  it('only sees the student’s own subjects (another account’s are not candidates)', async () => {
    const w = await world();
    const other = await world('b@example.com');
    const res = await parse(other.agent, 'Saqué 4.3 en el Corte 2 de Farmacología');
    expect(res.grades.suggestions[0]!.options.every((o) => o.subject.id !== w.farma.id)).toBe(true);
    expect(res.grades.suggestions[0]!.options.some((o) => o.subject.id === other.farma.id)).toBe(
      true,
    );
  });
});

describe('confirm: direct cut grades', () => {
  it('creates the grade of the cut (no name asked, the server names it) and shows up in the grades', async () => {
    const w = await world();
    const { grades } = await parse(w.agent, 'Saqué 4.3 en el Corte 2 de Farmacología');
    const res = await confirm(w.agent, {
      items: [],
      blocks: [],
      evaluations: evaluationsOf(grades.suggestions),
    }).expect(201);
    expect(res.body.evaluations).toHaveLength(1);
    expect(res.body.evaluations[0].evaluation).toMatchObject({
      isCutGrade: true,
      scoreMilli: 4300,
      periodShareBp: 10_000,
      name: 'Nota de Corte 2',
    });
    const g = (await w.agent.get(`/api/subjects/${w.farma.id}/grades`).expect(200)).body;
    expect(g.evaluations).toHaveLength(1);
    expect(g.summary.currentMilli).toBe(4300);
  });

  it('a second capture of the same cut is an UPDATE of what was seen; a stale one is refused, nothing overwritten', async () => {
    const w = await world();
    await post(w.agent, '/api/evaluations', {
      subjectId: w.farma.id,
      gradingPeriodId: w.farmaCuts[1]!.id,
      isCutGrade: true,
      scoreMilli: 3800,
    });
    const { grades } = await parse(w.agent, 'Saqué 4.3 en el Corte 2 de Farmacología');
    const request1 = evaluationsOf(grades.suggestions);
    expect(request1[0]).toMatchObject({ action: 'UPDATE_CUT_GRADE', expectScoreMilli: 3800 });
    // somebody changes the grade meanwhile
    const evId = (await w.agent.get(`/api/subjects/${w.farma.id}/grades`).expect(200)).body
      .evaluations[0].id;
    await w.agent.patch(`/api/evaluations/${evId}`).send({ scoreMilli: 4900 }).expect(200);
    const stale = await confirm(w.agent, { evaluations: request1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.items[0].code).toBe('STALE_EVALUATION');
    expect((await prisma.evaluation.findFirstOrThrow({ where: { id: evId } })).scoreMilli).toBe(
      4900,
    );
  });

  it('double confirm creates one grade, not two', async () => {
    const w = await world();
    const { grades } = await parse(w.agent, 'Saqué 4.3 en el Corte 2 de Farmacología');
    const body = { evaluations: evaluationsOf(grades.suggestions) };
    await confirm(w.agent, body).expect(201);
    const again = await confirm(w.agent, body);
    expect(again.status).toBe(409);
    expect(await prisma.evaluation.count({ where: { subjectId: w.farma.id } })).toBe(1);
  });

  it('simultaneous confirms: exactly one wins', async () => {
    const w = await world();
    const { grades } = await parse(w.agent, 'Saqué 4.3 en el Corte 2 de Farmacología');
    const body = { evaluations: evaluationsOf(grades.suggestions) };
    const results = await Promise.all([
      confirm(w.agent, body),
      confirm(w.agent, body),
      confirm(w.agent, body),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.evaluation.count({ where: { subjectId: w.farma.id } })).toBe(1);
  });

  it('a cut that is broken down refuses a direct grade (the rule of the grades screen), and nothing is saved', async () => {
    const w = await world();
    const res = await confirm(w.agent, {
      evaluations: [
        {
          clientId: 'g1',
          action: 'SET_CUT_GRADE',
          subjectId: w.anatomia.id,
          gradingPeriodId: w.anatCuts[0]!.id,
          scoreMilli: 4200,
        },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.items[0].code).toBe('EVALUATION_CONFLICT');
    expect(await prisma.evaluation.count({ where: { isCutGrade: true } })).toBe(0);
  });

  it('a cut of ANOTHER subject is refused (never silently used)', async () => {
    const w = await world();
    const res = await confirm(w.agent, {
      evaluations: [
        {
          clientId: 'g1',
          action: 'SET_CUT_GRADE',
          subjectId: w.farma.id,
          gradingPeriodId: w.anatCuts[1]!.id,
          scoreMilli: 4200,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.items[0].fields.gradingPeriodId).toBeDefined();
    expect(await prisma.evaluation.count({ where: { isCutGrade: true } })).toBe(0);
  });

  it('a grade outside the scale is refused', async () => {
    const w = await world();
    const res = await confirm(w.agent, {
      evaluations: [
        {
          clientId: 'g1',
          action: 'SET_CUT_GRADE',
          subjectId: w.farma.id,
          gradingPeriodId: w.farmaCuts[0]!.id,
          scoreMilli: 5001,
        },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe('confirm: scoring an existing pending evaluation', () => {
  it('"Saqué 4.2 en el parcial de Anatomía" scores the pending one — no duplicate', async () => {
    const w = await world();
    const { grades } = await parse(w.agent, 'Saqué 4.2 en el parcial de Anatomía');
    expect(grades.suggestions[0]!.status).toBe('READY');
    await confirm(w.agent, { evaluations: evaluationsOf(grades.suggestions) }).expect(201);
    const rows = await prisma.evaluation.findMany({ where: { subjectId: w.anatomia.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: w.parcial.id, scoreMilli: 4200 });
  });

  it('18 of 20 on a scale that starts at 0 keeps the points and the converted grade', async () => {
    const w = await world();
    const { grades } = await parse(w.agent, 'Saqué 18 de 20 en el parcial de Anatomía');
    await confirm(w.agent, { evaluations: evaluationsOf(grades.suggestions) }).expect(201);
    expect(
      await prisma.evaluation.findUniqueOrThrow({ where: { id: w.parcial.id } }),
    ).toMatchObject({ scoreMilli: 4500, rawEarnedMilli: 18_000, rawMaxMilli: 20_000 });
  });

  it('if the evaluation was graded meanwhile, the score is not overwritten', async () => {
    const w = await world();
    const { grades } = await parse(w.agent, 'Saqué 4.2 en el parcial de Anatomía');
    const body = { evaluations: evaluationsOf(grades.suggestions) };
    await w.agent.patch(`/api/evaluations/${w.parcial.id}`).send({ scoreMilli: 3500 }).expect(200);
    const res = await confirm(w.agent, body);
    expect(res.status).toBe(409);
    expect(res.body.error.details.items[0].code).toBe('STALE_EVALUATION');
    expect(
      (await prisma.evaluation.findUniqueOrThrow({ where: { id: w.parcial.id } })).scoreMilli,
    ).toBe(3500);
  });

  it('an evaluation of another subject, or a foreign one, is the same refusal as a missing one', async () => {
    const w = await world();
    const other = await world('b@example.com');
    const forged = (evaluationId: string) =>
      confirm(w.agent, {
        evaluations: [
          {
            clientId: 'g1',
            action: 'SCORE_EVALUATION',
            subjectId: w.anatomia.id,
            evaluationId,
            expectScoreMilli: null,
            scoreMilli: 4000,
          },
        ],
      });
    const foreign = await forged(other.parcial.id);
    const missing = await forged(randomUUID());
    const wrongSubject = await confirm(w.agent, {
      evaluations: [
        {
          clientId: 'g1',
          action: 'SCORE_EVALUATION',
          subjectId: w.farma.id,
          evaluationId: w.parcial.id,
          expectScoreMilli: null,
          scoreMilli: 4000,
        },
      ],
    });
    for (const r of [foreign, missing, wrongSubject]) {
      expect(r.status).toBe(409);
      expect(r.body.error.details.items[0].code).toBe('STALE_EVALUATION');
    }
    expect(foreign.body).toEqual({ ...missing.body, error: { ...missing.body.error } });
    expect(
      (await prisma.evaluation.findUniqueOrThrow({ where: { id: other.parcial.id } })).scoreMilli,
    ).toBeNull();
  });

  it('a foreign subject id is the same answer as a missing one', async () => {
    const w = await world();
    const other = await world('b@example.com');
    const send = (subjectId: string) =>
      confirm(w.agent, {
        evaluations: [
          {
            clientId: 'g1',
            action: 'SET_CUT_GRADE',
            subjectId,
            gradingPeriodId: other.farmaCuts[0]!.id,
            scoreMilli: 4000,
          },
        ],
      });
    const a = await send(other.farma.id);
    const b = await send(randomUUID());
    expect(a.status).toBe(b.status);
    expect(a.body.error.details.items[0].code).toBe('SUBJECT_NOT_FOUND');
    expect(b.body.error.details.items[0].code).toBe('SUBJECT_NOT_FOUND');
  });
});

describe('confirm: activity + evaluation, atomically', () => {
  const text = 'Parcial 2 de Anatomía el viernes, vale 40% del Corte 1';
  const request = async (w: Awaited<ReturnType<typeof world>>, room = true) => {
    // the pending Parcial of the cut leaves 50 % free and a different name
    if (room)
      await w.agent
        .patch(`/api/evaluations/${w.parcial.id}`)
        .send({ name: 'Taller', periodShareBp: 5000 })
        .expect(200);
    const res = await parse(w.agent, text);
    const p = res.capture.proposals[0]!;
    const items = [
      {
        clientId: p.clientId,
        title: 'Parcial 2',
        type: 'EXAM',
        priority: 'MEDIUM',
        dueDate: p.date.value!,
        subject: { kind: 'EXISTING', subjectId: w.anatomia.id },
      },
    ];
    return { items, blocks: [], evaluations: evaluationsOf(res.grades.suggestions) };
  };

  it('one confirmation creates the activity AND the pending evaluation linked to it', async () => {
    const w = await world();
    const body = await request(w);
    const res = await confirm(w.agent, body).expect(201);
    expect(res.body.count).toBe(1);
    const activity = res.body.createdActivities[0].activity;
    const ev = res.body.evaluations[0].evaluation;
    expect(ev).toMatchObject({
      name: 'Parcial 2',
      periodShareBp: 4000,
      scoreMilli: null,
      activityId: activity.id,
      subjectId: w.anatomia.id,
    });
    expect(activity).not.toHaveProperty('scoreMilli'); // an Activity never gets a grade
  });

  it('if the evaluation is refused, the activity is NOT created (all or nothing)', async () => {
    const w = await world();
    const body = await request(w, false);
    // 40 % + the existing 100 % "Parcial" of that cut would pass 100 %
    const res = await confirm(w.agent, body);
    expect(res.status).toBe(400);
    expect(await prisma.activity.count()).toBe(0);
    expect(await prisma.evaluation.count({ where: { subjectId: w.anatomia.id } })).toBe(1); // only the original
  });

  it('double confirm: no second activity, no second evaluation', async () => {
    const w = await world();
    const body = await request(w);
    await confirm(w.agent, body).expect(201);
    const again = await confirm(w.agent, body);
    expect([400, 409]).toContain(again.status); // the copy of the activity and of the evaluation are both refused
    expect(await prisma.activity.count()).toBe(1);
    expect(await prisma.evaluation.count({ where: { subjectId: w.anatomia.id } })).toBe(2); // the original + one
  });

  it('an evaluation linked to an activity of ANOTHER subject is refused', async () => {
    const w = await world();
    const body = await request(w);
    body.items[0]!.subject = { kind: 'EXISTING', subjectId: w.farma.id } as never;
    const res = await confirm(w.agent, body);
    expect(res.status).toBe(409);
    expect(await prisma.activity.count()).toBe(0);
  });
  it('a new evaluation comes already scored: weight + score in one sentence, one confirmation', async () => {
    const w = await world();
    await w.agent
      .patch(`/api/evaluations/${w.parcial.id}`)
      .send({ name: 'Taller', periodShareBp: 5000 })
      .expect(200);
    const res = await parse(
      w.agent,
      'Parcial 2 de Anatomía el viernes, vale 40% del Corte 1 y saqué 18/20',
    );
    expect(res.capture.proposals).toHaveLength(1);
    const p = res.capture.proposals[0]!;
    const items = [
      {
        clientId: p.clientId,
        title: 'Parcial 2',
        type: 'EXAM',
        priority: 'MEDIUM',
        dueDate: p.date.value!,
        subject: { kind: 'EXISTING', subjectId: w.anatomia.id },
      },
    ];
    const out = await confirm(w.agent, {
      items,
      blocks: [],
      evaluations: evaluationsOf(res.grades.suggestions),
    }).expect(201);
    expect(out.body.evaluations[0].evaluation).toMatchObject({
      scoreMilli: 4500,
      rawEarnedMilli: 18_000,
      rawMaxMilli: 20_000,
      periodShareBp: 4000,
    });
    expect(out.body.evaluations[0].evaluation.activityId).toBe(
      out.body.createdActivities[0].activity.id,
    );
  });

  it('an invalid score on the new evaluation rolls the activity back', async () => {
    const w = await world();
    await w.agent
      .patch(`/api/evaluations/${w.parcial.id}`)
      .send({ name: 'Taller', periodShareBp: 5000 })
      .expect(200);
    const body = await request(w, false);
    body.evaluations = [{ ...body.evaluations[0]!, scoreMilli: 9000 } as never];
    const res = await confirm(w.agent, body);
    expect(res.status).toBe(400);
    expect(await prisma.activity.count()).toBe(0);
    expect(await prisma.evaluation.count({ where: { subjectId: w.anatomia.id } })).toBe(1);
  });

  it('an invalid activity rolls the scored evaluation back', async () => {
    const w = await world();
    await w.agent
      .patch(`/api/evaluations/${w.parcial.id}`)
      .send({ name: 'Taller', periodShareBp: 5000 })
      .expect(200);
    const body = await request(w);
    body.evaluations = [{ ...body.evaluations[0]!, scoreMilli: 4200 } as never];
    body.items[0]!.subject = { kind: 'EXISTING', subjectId: randomUUID() } as never;
    const res = await confirm(w.agent, body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.evaluation.count({ where: { subjectId: w.anatomia.id } })).toBe(1);
  });

  it('the contract refuses an activityClientId that is not an item of the request, and a client-chosen user or period', async () => {
    const w = await world();
    const bad = await confirm(w.agent, {
      evaluations: [
        {
          clientId: 'g1',
          action: 'CREATE_EVALUATION',
          subjectId: w.anatomia.id,
          gradingPeriodId: w.anatCuts[0]!.id,
          name: 'X',
          periodShareBp: 1000,
          activityClientId: 'nope',
        },
      ],
    });
    expect(bad.status).toBe(400);
    for (const extra of [{ userId: randomUUID() }, { periodId: w.period.id }]) {
      const res = await confirm(w.agent, {
        evaluations: [
          {
            clientId: 'g1',
            action: 'SET_CUT_GRADE',
            subjectId: w.farma.id,
            gradingPeriodId: w.farmaCuts[0]!.id,
            scoreMilli: 4000,
            ...extra,
          },
        ],
      });
      expect(res.status).toBe(400);
    }
  });
});
