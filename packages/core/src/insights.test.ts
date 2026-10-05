import { describe, expect, it } from 'vitest';
import {
  buildProgress,
  buildWeeklyWorkload,
  calculateSubjectProgress,
  dueFromLocal,
  formatDuration,
  progressSchema,
  selectBusiestDay,
  workloadQuerySchema,
  workloadSchema,
  zonedTimeToUtc,
  type ScheduleBlockType,
  type SubjectProgressInput,
  type WorkloadActivity,
  type WorkloadDay,
  type WorkloadOccurrence,
} from './index.js';

const BOGOTA = 'America/Bogota';
const TOKYO = 'Asia/Tokyo';
const MONDAY = '2026-10-05';

const counts = (pending: number, inProgress: number, completed: number) => ({
  pending,
  inProgress,
  completed,
});

describe('calculateSubjectProgress', () => {
  it('no activities: 0 %, but total is 0 so a screen can tell "no data" from "0 of 5"', () => {
    const p = calculateSubjectProgress(counts(0, 0, 0), 0);
    expect(p).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      overdue: 0,
      percentage: 0,
    });
  });

  it('5 activities (2 completed, 2 pending, 1 in progress) is 40 %', () => {
    const p = calculateSubjectProgress(counts(2, 1, 2), 0);
    expect(p).toMatchObject({ total: 5, completed: 2, pending: 2, inProgress: 1, percentage: 40 });
  });

  it('keeps the Dashboard rounding: 1/3 -> 33, 2/3 -> 67, 199/200 -> 99, 1/300 -> 1, all -> 100', () => {
    expect(calculateSubjectProgress(counts(2, 0, 1), 0).percentage).toBe(33);
    expect(calculateSubjectProgress(counts(1, 0, 2), 0).percentage).toBe(67);
    expect(calculateSubjectProgress(counts(1, 0, 199), 0).percentage).toBe(99);
    expect(calculateSubjectProgress(counts(299, 0, 1), 0).percentage).toBe(1);
    expect(calculateSubjectProgress(counts(0, 0, 4), 0).percentage).toBe(100);
  });

  it('an overdue activity stays in pending/inProgress and is reported separately: it never changes the percentage', () => {
    const withOverdue = calculateSubjectProgress(counts(3, 1, 4), 2);
    const without = calculateSubjectProgress(counts(3, 1, 4), 0);
    expect(withOverdue.overdue).toBe(2);
    expect(withOverdue.pending).toBe(3);
    expect(withOverdue.total).toBe(8);
    expect(withOverdue.percentage).toBe(without.percentage);
  });

  it('is unweighted: only the number of finished activities counts', () => {
    // The function does not even receive priority, type or subject.
    expect(calculateSubjectProgress.length).toBe(2);
    expect(calculateSubjectProgress(counts(5, 0, 5), 0).percentage).toBe(50);
  });
});

describe('buildProgress', () => {
  const subject = (
    id: string,
    name: string,
    c: ReturnType<typeof counts>,
    overdue = 0,
  ): SubjectProgressInput => ({
    id,
    name,
    color: '#3366FF',
    counts: c,
    overdue,
  });

  it('computes each subject on its own and the general progress from all of them', () => {
    const { general, subjects } = buildProgress([
      subject('b', 'Bases de Datos', counts(5, 0, 1), 2), // 1 of 6
      subject('r', 'Redes', counts(1, 0, 3), 0), // 3 of 4
      subject('v', 'Vacía', counts(0, 0, 0)),
    ]);
    expect(subjects.map((s) => [s.name, s.total, s.completed, s.percentage])).toEqual([
      ['Bases de Datos', 6, 1, 17],
      ['Redes', 4, 3, 75],
      ['Vacía', 0, 0, 0],
    ]);
    expect(general).toMatchObject({
      total: 10,
      completed: 4,
      pending: 6,
      overdue: 2,
      percentage: 40,
    });
  });

  it('keeps a subject without activities in the list, with total 0', () => {
    const { subjects } = buildProgress([subject('a', 'Sin nada', counts(0, 0, 0))]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]!.total).toBe(0);
  });

  it('sorts alphabetically (accents and case ignored), never by progress, with the id as the last resort', () => {
    const { subjects } = buildProgress([
      subject('3', 'redes', counts(0, 0, 9)),
      subject('1', 'Álgebra', counts(9, 0, 0)),
      subject('2', 'Bases', counts(0, 0, 5)),
      subject('5', 'Física', counts(1, 0, 0)),
      subject('4', 'Física', counts(1, 0, 0)),
    ]);
    expect(subjects.map((s) => s.id)).toEqual(['1', '2', '4', '5', '3']);
  });

  it('is independent of the input order and does not mutate it', () => {
    const input = [subject('a', 'Z', counts(1, 0, 0)), subject('b', 'A', counts(0, 0, 1))];
    const copy = JSON.stringify(input);
    expect(buildProgress(input)).toEqual(buildProgress([...input].reverse()));
    expect(JSON.stringify(input)).toBe(copy);
  });

  it('an empty period has no subjects and 0 %', () => {
    const { general, subjects } = buildProgress([]);
    expect(subjects).toEqual([]);
    expect(general).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      overdue: 0,
      percentage: 0,
    });
  });
});

