import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES, type ActivityStatus, type ActivityType } from './activity.js';
import {
  AUTO_REMINDER_OFFSETS,
  buildAutoReminderTimes,
  checkManualRemindAt,
  createReminderSchema,
  formatReminderOffset,
  getDefaultReminderOffsets,
  markSeenSchema,
  planReminderChange,
  reminderMessage,
  updateReminderSchema,
} from './reminders.js';
import { dueFromLocal, toLocalParts } from './time.js';

const BOGOTA = 'America/Bogota';
const at = (s: string) => new Date(s);
const NOW = at('2026-10-05T17:00:00.000Z'); // Monday 12:00 in Bogotá
/** An activity due on `date` (+ optional `time`) in Bogotá. */
const due = (
  date: string,
  time?: string,
  type: ActivityType = 'TASK',
  status: ActivityStatus = 'PENDING',
) => ({
  type,
  status,
  dueAt: dueFromLocal({ date, time }, BOGOTA).dueAt,
});
const offsets = (r: { offsetMinutes: number }[]) => r.map((x) => x.offsetMinutes);

describe('default offsets per activity type', () => {
  it.each([
    ['TASK', [-1440, -180]],
    ['EXAM', [-4320, -1440, -180]],
    ['QUIZ', [-1440, -180]],
    ['PROJECT', [-10080, -4320, -1440]],
    ['PRESENTATION', [-4320, -1440]],
    ['WORKSHOP', [-1440, -180]],
    ['READING', [-1440]],
    ['OTHER', [-1440]],
  ] as const)('%s -> %j', (type, expected) => {
    expect(getDefaultReminderOffsets(type)).toEqual(expected);
  });

  it('covers every activity type, with only negative offsets, earliest warning first', () => {
    for (const type of ACTIVITY_TYPES) {
      const list = AUTO_REMINDER_OFFSETS[type];
      expect(list.length, type).toBeGreaterThan(0);
      expect(list.every((o) => o < 0)).toBe(true);
      expect([...list].sort((a, b) => a - b)).toEqual([...list]);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('buildAutoReminderTimes', () => {
  it.each(ACTIVITY_TYPES)(
    'a far-away %s gets every default reminder, at dueAt + offset',
    (type) => {
      const activity = due('2026-12-01', '10:00', type);
      const times = buildAutoReminderTimes(activity, NOW);
      expect(offsets(times)).toEqual([...getDefaultReminderOffsets(type)]);
      for (const t of times)
        expect(t.remindAt.getTime()).toBe(activity.dueAt.getTime() + t.offsetMinutes * 60_000);
    },
  );

  it('an EXAM yields its three reminders at the expected Bogotá wall-clock times', () => {
    const times = buildAutoReminderTimes(due('2026-10-12', '10:00', 'EXAM'), NOW); // Monday 10:00
    expect(times.map((t) => t.remindAt.toISOString())).toEqual([
      '2026-10-09T15:00:00.000Z', // Friday 10:00 (3 days before)
      '2026-10-11T15:00:00.000Z', // Sunday 10:00 (1 day before)
      '2026-10-12T12:00:00.000Z', // Monday 07:00 (3 hours before)
    ]);
  });

  it('a close deadline only keeps the reminders that still lie in the future', () => {
    // Due tomorrow 14:00: 3 days before is long gone; 1 day before is today 14:00, still ahead of 12:00.
    const times = buildAutoReminderTimes(due('2026-10-06', '14:00', 'EXAM'), NOW);
    expect(offsets(times)).toEqual([-1440, -180]); // -4320 is already in the past; -1440 is today 14:00 > now 12:00
  });

  it('due in 2 hours: neither "1 day" nor "3 hours" before still makes sense', () => {
    expect(buildAutoReminderTimes(due('2026-10-05', '14:00', 'TASK'), NOW)).toEqual([]);
  });

  it('due in 5 hours: the 3-hour reminder survives, the 1-day one does not', () => {
    expect(offsets(buildAutoReminderTimes(due('2026-10-05', '17:00', 'TASK'), NOW))).toEqual([
      -180,
    ]);
  });

  it('never creates a reminder exactly at now (remindAt must be strictly in the future)', () => {
    const exactly = {
      type: 'TASK' as const,
      status: 'PENDING' as const,
      dueAt: new Date(NOW.getTime() + 180 * 60_000),
    };
    expect(buildAutoReminderTimes(exactly, NOW)).toEqual([]); // 3 h before == now
    const justAfter = { ...exactly, dueAt: new Date(exactly.dueAt.getTime() + 1) };
    expect(offsets(buildAutoReminderTimes(justAfter, NOW))).toEqual([-180]);
  });

  it('an already overdue activity gets none, and neither one due exactly now', () => {
    expect(buildAutoReminderTimes(due('2026-10-01', '10:00', 'EXAM'), NOW)).toEqual([]);
    expect(buildAutoReminderTimes({ type: 'EXAM', status: 'PENDING', dueAt: NOW }, NOW)).toEqual(
      [],
    );
  });

  it('a completed activity gets none', () => {
    expect(buildAutoReminderTimes(due('2026-12-01', '10:00', 'EXAM', 'COMPLETED'), NOW)).toEqual(
      [],
    );
  });

  it('IN_PROGRESS is treated like PENDING', () => {
    expect(
      offsets(buildAutoReminderTimes(due('2026-12-01', '10:00', 'TASK', 'IN_PROGRESS'), NOW)),
    ).toEqual([-1440, -180]);
  });

  describe('timezone and activities without a time', () => {
    it('without a time the deadline is the END of the local day, so "1 day before" is 23:59 of the day before', () => {
      const activity = due('2026-10-16', undefined, 'READING'); // Friday, no time
      const [reminder] = buildAutoReminderTimes(activity, NOW);
      expect(toLocalParts(reminder!.remindAt, BOGOTA)).toEqual({
        date: '2026-10-15',
        time: '23:59',
      }); // Thursday 23:59
      expect(toLocalParts(activity.dueAt, BOGOTA)).toEqual({ date: '2026-10-16', time: '23:59' });
    });

    it('the same local deadline in another zone is a different instant, and so are its reminders', () => {
      const bogota = buildAutoReminderTimes(due('2026-12-01', '10:00', 'READING'), NOW)[0]!;
      const tokyoActivity = {
        type: 'READING' as const,
        status: 'PENDING' as const,
        dueAt: dueFromLocal({ date: '2026-12-01', time: '10:00' }, 'Asia/Tokyo').dueAt,
      };
      const tokyo = buildAutoReminderTimes(tokyoActivity, NOW)[0]!;
      expect(tokyo.remindAt.getTime()).not.toBe(bogota.remindAt.getTime());
      // Both are "the day before at 10:00" on their own wall clock.
      expect(toLocalParts(bogota.remindAt, BOGOTA)).toEqual({ date: '2026-11-30', time: '10:00' });
      expect(toLocalParts(tokyo.remindAt, 'Asia/Tokyo')).toEqual({
        date: '2026-11-30',
        time: '10:00',
      });
    });

    it('offsets are absolute minutes: across a daylight-saving change the wall clock moves by an hour (documented)', () => {
      const ny = 'America/New_York';
      const dueAt = dueFromLocal({ date: '2026-03-09', time: '09:00' }, ny).dueAt; // EDT, the day after the change
      const [reminder] = buildAutoReminderTimes(
        { type: 'READING', status: 'PENDING', dueAt },
        at('2026-03-01T00:00:00Z'),
      );
      expect(reminder!.remindAt.getTime()).toBe(dueAt.getTime() - 24 * 3_600_000);
      expect(toLocalParts(reminder!.remindAt, ny)).toEqual({ date: '2026-03-08', time: '09:00' });
    });
  });
});

describe('planReminderChange: only the deadline, the type and COMPLETED matter', () => {
  const base = due('2026-12-01', '10:00', 'TASK');
  const plan = (prev: typeof base, next: Partial<typeof base>) =>
    planReminderChange(prev, { ...prev, ...next });

  it('a new deadline recomputes the AUTO reminders', () => {
    expect(plan(base, { dueAt: due('2026-12-02', '10:00').dueAt })).toEqual({
      cancelPending: false,
      reviveManual: false,
      regenerateAuto: true,
    });
  });

  it('the same deadline instant changes nothing', () => {
    expect(plan(base, { dueAt: new Date(base.dueAt) })).toEqual({
      cancelPending: false,
      reviveManual: false,
      regenerateAuto: false,
    });
  });

  it('a new type recomputes them (the rules differ per type)', () => {
    expect(plan(base, { type: 'EXAM' })).toMatchObject({
      regenerateAuto: true,
      cancelPending: false,
    });
  });

  it('PENDING <-> IN_PROGRESS changes nothing', () => {
    expect(plan(base, { status: 'IN_PROGRESS' })).toEqual({
      cancelPending: false,
      reviveManual: false,
      regenerateAuto: false,
    });
    expect(planReminderChange({ ...base, status: 'IN_PROGRESS' }, base)).toEqual({
      cancelPending: false,
      reviveManual: false,
      regenerateAuto: false,
    });
  });

  it('finishing cancels the pending reminders and recomputes nothing', () => {
    expect(plan(base, { status: 'COMPLETED' })).toEqual({
      cancelPending: true,
      reviveManual: false,
      regenerateAuto: false,
    });
    expect(plan({ ...base, status: 'IN_PROGRESS' }, { status: 'COMPLETED' }).cancelPending).toBe(
      true,
    );
  });

  it('changes to an activity that stays finished do nothing (not even a new deadline)', () => {
    const done = { ...base, status: 'COMPLETED' as const };
    expect(plan(done, { dueAt: due('2026-12-09', '10:00').dueAt, type: 'EXAM' })).toEqual({
      cancelPending: false,
      reviveManual: false,
      regenerateAuto: false,
    });
  });

  it('reopening revives manual ones and recomputes AUTO, to PENDING or to IN_PROGRESS', () => {
    const done = { ...base, status: 'COMPLETED' as const };
    for (const status of ['PENDING', 'IN_PROGRESS'] as const) {
      expect(plan(done, { status })).toEqual({
        cancelPending: false,
        reviveManual: true,
        regenerateAuto: true,
      });
    }
  });
});

describe('checkManualRemindAt', () => {
  const dueAt = at('2026-10-12T15:00:00.000Z');

  it('accepts a time in the future and before the deadline', () => {
    expect(checkManualRemindAt(at('2026-10-10T15:00:00.000Z'), dueAt, NOW)).toBeNull();
    expect(checkManualRemindAt(at('2026-10-12T14:59:59.999Z'), dueAt, NOW)).toBeNull();
  });

  it('rejects the deadline itself and anything after it', () => {
    expect(checkManualRemindAt(dueAt, dueAt, NOW)).toBe('NOT_BEFORE_DUE');
    expect(checkManualRemindAt(at('2026-10-13T00:00:00.000Z'), dueAt, NOW)).toBe('NOT_BEFORE_DUE');
  });

  it('rejects now and the past', () => {
    expect(checkManualRemindAt(NOW, dueAt, NOW)).toBe('IN_THE_PAST');
    expect(checkManualRemindAt(at('2026-10-01T00:00:00.000Z'), dueAt, NOW)).toBe('IN_THE_PAST');
  });
});

describe('wording', () => {
  it.each([
    [-1440, '1 día antes'],
    [-4320, '3 días antes'],
    [-10080, '7 días antes'],
    [-180, '3 horas antes'],
    [-60, '1 hora antes'],
    [-45, '45 minutos antes'],
    [-1, '1 minuto antes'],
  ])('%i -> %s', (offset, text) => {
    expect(formatReminderOffset(offset)).toBe(text);
  });

  it('builds the message from the activity, in the user’s timezone', () => {
    const dueAt = dueFromLocal({ date: '2026-10-06', time: '10:00' }, BOGOTA).dueAt;
    const msg = (now: Date) =>
      reminderMessage({ title: 'Parcial de Redes', dueAt, hasTime: true }, now, BOGOTA);
    expect(msg(NOW)).toMatch(/^Parcial de Redes vence mañana a las 10:00/);
    expect(msg(NOW)).toMatch(/a\. m\.$/);
    expect(msg(NOW)).not.toMatch(/\.\.$/); // one period, not "a. m.."
    expect(msg(at('2026-10-06T12:00:00.000Z'))).toMatch(/^Parcial de Redes vence hoy a las 10:00/); // 07:00 Bogotá, same day
    expect(msg(at('2026-10-09T17:00:00.000Z'))).toMatch(/venció hace 3 días/);
  });

  it('omits the hour when the activity has no time, and follows a renamed activity', () => {
    const dueAt = dueFromLocal({ date: '2026-10-09' }, BOGOTA).dueAt;
    expect(reminderMessage({ title: 'Taller', dueAt, hasTime: false }, NOW, BOGOTA)).toBe(
      'Taller vence en 4 días.',
    );
    expect(reminderMessage({ title: 'Taller final', dueAt, hasTime: false }, NOW, BOGOTA)).toBe(
      'Taller final vence en 4 días.',
    );
  });
});

describe('input schemas', () => {
  const activityId = '0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11';

  it('create: activity, local date and time; nothing else', () => {
    expect(
      createReminderSchema.safeParse({ activityId, remindDate: '2026-10-10', remindTime: '09:30' })
        .success,
    ).toBe(true);
    for (const extra of [
      { userId: activityId },
      { kind: 'AUTO' },
      { status: 'SHOWN' },
      { remindAt: '2026-10-10T14:30:00Z' },
      { offsetMinutes: -60 },
    ]) {
      expect(
        createReminderSchema.safeParse({
          activityId,
          remindDate: '2026-10-10',
          remindTime: '09:30',
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    [{ remindDate: '2026-02-30', remindTime: '09:00' }],
    [{ remindDate: '2026-10-10', remindTime: '9:00' }],
    [{ remindTime: undefined }],
    [{ remindDate: undefined }],
    [{ activityId: 'nope', remindDate: '2026-10-10', remindTime: '09:00' }],
  ])('create rejects %j', (patch) => {
    expect(
      createReminderSchema.safeParse({
        activityId,
        remindDate: '2026-10-10',
        remindTime: '09:00',
        ...patch,
      }).success,
    ).toBe(false);
  });

  it('update: date and time, nothing else', () => {
    expect(
      updateReminderSchema.safeParse({ remindDate: '2026-10-10', remindTime: '09:30' }).success,
    ).toBe(true);
    expect(
      updateReminderSchema.safeParse({
        remindDate: '2026-10-10',
        remindTime: '09:30',
        kind: 'MANUAL',
      }).success,
    ).toBe(false);
    expect(updateReminderSchema.safeParse({ remindDate: '2026-10-10' }).success).toBe(false);
  });

  it('mark seen: a non-empty, bounded list of ids', () => {
    expect(markSeenSchema.safeParse({ ids: [activityId] }).success).toBe(true);
    expect(markSeenSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(markSeenSchema.safeParse({ ids: ['nope'] }).success).toBe(false);
    expect(
      markSeenSchema.safeParse({ ids: Array.from({ length: 41 }, () => activityId) }).success,
    ).toBe(false);
    expect(markSeenSchema.safeParse({ ids: [activityId], userId: activityId }).success).toBe(false);
  });
});
