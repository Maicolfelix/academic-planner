import { describe, expect, it } from 'vitest';
import { listSubjectsQuerySchema } from './academic.js';
import {
  createActivitySchema,
  activitySchema,
  listActivitiesQuerySchema,
  updateActivitySchema,
} from './activity.js';
import { attentionSchema } from './attention.js';
import { dashboardSchema } from './dashboard.js';
import { progressSchema, workloadSchema } from './insights.js';
import { radarSchema } from './radar.js';
import { dueReminderSchema } from './reminders.js';
import {
  currentPeriodContextSchema,
  currentPeriodsResponseSchema,
  studyTrackRefSchema,
} from './studyTrack.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const period = {
  id: U(1),
  name: 'P',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId: U(2),
  studyLevel: null,
  studyLevelNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const study = { id: U(2), name: 'Medicina', type: 'UNIVERSITY', isPrimary: true };

describe('the descriptor of a current period (the one shared shape)', () => {
  it('a period with its study, or with none (a general period)', () => {
    expect(currentPeriodContextSchema.safeParse({ period, studyTrack: study }).success).toBe(true);
    expect(
      currentPeriodContextSchema.safeParse({
        period: { ...period, studyTrackId: null },
        studyTrack: null,
      }).success,
    ).toBe(true);
    expect(currentPeriodContextSchema.safeParse({ period }).success).toBe(false);
  });

  it('the study reference says only what a label needs: no owner, status or program key', () => {
    expect(Object.keys(studyTrackRefSchema.shape).sort()).toEqual([
      'id',
      'isPrimary',
      'name',
      'type',
    ]);
    expect(studyTrackRefSchema.safeParse({ ...study, type: 'PERSONAL' }).success).toBe(false);
  });

  it('the list answer', () => {
    expect(currentPeriodsResponseSchema.safeParse({ periods: [] }).success).toBe(true);
    expect(
      currentPeriodsResponseSchema.safeParse({ periods: [{ period, studyTrack: study }] }).success,
    ).toBe(true);
  });
});

describe('every summary keeps its HOME `period` and adds `periods`', () => {
  const both = (schema: { shape: Record<string, unknown> }) =>
    expect(Object.keys(schema.shape)).toEqual(expect.arrayContaining(['period', 'periods']));

  it('dashboard, radar, attention and workload', () => {
    both(dashboardSchema);
    both(radarSchema);
    both(attentionSchema);
    both(workloadSchema);
  });

  it('progress keeps `period` and `general`, and adds the split by period and the period of each subject', () => {
    expect(Object.keys(progressSchema.shape)).toEqual(
      expect.arrayContaining(['period', 'general', 'byPeriod', 'subjects']),
    );
    const summary = {
      total: 4,
      pending: 2,
      inProgress: 0,
      completed: 2,
      overdue: 0,
      percentage: 50,
    };
    const ok = {
      generatedAt: '2026-10-05T17:00:00.000Z',
      period,
      general: summary,
      byPeriod: [{ period, studyTrack: study, general: summary }],
      subjects: [{ id: U(3), periodId: U(1), name: 'Redes', color: '#3B82F6', ...summary }],
    };
    expect(progressSchema.safeParse(ok).success).toBe(true);
    expect(progressSchema.safeParse({ ...ok, byPeriod: undefined }).success).toBe(false);
    expect(
      progressSchema.safeParse({
        ...ok,
        subjects: [{ id: U(3), name: 'Redes', color: '#3B82F6', ...summary }],
      }).success,
    ).toBe(false);
  });
});

describe('the read scope of a list is a name, not a list of ids', () => {
  it('scope=current is the only scope; anything else is refused, and no list of periods exists', () => {
    expect(listActivitiesQuerySchema.parse({ scope: 'current' }).scope).toBe('current');
    expect(listActivitiesQuerySchema.safeParse({ scope: 'all' }).success).toBe(false);
    expect(listActivitiesQuerySchema.safeParse({ scope: '' }).success).toBe(false);
    expect(Object.keys(listActivitiesQuerySchema.parse({ periodIds: U(1), userId: U(2) }))).toEqual(
      [],
    ); // ignored, not read
    expect(listSubjectsQuerySchema.parse({ scope: 'current' }).scope).toBe('current');
    expect(listSubjectsQuerySchema.safeParse({ scope: 'all' }).success).toBe(false);
    expect(listSubjectsQuerySchema.parse({ periodId: U(1) })).toEqual({ periodId: U(1) });
  });

  it('subjects: a period OR the scope, never both (a valid parameter is not silently ignored); neither keeps working', () => {
    expect(listSubjectsQuerySchema.safeParse({ scope: 'current', periodId: U(1) }).success).toBe(
      false,
    );
    expect(listSubjectsQuerySchema.parse({})).toEqual({});
    expect(listSubjectsQuerySchema.safeParse({ scope: 'current' }).success).toBe(true);
    expect(listSubjectsQuerySchema.safeParse({ periodId: U(1) }).success).toBe(true);
  });

  it('a scope and a period can be combined (the period only narrows: the server ANDs them)', () => {
    expect(listActivitiesQuerySchema.parse({ scope: 'current', periodId: U(1) })).toEqual({
      scope: 'current',
      periodId: U(1),
    });
  });
});

describe('an activity carries its period, read-only', () => {
  const activity = {
    id: U(5),
    periodId: U(1),
    subjectId: null,
    title: 'T',
    description: null,
    type: 'TASK',
    priority: 'MEDIUM',
    status: 'PENDING',
    dueAt: '2026-10-08T15:00:00.000Z',
    hasTime: false,
    completedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  it('the public shape has it (and never a study id)', () => {
    expect(activitySchema.safeParse(activity).success).toBe(true);
    const without: Partial<typeof activity> = { ...activity };
    delete without.periodId;
    expect(activitySchema.safeParse(without).success).toBe(false);
    expect(Object.keys(activitySchema.shape)).not.toContain('studyTrackId');
  });

  it('but a request can never send it, and a study id is just as refused', () => {
    expect(
      createActivitySchema.safeParse({ title: 'T', dueDate: '2026-10-08', periodId: U(1) }).success,
    ).toBe(false);
    expect(
      createActivitySchema.safeParse({ title: 'T', dueDate: '2026-10-08', studyTrackId: U(2) })
        .success,
    ).toBe(false);
    expect(updateActivitySchema.safeParse({ periodId: U(1) }).success).toBe(false);
  });

  it('a due reminder tells the period of its activity', () => {
    const base = {
      id: U(6),
      activityId: U(5),
      remindAt: '2026-10-05T10:00:00.000Z',
      kind: 'AUTO',
      status: 'PENDING',
      offsetMinutes: -1440,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      subject: null,
    };
    const activityPart = {
      id: U(5),
      title: 'T',
      type: 'EXAM',
      dueAt: '2026-10-06T15:00:00.000Z',
      hasTime: true,
    };
    expect(
      dueReminderSchema.safeParse({ ...base, activity: { ...activityPart, periodId: U(1) } })
        .success,
    ).toBe(true);
    expect(dueReminderSchema.safeParse({ ...base, activity: activityPart }).success).toBe(false);
  });
});
