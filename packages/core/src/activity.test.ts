import { describe, expect, it } from 'vitest';
import {
  createActivitySchema,
  isOverdue,
  listActivitiesQuerySchema,
  resolveCompletedAt,
  updateActivitySchema,
  type ActivityStatus,
} from './activity.js';
import { dueFromLocal } from './time.js';

const at = (s: string) => new Date(s);
const subjectId = '0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11';

describe('isOverdue', () => {
  const due = '2026-10-10T19:00:00.000Z';
  const pending = { dueAt: due, status: 'PENDING' as ActivityStatus };

  it('is false before the deadline', () => {
    expect(isOverdue(pending, at('2026-10-10T18:59:59.999Z'))).toBe(false);
  });

  it('is false exactly at the deadline instant (strict <)', () => {
    expect(isOverdue(pending, at(due))).toBe(false);
  });

  it('is true one millisecond after the deadline', () => {
    expect(isOverdue(pending, at('2026-10-10T19:00:00.001Z'))).toBe(true);
  });

  it('applies to PENDING and IN_PROGRESS', () => {
    const later = at('2026-10-11T00:00:00.000Z');
    expect(isOverdue({ dueAt: due, status: 'PENDING' }, later)).toBe(true);
    expect(isOverdue({ dueAt: due, status: 'IN_PROGRESS' }, later)).toBe(true);
  });

  it('never applies to a COMPLETED activity, even long after the deadline', () => {
    expect(isOverdue({ dueAt: due, status: 'COMPLETED' }, at('2030-01-01T00:00:00.000Z'))).toBe(
      false,
    );
  });

  it('accepts Date or ISO string for dueAt', () => {
    const now = at('2026-10-11T00:00:00.000Z');
    expect(isOverdue({ dueAt: new Date(due), status: 'PENDING' }, now)).toBe(true);
    expect(isOverdue({ dueAt: due, status: 'PENDING' }, now)).toBe(true);
  });

  it('with hasTime=false a Bogotá deadline only expires after 23:59:59.999 local', () => {
    const { dueAt } = dueFromLocal({ date: '2026-10-10' }, 'America/Bogota'); // 2026-10-11T04:59:59.999Z
    const act = { dueAt, status: 'PENDING' as ActivityStatus };
    expect(isOverdue(act, at('2026-10-10T23:00:00.000Z'))).toBe(false); // 18:00 Bogotá, same day
    expect(isOverdue(act, at('2026-10-11T04:59:59.999Z'))).toBe(false); // the very last instant
    expect(isOverdue(act, at('2026-10-11T05:00:00.000Z'))).toBe(true); // 00:00 Bogotá next day
  });

  it('the same date is overdue at different moments for different zones', () => {
    const now = at('2026-10-11T00:30:00.000Z');
    const bogota = dueFromLocal({ date: '2026-10-10' }, 'America/Bogota').dueAt;
    const auckland = dueFromLocal({ date: '2026-10-10' }, 'Pacific/Auckland').dueAt;
    expect(isOverdue({ dueAt: bogota, status: 'PENDING' }, now)).toBe(false); // still the 10th at 19:30
    expect(isOverdue({ dueAt: auckland, status: 'PENDING' }, now)).toBe(true); // already the 11th at 13:30
  });
});

describe('resolveCompletedAt', () => {
  const now = at('2026-10-05T10:00:00.000Z');
  const earlier = at('2026-10-01T08:00:00.000Z');

  it('stamps now when an open activity becomes COMPLETED', () => {
    expect(resolveCompletedAt({ status: 'PENDING', completedAt: null }, 'COMPLETED', now)).toEqual(
      now,
    );
    expect(
      resolveCompletedAt({ status: 'IN_PROGRESS', completedAt: null }, 'COMPLETED', now),
    ).toEqual(now);
  });

  it('keeps the original stamp when it was already COMPLETED', () => {
    expect(
      resolveCompletedAt({ status: 'COMPLETED', completedAt: earlier }, 'COMPLETED', now),
    ).toEqual(earlier);
  });

  it('stamps now if a COMPLETED activity somehow has no stamp', () => {
    expect(
      resolveCompletedAt({ status: 'COMPLETED', completedAt: null }, 'COMPLETED', now),
    ).toEqual(now);
  });

  it('clears the stamp when leaving COMPLETED', () => {
    expect(
      resolveCompletedAt({ status: 'COMPLETED', completedAt: earlier }, 'PENDING', now),
    ).toBeNull();
    expect(
      resolveCompletedAt({ status: 'COMPLETED', completedAt: earlier }, 'IN_PROGRESS', now),
    ).toBeNull();
  });

  it('stays null between open states', () => {
    expect(
      resolveCompletedAt({ status: 'PENDING', completedAt: null }, 'IN_PROGRESS', now),
    ).toBeNull();
  });
});