// Activities are built from the local day and time a student would type.
const activity = (
  date: string,
  status: WorkloadActivity['status'] = 'PENDING',
  time = '10:00',
  tz = BOGOTA,
) => ({
  dueAt: dueFromLocal({ date, time }, tz).dueAt,
  status,
});
const occurrence = (
  date: string,
  startTime: string,
  endTime: string,
  type: ScheduleBlockType = 'CLASS',
  tz = BOGOTA,
): WorkloadOccurrence => ({
  occurrenceDate: date,
  startAt: zonedTimeToUtc(
    { date, hour: Number(startTime.slice(0, 2)), minute: Number(startTime.slice(3)) },
    tz,
  ),
  endAt: zonedTimeToUtc(
    { date, hour: Number(endTime.slice(0, 2)), minute: Number(endTime.slice(3)) },
    tz,
  ),
  type,
});
const workload = (
  activities: WorkloadActivity[],
  occurrences: WorkloadOccurrence[],
  timeZone = BOGOTA,
  weekFrom = MONDAY,
) => buildWeeklyWorkload({ weekFrom, activities, occurrences, timeZone });

describe('buildWeeklyWorkload: a controlled week', () => {
  // Monday: 1 activity + 2 classes (08-10 and 10-11:30). Tuesday: 1 study block (14-16).
  // Wednesday: 2 activities + 1 class (08-10).
  const week = workload(
    [activity('2026-10-05'), activity('2026-10-07'), activity('2026-10-07', 'COMPLETED')],
    [
      occurrence('2026-10-05', '08:00', '10:00'),
      occurrence('2026-10-05', '10:00', '11:30'),
      occurrence('2026-10-06', '14:00', '16:00', 'STUDY'),
      occurrence('2026-10-07', '08:00', '10:00'),
    ],
  );

  it('totals', () => {
    expect(week.week).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(week.totals).toEqual({
      activityCount: 3,
      activitiesByStatus: { pending: 2, inProgress: 0, completed: 1 },
      openActivityCount: 2,
      classCount: 3,
      studyBlockCount: 1,
      otherAcademicBlockCount: 0,
      scheduleOccurrenceCount: 4,
      totalCommitments: 7,
      scheduledMinutes: 120 + 90 + 120 + 120,
    });
  });

  it('per day, Monday to Sunday', () => {
    expect(
      week.days.map((d) => [
        d.weekday,
        d.activityCount,
        d.scheduleCount,
        d.scheduledMinutes,
        d.totalCommitments,
      ]),
    ).toEqual([
      [1, 1, 2, 210, 3],
      [2, 0, 1, 120, 1],
      [3, 2, 1, 120, 3],
      [4, 0, 0, 0, 0],
      [5, 0, 0, 0, 0],
      [6, 0, 0, 0, 0],
      [7, 0, 0, 0, 0],
    ]);
    expect(week.days.map((d) => d.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('the busiest day: Monday and Wednesday tie on commitments (3), Monday has more scheduled minutes', () => {
    expect(week.busiestDay).toEqual({
      date: '2026-10-05',
      weekday: 1,
      totalCommitments: 3,
      scheduledMinutes: 210,
    });
  });

  it('the day totals add up to the week totals', () => {
    const sum = (pick: (d: WorkloadDay) => number) => week.days.reduce((a, d) => a + pick(d), 0);
    expect(sum((d) => d.totalCommitments)).toBe(week.totals.totalCommitments);
    expect(sum((d) => d.scheduledMinutes)).toBe(week.totals.scheduledMinutes);
    expect(sum((d) => d.activityCount)).toBe(week.totals.activityCount);
    expect(sum((d) => d.scheduleCount)).toBe(week.totals.scheduleOccurrenceCount);
  });

  it('is deterministic and independent of the input order', () => {
    const a = [activity('2026-10-05'), activity('2026-10-07')];
    const o = [
      occurrence('2026-10-05', '08:00', '10:00'),
      occurrence('2026-10-06', '14:00', '16:00', 'STUDY'),
    ];
    expect(workload(a, o)).toEqual(workload([...a].reverse(), [...o].reverse()));
  });
});

describe('what counts as an activity of the week', () => {
  it('a completed activity of the week still counts, broken down by status', () => {
    const w = workload(
      [
        activity('2026-10-06', 'COMPLETED'),
        activity('2026-10-06', 'IN_PROGRESS'),
        activity('2026-10-06', 'PENDING'),
      ],
      [],
    );
    expect(w.totals.activityCount).toBe(3);
    expect(w.totals.activitiesByStatus).toEqual({ pending: 1, inProgress: 1, completed: 1 });
    expect(w.totals.openActivityCount).toBe(2);
  });

  it('an activity overdue from ANOTHER week does not count here just for being open', () => {
    const w = workload([activity('2026-09-20'), activity('2026-10-14')], []);
    expect(w.totals.activityCount).toBe(0);
    expect(w.totals.totalCommitments).toBe(0);
  });

  it('adds one commitment and no hours: an activity has no known duration', () => {
    const w = workload([activity('2026-10-08'), activity('2026-10-08')], []);
    expect(w.totals.totalCommitments).toBe(2);
    expect(w.totals.scheduledMinutes).toBe(0);
    expect(w.days[3]!.scheduledMinutes).toBe(0);
  });

  it('week boundaries are local: Monday 00:00 is in, the previous Sunday 23:59:59.999 and the next Monday 00:00 are out', () => {
    const at = (date: string, time: string) => ({
      dueAt: zonedTimeToUtc(
        { date, hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) },
        BOGOTA,
      ),
      status: 'PENDING' as const,
    });
    const endOfPreviousSunday = new Date(at('2026-10-05', '00:00').dueAt.getTime() - 1);
    const startOfNextMonday = at('2026-10-12', '00:00').dueAt;
    const endOfSunday = new Date(startOfNextMonday.getTime() - 1);
    const w = workload(
      [
        at('2026-10-05', '00:00'),
        { dueAt: endOfSunday, status: 'PENDING' },
        { dueAt: endOfPreviousSunday, status: 'PENDING' },
        { dueAt: startOfNextMonday, status: 'PENDING' },
      ],
      [],
    );
    expect(w.totals.activityCount).toBe(2);
    expect(w.days[0]!.activityCount).toBe(1); // Monday 00:00
    expect(w.days[6]!.activityCount).toBe(1); // Sunday 23:59:59.999
  });

  it('the same instant belongs to different weeks depending on the user’s timezone', () => {
    // Sunday 11 Oct 20:00 in Bogotá is Monday 12 Oct 10:00 in Tokyo.
    const dueAt = dueFromLocal({ date: '2026-10-11', time: '20:00' }, BOGOTA).dueAt;
    const a = [{ dueAt, status: 'PENDING' as const }];
    expect(workload(a, [], BOGOTA, '2026-10-05').totals.activityCount).toBe(1);
    expect(workload(a, [], TOKYO, '2026-10-05').totals.activityCount).toBe(0);
    expect(workload(a, [], TOKYO, '2026-10-12').days[0]!.activityCount).toBe(1);
  });
});

describe('what counts as agenda', () => {
  it('each occurrence counts, split by type', () => {
    const w = workload(
      [],
      [
        occurrence('2026-10-05', '08:00', '10:00', 'CLASS'),
        occurrence('2026-10-07', '08:00', '10:00', 'CLASS'),
        occurrence('2026-10-08', '14:00', '15:00', 'STUDY'),
        occurrence('2026-10-09', '16:00', '17:00', 'ACADEMIC_PERSONAL'),
      ],
    );
    expect(w.totals).toMatchObject({
      classCount: 2,
      studyBlockCount: 1,
      otherAcademicBlockCount: 1,
      scheduleOccurrenceCount: 4,
      totalCommitments: 4,
      scheduledMinutes: 120 + 120 + 60 + 60,
    });
  });

  it('an occurrence outside the week is ignored', () => {
    const w = workload(
      [],
      [
        occurrence('2026-10-04', '08:00', '10:00'),
        occurrence('2026-10-12', '08:00', '10:00'),
        occurrence('2026-10-06', '08:00', '09:00'),
      ],
    );
    expect(w.totals.scheduleOccurrenceCount).toBe(1);
    expect(w.totals.scheduledMinutes).toBe(60);
  });

  it('overlapping occurrences all count: nothing is merged or subtracted', () => {
    const w = workload(
      [],
      [
        occurrence('2026-10-05', '08:00', '10:00'),
        occurrence('2026-10-05', '09:00', '11:00', 'STUDY'),
      ],
    );
    expect(w.totals.scheduleOccurrenceCount).toBe(2);
    expect(w.totals.scheduledMinutes).toBe(240); // not 180
    expect(w.days[0]!.totalCommitments).toBe(2);
  });

  it('sums the minutes of every occurrence: 08-10 and 10-11:30 are 210', () => {
    const w = workload(
      [],
      [occurrence('2026-10-05', '08:00', '10:00'), occurrence('2026-10-05', '10:00', '11:30')],
    );
    expect(w.totals.scheduledMinutes).toBe(210);
  });

  it('an occurrence that ends after midnight belongs, with all its minutes, to the day it starts', () => {
    const night: WorkloadOccurrence = {
      occurrenceDate: '2026-10-06',
      startAt: zonedTimeToUtc({ date: '2026-10-06', hour: 22, minute: 0 }, BOGOTA),
      endAt: zonedTimeToUtc({ date: '2026-10-07', hour: 1, minute: 0 }, BOGOTA),
      type: 'STUDY',
    };
    const w = workload([], [night]);
    expect(w.days[1]!.scheduledMinutes).toBe(180);
    expect(w.days[2]!.scheduledMinutes).toBe(0);
  });

  it('minutes are real elapsed time: a 01:00-04:00 block on the night clocks go forward lasts 120 min', () => {
    const tz = 'America/New_York'; // 8 Mar 2026: 02:00 -> 03:00
    const w = buildWeeklyWorkload({
      weekFrom: '2026-03-02',
      activities: [],
      timeZone: tz,
      occurrences: [occurrence('2026-03-08', '01:00', '04:00', 'STUDY', tz)],
    });
    expect(w.totals.scheduledMinutes).toBe(120);
    // An ordinary 08:00-10:00 class the same day is still 120 minutes: the recurrence keeps the wall clock.
    const normal = buildWeeklyWorkload({
      weekFrom: '2026-03-02',
      activities: [],
      timeZone: tz,
      occurrences: [occurrence('2026-03-08', '08:00', '10:00', 'CLASS', tz)],
    });
    expect(normal.totals.scheduledMinutes).toBe(120);
  });
});

describe('selectBusiestDay', () => {
  const day = (
    weekday: number,
    activityCount: number,
    scheduleCount: number,
    minutes: number,
  ): WorkloadDay => ({
    date: `2026-10-${String(4 + weekday).padStart(2, '0')}`,
    weekday: weekday as WorkloadDay['weekday'],
    activityCount,
    scheduleCount,
    scheduledMinutes: minutes,
    totalCommitments: activityCount + scheduleCount,
  });

  it('the most commitments wins', () => {
    expect(selectBusiestDay([day(1, 1, 1, 600), day(2, 3, 1, 0), day(3, 0, 2, 900)])!.weekday).toBe(
      2,
    );
  });

  it('tie on commitments: more scheduled minutes wins', () => {
    expect(selectBusiestDay([day(1, 1, 1, 60), day(2, 0, 2, 240), day(3, 2, 0, 0)])!.weekday).toBe(
      2,
    );
  });

  it('total tie: the earliest day of the week', () => {
    expect(
      selectBusiestDay([day(1, 0, 0, 0), day(3, 1, 1, 120), day(5, 1, 1, 120), day(7, 2, 0, 120)])!
        .weekday,
    ).toBe(3);
    expect(selectBusiestDay([day(4, 2, 0, 0), day(2, 2, 0, 0)])!.weekday).toBe(4); // days arrive in week order, first of equals
  });

  it('a week without commitments has no busiest day', () => {
    expect(selectBusiestDay([day(1, 0, 0, 0), day(2, 0, 0, 0)])).toBeNull();
    expect(workload([], []).busiestDay).toBeNull();
  });

  it('reports its figures', () => {
    expect(selectBusiestDay([day(3, 2, 1, 150)])).toEqual({
      date: '2026-10-07',
      weekday: 3,
      totalCommitments: 3,
      scheduledMinutes: 150,
    });
  });
});

describe('formatDuration', () => {
  it.each([
    [750, '12 h 30 min'],
    [120, '2 h'],
    [60, '1 h'],
    [45, '45 min'],
    [0, '0 min'],
    [61, '1 h 1 min'],
    [-5, '0 min'],
  ])('%i -> %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe('schemas', () => {
  it('the workload query takes any real date, or nothing', () => {
    expect(workloadQuerySchema.parse({}).week).toBeUndefined();
    expect(workloadQuerySchema.parse({ week: '2026-10-07' }).week).toBe('2026-10-07');
    for (const bad of ['2026-02-30', 'hoy', '07/10/2026', '']) {
      expect(workloadQuerySchema.safeParse({ week: bad }).success, bad).toBe(false);
    }
  });

  it('a built workload and progress satisfy the response schemas', () => {
    const w = workload([activity('2026-10-05')], [occurrence('2026-10-05', '08:00', '10:00')]);
    const ok = { generatedAt: new Date().toISOString(), period: null, ...w };
    expect(workloadSchema.safeParse(ok).success).toBe(true);
    expect(workloadSchema.safeParse({ ...ok, days: ok.days.slice(0, 6) }).success).toBe(false);

    const { general, subjects } = buildProgress([]);
    expect(
      progressSchema.safeParse({
        generatedAt: new Date().toISOString(),
        period: null,
        general,
        subjects,
      }).success,
    ).toBe(true);
  });
});
