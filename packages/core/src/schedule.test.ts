import { describe, expect, it } from 'vitest';
import { addDays, weekdayOf } from './calendar.js';
import {
  blocksOverlap,
  createScheduleBlockSchema,
  expandBlock,
  findConflicts,
  markOverlaps,
  scheduleQuerySchema,
  updateScheduleBlockSchema,
  type ScheduleBlockLike,
} from './schedule.js';
import { dueFromLocal, toLocalParts, zonedTimeToUtc } from './time.js';

const BOGOTA = 'America/Bogota';

/** A block whose first occurrence is `date` from `start` to `end` (local wall clock). */
function block(
  date: string,
  start: string,
  end: string,
  until: string | null = null,
  tz = BOGOTA,
  bounds?: { from: string; to: string },
): ScheduleBlockLike {
  const at = (time: string) => dueFromLocal({ date, time }, tz).dueAt;
  return { startAt: at(start), endAt: at(end), recurrenceUntil: until, bounds };
}

const dates = (occ: { date: string }[]) => occ.map((o) => o.date);
const localTimes = (occ: { startAt: Date; endAt: Date }[], tz: string) =>
  occ.map((o) => `${toLocalParts(o.startAt, tz).time}-${toLocalParts(o.endAt, tz).time}`);

describe('blocksOverlap', () => {
  const span = (s: string, e: string) => block('2026-10-06', s, e);

  it('08–10 vs 09–11 clash', () => {
    expect(blocksOverlap(span('08:00', '10:00'), span('09:00', '11:00'))).toBe(true);
  });

  it('08–10 vs 10–12 do NOT clash (touching edges)', () => {
    expect(blocksOverlap(span('08:00', '10:00'), span('10:00', '12:00'))).toBe(false);
    expect(blocksOverlap(span('10:00', '12:00'), span('08:00', '10:00'))).toBe(false);
  });

  it('one inside the other, and identical blocks, clash', () => {
    expect(blocksOverlap(span('08:00', '12:00'), span('09:00', '10:00'))).toBe(true);
    expect(blocksOverlap(span('08:00', '10:00'), span('08:00', '10:00'))).toBe(true);
  });

  it('separate blocks do not clash', () => {
    expect(blocksOverlap(span('08:00', '09:00'), span('13:00', '14:00'))).toBe(false);
  });

  it('a minute of overlap is enough', () => {
    expect(blocksOverlap(span('08:00', '10:01'), span('10:00', '12:00'))).toBe(true);
  });
});

describe('expandBlock — single blocks', () => {
  it('appears only in a range that contains its day', () => {
    const b = block('2026-10-07', '14:00', '15:00'); // Wednesday
    const inside = expandBlock(b, { from: '2026-10-05', to: '2026-10-11' }, BOGOTA);
    expect(dates(inside)).toEqual(['2026-10-07']);
    expect(localTimes(inside, BOGOTA)).toEqual(['14:00-15:00']);
    expect(expandBlock(b, { from: '2026-10-12', to: '2026-10-18' }, BOGOTA)).toEqual([]);
    expect(expandBlock(b, { from: '2026-09-28', to: '2026-10-04' }, BOGOTA)).toEqual([]);
  });

  it('is included on the first and last day of the range (inclusive bounds)', () => {
    const b = block('2026-10-05', '08:00', '09:00');
    expect(expandBlock(b, { from: '2026-10-05', to: '2026-10-05' }, BOGOTA)).toHaveLength(1);
    expect(expandBlock(b, { from: '2026-10-01', to: '2026-10-05' }, BOGOTA)).toHaveLength(1);
  });

  it('keeps the LOCAL day even when the UTC day is different (late evening in Bogotá)', () => {
    const b = block('2026-10-06', '22:00', '23:00'); // 03:00Z–04:00Z on the 7th
    expect(b.startAt.toString()).not.toBe('');
    expect(dates(expandBlock(b, { from: '2026-10-06', to: '2026-10-06' }, BOGOTA))).toEqual([
      '2026-10-06',
    ]);
    expect(expandBlock(b, { from: '2026-10-07', to: '2026-10-07' }, BOGOTA)).toEqual([]);
  });
});