describe('createActivitySchema', () => {
  const valid = { subjectId, title: 'Parcial 1', dueDate: '2026-10-10' };

  it('needs only title, subject and date; everything else has a default', () => {
    expect(createActivitySchema.parse(valid)).toMatchObject({
      title: 'Parcial 1',
      type: 'TASK',
      priority: 'MEDIUM',
    });
  });

  it('accepts the advanced options', () => {
    const out = createActivitySchema.parse({
      ...valid,
      dueTime: '14:00',
      type: 'EXAM',
      priority: 'HIGH',
      description: '  Capítulos 1 a 3 ',
    });
    expect(out).toMatchObject({
      dueTime: '14:00',
      type: 'EXAM',
      priority: 'HIGH',
      description: 'Capítulos 1 a 3',
    });
  });

  it.each([
    ['empty title', { title: '   ' }, 'title'],
    ['title over 150', { title: 'x'.repeat(151) }, 'title'],
    ['invalid subjectId', { subjectId: 'nope' }, 'subjectId'],
    ['unknown type', { type: 'HOMEWORK' }, 'type'],
    ['unknown priority', { priority: 'URGENT' }, 'priority'],
    ['impossible date', { dueDate: '2026-02-30' }, 'dueDate'],
    ['malformed date', { dueDate: '10/10/2026' }, 'dueDate'],
    ['invalid time', { dueTime: '25:00' }, 'dueTime'],
    ['time without zero padding', { dueTime: '9:00' }, 'dueTime'],
    ['description over 2000', { description: 'x'.repeat(2001) }, 'description'],
  ])('rejects %s', (_l, patch, field) => {
    const res = createActivitySchema.safeParse({ ...valid, ...patch });
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });

  it('rejects userId, status and any other unknown key', () => {
    for (const extra of [
      { userId: subjectId },
      { status: 'COMPLETED' },
      { completedAt: null },
      { periodId: subjectId },
    ]) {
      expect(createActivitySchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });
});

describe('updateActivitySchema', () => {
  it('distinguishes omitted from cleared fields', () => {
    expect(updateActivitySchema.parse({ title: 'X' })).toEqual({ title: 'X' });
    expect(updateActivitySchema.parse({ dueTime: null })).toEqual({ dueTime: null });
    expect(updateActivitySchema.parse({ dueTime: '' })).toEqual({ dueTime: null });
    expect(updateActivitySchema.parse({ description: '' })).toEqual({ description: null });
  });

  it('accepts status and rejects invalid ones', () => {
    expect(updateActivitySchema.parse({ status: 'COMPLETED' })).toEqual({ status: 'COMPLETED' });
    expect(updateActivitySchema.safeParse({ status: 'DONE' }).success).toBe(false);
  });

  it('rejects userId and completedAt (the client never sets them)', () => {
    expect(updateActivitySchema.safeParse({ userId: subjectId }).success).toBe(false);
    expect(
      updateActivitySchema.safeParse({ completedAt: '2026-01-01T00:00:00.000Z' }).success,
    ).toBe(false);
  });
});

describe('listActivitiesQuerySchema', () => {
  it('parses filters from the query string', () => {
    expect(
      listActivitiesQuerySchema.parse({
        status: 'PENDING',
        overdue: 'true',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).toEqual({ status: 'PENDING', overdue: true, from: '2026-10-01', to: '2026-10-31' });
    expect(listActivitiesQuerySchema.parse({ overdue: 'false' }).overdue).toBe(false);
    expect(listActivitiesQuerySchema.parse({})).toEqual({});
  });

  it.each([
    [{ status: 'DONE' }],
    [{ priority: 'URGENT' }],
    [{ type: 'X' }],
    [{ overdue: 'yes' }],
    [{ subjectId: 'nope' }],
    [{ from: '2026-13-01' }],
    [{ from: '2026-10-10', to: '2026-10-01' }],
  ])('rejects %j', (query) => {
    expect(listActivitiesQuerySchema.safeParse(query).success).toBe(false);
  });
});