describe('expandBlock — weekly series', () => {
  // Redes: Tuesdays 08:00–10:00 from 4 August to 28 November 2026.
  const redes = block('2026-08-04', '08:00', '10:00', '2026-11-28');

  it('returns only the Tuesday of the requested week', () => {
    const week = expandBlock(redes, { from: '2026-10-05', to: '2026-10-11' }, BOGOTA);
    expect(dates(week)).toEqual(['2026-10-06']);
    expect(localTimes(week, BOGOTA)).toEqual(['08:00-10:00']);
    expect(weekdayOf(week[0]!.date)).toBe(2);
    expect(week[0]!.startAt.toISOString()).toBe('2026-10-06T13:00:00.000Z');
    expect(week[0]!.endAt.toISOString()).toBe('2026-10-06T15:00:00.000Z');
  });

  it('returns several weeks for a longer range', () => {
    const month = expandBlock(redes, { from: '2026-10-01', to: '2026-10-31' }, BOGOTA);
    expect(dates(month)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });

  it('returns nothing for a week without that weekday in range', () => {
    expect(
      expandBlock(redes, { from: '2026-10-07', to: '2026-10-13' }, BOGOTA).map((o) => o.date),
    ).toEqual(['2026-10-13']);
    expect(expandBlock(redes, { from: '2026-10-07', to: '2026-10-12' }, BOGOTA)).toEqual([]);
  });

  it('does not start before its first occurrence', () => {
    expect(expandBlock(redes, { from: '2026-07-01', to: '2026-08-03' }, BOGOTA)).toEqual([]);
    expect(dates(expandBlock(redes, { from: '2026-07-01', to: '2026-08-11' }, BOGOTA))).toEqual([
      '2026-08-04',
      '2026-08-11',
    ]);
  });

  it('stops at `until`, inclusive of that exact day', () => {
    // `until` falls on a Tuesday here: the last class IS on that day.
    const toTuesday = block('2026-10-06', '08:00', '10:00', '2026-10-20');
    const all = expandBlock(toTuesday, { from: '2026-10-01', to: '2026-12-31' }, BOGOTA);
    expect(dates(all)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20']);
    // One day earlier excludes the last one.
    const dayBefore = block('2026-10-06', '08:00', '10:00', '2026-10-19');
    expect(dates(expandBlock(dayBefore, { from: '2026-10-01', to: '2026-12-31' }, BOGOTA))).toEqual(
      ['2026-10-06', '2026-10-13'],
    );
  });

  it('a range after the end of the series is empty', () => {
    expect(expandBlock(redes, { from: '2026-11-30', to: '2026-12-06' }, BOGOTA)).toEqual([]);
    expect(dates(expandBlock(redes, { from: '2026-11-23', to: '2026-12-06' }, BOGOTA))).toEqual([
      '2026-11-24',
    ]);
  });

  it('covers the whole semester when asked, without gaps (17 Tuesdays)', () => {
    const all = expandBlock(redes, { from: '2026-01-01', to: '2026-12-31' }, BOGOTA);
    expect(all).toHaveLength(17);
    expect(all[0]!.date).toBe('2026-08-04');
    expect(all.at(-1)!.date).toBe('2026-11-24');
    for (let i = 1; i < all.length; i++) expect(all[i]!.date).toBe(addDays(all[i - 1]!.date, 7));
  });

  describe('period bounds', () => {
    it('clamps a series whose first occurrence is BEFORE the period', () => {
      const early = block('2026-07-28', '08:00', '10:00', '2026-11-28', BOGOTA, {
        from: '2026-08-03',
        to: '2026-11-28',
      });
      const all = expandBlock(early, { from: '2026-07-01', to: '2026-12-31' }, BOGOTA);
      expect(all[0]!.date).toBe('2026-08-04'); // 28 July and nothing before the period start
    });

    it('clamps a series whose `until` is AFTER the period', () => {
      const long = block('2026-08-04', '08:00', '10:00', '2027-03-30', BOGOTA, {
        from: '2026-08-03',
        to: '2026-11-28',
      });
      const all = expandBlock(long, { from: '2026-01-01', to: '2027-12-31' }, BOGOTA);
      expect(all.at(-1)!.date).toBe('2026-11-24');
    });

    it('stays aligned to the original weekday when the start is clamped', () => {
      const early = block('2026-07-28', '08:00', '10:00', '2026-11-28', BOGOTA, {
        from: '2026-08-05',
        to: '2026-11-28',
      });
      expect(dates(expandBlock(early, { from: '2026-07-01', to: '2026-08-20' }, BOGOTA))).toEqual([
        '2026-08-11',
        '2026-08-18',
      ]);
    });
  });

  describe('weekday extremes and calendar changes', () => {
    it('Monday and Sunday series', () => {
      const monday = block('2026-10-05', '07:00', '09:00', '2026-10-30');
      const sunday = block('2026-10-11', '18:00', '19:00', '2026-10-30');
      const week = { from: '2026-10-12', to: '2026-10-18' };
      expect(dates(expandBlock(monday, week, BOGOTA))).toEqual(['2026-10-12']);
      expect(dates(expandBlock(sunday, week, BOGOTA))).toEqual(['2026-10-18']);
    });

    it('crosses a month change', () => {
      const thursdays = block('2026-10-01', '10:00', '11:00', '2026-11-30');
      expect(
        dates(expandBlock(thursdays, { from: '2026-10-26', to: '2026-11-08' }, BOGOTA)),
      ).toEqual(['2026-10-29', '2026-11-05']);
    });

    it('crosses a year change', () => {
      const fridays = block('2026-12-04', '10:00', '11:00', '2027-02-26');
      expect(dates(expandBlock(fridays, { from: '2026-12-21', to: '2027-01-10' }, BOGOTA))).toEqual(
        ['2026-12-25', '2027-01-01', '2027-01-08'],
      );
    });

    it('handles 29 February', () => {
      const tuesdays = block('2028-02-01', '08:00', '09:00', '2028-03-31');
      expect(
        dates(expandBlock(tuesdays, { from: '2028-02-25', to: '2028-03-07' }, BOGOTA)),
      ).toEqual(['2028-02-29', '2028-03-07']);
    });
  });
});

describe('expandBlock — timezones and daylight saving (the wall clock is what repeats)', () => {
  it('a Bogotá class is 08:00 there every week, regardless of any other zone', () => {
    const redes = block('2026-08-04', '08:00', '10:00', '2026-11-24');
    const occ = expandBlock(redes, { from: '2026-08-01', to: '2026-11-30' }, BOGOTA);
    expect(new Set(localTimes(occ, BOGOTA))).toEqual(new Set(['08:00-10:00']));
  });

  it.each([
    // zone, first Tuesday, until, week-by-week check straddling the zone's clock changes
    ['America/New_York', '2026-02-24', '2026-12-01'], // forward 8 Mar, back 1 Nov
    ['Europe/Madrid', '2026-03-03', '2026-11-03'], // forward 29 Mar, back 25 Oct
    ['Pacific/Auckland', '2026-03-03', '2026-11-03'], // back 5 Apr, forward 27 Sep (southern hemisphere)
    ['America/Los_Angeles', '2026-02-24', '2026-12-01'],
  ])('%s: 08:00 local on every Tuesday across both daylight-saving changes', (tz, first, until) => {
    const klass = block(first, '08:00', '10:00', until, tz);
    const occ = expandBlock(klass, { from: '2026-01-01', to: '2026-12-31' }, tz);

    expect(occ.length).toBeGreaterThan(30);
    expect(new Set(localTimes(occ, tz))).toEqual(new Set(['08:00-10:00']));
    expect(occ.every((o) => weekdayOf(o.date) === 2)).toBe(true);

    // The UTC instants are NOT a fixed 7 × 24 h apart: that is exactly what must not be used.
    const gaps = new Set(
      occ.slice(1).map((o, i) => (o.startAt.getTime() - occ[i]!.startAt.getTime()) / 3_600_000),
    );
    expect(gaps).toContain(168); // a normal week
    expect([...gaps].some((g) => g === 167 || g === 169)).toBe(true); // the week with the clock change
  });

  it('New York: the exact UTC instants around the spring-forward week', () => {
    const klass = block('2026-03-03', '08:00', '09:00', '2026-03-31', 'America/New_York');
    const occ = expandBlock(klass, { from: '2026-03-01', to: '2026-03-31' }, 'America/New_York');
    expect(occ.map((o) => o.startAt.toISOString())).toEqual([
      '2026-03-03T13:00:00.000Z', // EST (UTC-5)
      '2026-03-10T12:00:00.000Z', // EDT (UTC-4) after 8 March
      '2026-03-17T12:00:00.000Z',
      '2026-03-24T12:00:00.000Z',
      '2026-03-31T12:00:00.000Z',
    ]);
  });

  it('the same series viewed through another zone shifts as instants but not as wall clock', () => {
    const redes = block('2026-10-06', '08:00', '10:00', '2026-10-06');
    const [occ] = expandBlock(redes, { from: '2026-10-06', to: '2026-10-06' }, BOGOTA);
    expect(toLocalParts(occ!.startAt, BOGOTA).time).toBe('08:00');
    expect(toLocalParts(occ!.startAt, 'Asia/Tokyo').time).toBe('22:00'); // what a Tokyo browser would compute: never shown
  });

  it('the first occurrence of a series is exactly the stored instant', () => {
    const b = block('2026-10-06', '08:00', '10:00', '2026-11-24');
    const [first] = expandBlock(b, { from: '2026-10-06', to: '2026-10-06' }, BOGOTA);
    expect(first!.startAt.getTime()).toBe(new Date(b.startAt).getTime());
    expect(first!.endAt.getTime()).toBe(new Date(b.endAt).getTime());
    expect(first!.startAt.getTime()).toBe(
      zonedTimeToUtc({ date: '2026-10-06', hour: 8, minute: 0 }, BOGOTA).getTime(),
    );
  });
});

describe('findConflicts', () => {
  const tuesdayClass = (id: string, start: string, end: string) => ({
    id,
    ...block('2026-08-04', start, end, '2026-11-24'),
  });

  it('08–10 vs 09–11 on the same day: conflict', () => {
    const a = { id: 'a', ...block('2026-10-06', '08:00', '10:00') };
    const b = block('2026-10-06', '09:00', '11:00');
    const found = findConflicts(b, [a], BOGOTA);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ blockId: 'a', occurrences: 1 });
  });

  it('08–10 vs 10–12: no conflict', () => {
    const a = { id: 'a', ...block('2026-10-06', '08:00', '10:00') };
    expect(findConflicts(block('2026-10-06', '10:00', '12:00'), [a], BOGOTA)).toEqual([]);
  });

  it('different days: no conflict', () => {
    const a = { id: 'a', ...block('2026-10-06', '08:00', '10:00') };
    expect(findConflicts(block('2026-10-07', '08:00', '10:00'), [a], BOGOTA)).toEqual([]);
  });

  it('ignores the block itself when editing it', () => {
    const self = { id: 'a', ...block('2026-10-06', '08:00', '10:00') };
    expect(findConflicts({ ...self }, [self], BOGOTA)).toEqual([]);
    // …but still reports a different block at the same time.
    const other = { id: 'b', ...block('2026-10-06', '09:00', '10:00') };
    expect(findConflicts({ ...self }, [self, other], BOGOTA).map((c) => c.blockId)).toEqual(['b']);
  });

  it('weekly vs weekly: Redes Tue 08–10 against Bases Tue 09–11 clashes on every Tuesday', () => {
    const redes = tuesdayClass('redes', '08:00', '10:00');
    const bases = block('2026-08-04', '09:00', '11:00', '2026-11-24');
    const [conflict] = findConflicts(bases, [redes], BOGOTA);
    expect(conflict).toMatchObject({ blockId: 'redes', occurrences: 17 });
    expect(conflict!.first.date).toBe('2026-08-04');
  });

  it('weekly vs weekly on different weekdays or touching hours: no conflict', () => {
    const redes = tuesdayClass('redes', '08:00', '10:00');
    expect(
      findConflicts({ ...block('2026-08-05', '08:00', '10:00', '2026-11-25') }, [redes], BOGOTA),
    ).toEqual([]); // Wednesday
    expect(
      findConflicts({ ...block('2026-08-04', '10:00', '12:00', '2026-11-24') }, [redes], BOGOTA),
    ).toEqual([]); // 10-12
  });

  it('a single block that lands on one occurrence of a series clashes once', () => {
    const redes = tuesdayClass('redes', '08:00', '10:00');
    const meeting = block('2026-10-13', '09:30', '10:30'); // a Tuesday in the middle of the semester
    expect(findConflicts(meeting, [redes], BOGOTA)).toEqual([
      expect.objectContaining({ blockId: 'redes', occurrences: 1 }),
    ]);
    expect(findConflicts(block('2026-10-14', '09:30', '10:30'), [redes], BOGOTA)).toEqual([]); // Wednesday
  });

  it('a new series is checked against single blocks dated later in the semester', () => {
    const study = { id: 'study', ...block('2026-11-03', '08:30', '09:30') }; // a Tuesday
    const bases = block('2026-08-04', '09:00', '11:00', '2026-11-24');
    expect(findConflicts(bases, [study], BOGOTA)).toEqual([
      expect.objectContaining({ blockId: 'study', occurrences: 1 }),
    ]);
  });

  it('a series that ended before the candidate starts does not clash', () => {
    const old = { id: 'old', ...block('2026-02-03', '08:00', '10:00', '2026-06-02') };
    expect(
      findConflicts(block('2026-08-04', '08:00', '10:00', '2026-11-24'), [old], BOGOTA),
    ).toEqual([]);
  });

  it('the clash is judged on the local wall clock across daylight saving', () => {
    const tz = 'America/New_York';
    const a = { id: 'a', ...block('2026-03-03', '08:00', '10:00', '2026-03-31', tz) };
    const b = block('2026-03-03', '09:00', '11:00', '2026-03-31', tz);
    expect(findConflicts(b, [a], tz)[0]).toMatchObject({ occurrences: 5 }); // all 5 Tuesdays, before and after 8 March
  });
});

describe('markOverlaps', () => {
  it('flags only the occurrences that overlap another one', () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 6, h, m));
    const flags = markOverlaps([
      { startAt: at(13), endAt: at(15) }, // 13–15
      { startAt: at(14), endAt: at(16) }, // overlaps the first
      { startAt: at(16), endAt: at(17) }, // touches the second: fine
      { startAt: at(20), endAt: at(21) },
    ]);
    expect(flags).toEqual([true, true, false, false]);
  });
});

describe('createScheduleBlockSchema', () => {
  const valid = {
    type: 'CLASS',
    title: 'Redes',
    date: '2026-10-06',
    startTime: '08:00',
    endTime: '10:00',
  };

  it('accepts a single block and a weekly series', () => {
    expect(createScheduleBlockSchema.safeParse(valid).success).toBe(true);
    expect(
      createScheduleBlockSchema.safeParse({
        ...valid,
        recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['end before start', { startTime: '10:00', endTime: '08:00' }, 'endTime'],
    ['zero duration', { startTime: '08:00', endTime: '08:00' }, 'endTime'],
    ['empty title', { title: '  ' }, 'title'],
    ['title too long', { title: 'x'.repeat(101) }, 'title'],
    ['unknown type', { type: 'PARTY' }, 'type'],
    ['impossible date', { date: '2026-02-30' }, 'date'],
    ['bad time', { startTime: '8:00' }, 'startTime'],
    [
      'until before the first day',
      { recurrence: { frequency: 'WEEKLY', until: '2026-10-01' } },
      'recurrence',
    ],
    [
      'unknown frequency',
      { recurrence: { frequency: 'DAILY', until: '2026-11-28' } },
      'recurrence',
    ],
  ])('rejects %s', (_l, patch, field) => {
    const res = createScheduleBlockSchema.safeParse({ ...valid, ...patch });
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });

  it('rejects userId and any unknown key', () => {
    for (const extra of [
      { userId: 'x' },
      { startAt: '2026-10-06T13:00:00Z' },
      { recurrenceType: 'WEEKLY' },
    ]) {
      expect(createScheduleBlockSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });

  it('a block can never last 24 hours or more: end must be later the same day', () => {
    expect(
      createScheduleBlockSchema.safeParse({ ...valid, startTime: '00:00', endTime: '23:59' })
        .success,
    ).toBe(true);
  });
});

describe('updateScheduleBlockSchema and query', () => {
  it('update: partial, null clears the subject or the recurrence, periodId is not allowed', () => {
    expect(updateScheduleBlockSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(updateScheduleBlockSchema.parse({ recurrence: null })).toEqual({ recurrence: null });
    expect(updateScheduleBlockSchema.parse({ subjectId: null })).toEqual({ subjectId: null });
    expect(
      updateScheduleBlockSchema.safeParse({ periodId: '0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11' })
        .success,
    ).toBe(false);
    expect(updateScheduleBlockSchema.safeParse({ userId: 'x' }).success).toBe(false);
    expect(
      updateScheduleBlockSchema.safeParse({ startTime: '10:00', endTime: '09:00' }).success,
    ).toBe(false);
  });

  it('query: both days or none, ordered, at most 42 days', () => {
    expect(scheduleQuerySchema.safeParse({}).success).toBe(true);
    expect(scheduleQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-11' }).success).toBe(
      true,
    );
    expect(scheduleQuerySchema.safeParse({ from: '2026-10-05' }).success).toBe(false);
    expect(scheduleQuerySchema.safeParse({ from: '2026-10-11', to: '2026-10-05' }).success).toBe(
      false,
    );
    expect(scheduleQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-11' }).success).toBe(
      true,
    ); // 42 days
    expect(scheduleQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-12' }).success).toBe(
      false,
    ); // 43 days
    expect(scheduleQuerySchema.safeParse({ from: '2026-13-01', to: '2026-13-02' }).success).toBe(
      false,
    );
  });
});
