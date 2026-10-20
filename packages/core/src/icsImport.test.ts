import { describe, expect, it } from 'vitest';
import { proposeIcsEvents, ICS_MAX_COUNT, type IcsRawEvent } from './icsImport.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUBJECTS = [
  { id: U(1), name: 'Anatomía', periodId: U(100) },
  { id: U(2), name: 'Ciberseguridad', periodId: U(100) },
  { id: U(3), name: 'Ciberseguridad', periodId: U(200) },
];
const ctx = { subjects: SUBJECTS };
let seq = 0;
const ev = (over: Partial<IcsRawEvent> = {}): IcsRawEvent => ({
  index: ++seq,
  uid: `uid-${seq}`,
  summary: 'Evento',
  description: null,
  location: null,
  status: null,
  hasRecurrenceId: false,
  hasRdate: false,
  start: { allDay: false, date: '2026-10-23', time: '10:00' },
  end: { allDay: false, date: '2026-10-23', time: '11:00' },
  rrule: null,
  exdateCount: 0,
  ...over,
});
type Rule = Exclude<IcsRawEvent['rrule'], 'INVALID' | null>;
const weekly = (over: Partial<Rule> = {}): Rule => ({
  freq: 'WEEKLY',
  interval: 1,
  byday: [],
  until: null,
  count: null,
  other: false,
  ...over,
});
const one = (e: IcsRawEvent, subjects = ctx) => proposeIcsEvents([e], subjects).proposals;
const timed = (date: string, from: string, to: string) => ({
  start: { allDay: false as const, date, time: from },
  end: { allDay: false as const, date, time: to },
});

describe('a single event is an ACTIVITY', () => {
  it('timed: its date and time, the type from its words, the subject by a deterministic match', () => {
    const [p] = one(ev({ summary: 'Anatomía - Parcial 1' }));
    expect(p).toMatchObject({
      kindProposal: 'ACTIVITY',
      status: 'READY',
      date: '2026-10-23',
      startTime: '10:00',
      type: 'EXAM',
      selected: true,
    });
    expect(p!.subject).toMatchObject({ kind: 'EXISTING', id: U(1) });
  });
  it('all-day: the date as written, no time (nothing is shifted by a timezone)', () => {
    const [p] = one(
      ev({
        summary: 'Entrega final',
        start: { allDay: true, date: '2026-10-30' },
        end: { allDay: true, date: '2026-10-31' },
      }),
    );
    expect(p).toMatchObject({
      kindProposal: 'ACTIVITY',
      date: '2026-10-30',
      startTime: null,
      allDay: true,
    });
    expect(p!.warnings).toEqual([]); // one all-day = DTEND the next day: not "multi-day"
  });
  it('a multi-day event keeps its start date and says so', () => {
    const [p] = one(
      ev({
        start: { allDay: true, date: '2026-10-30' },
        end: { allDay: true, date: '2026-11-03' },
      }),
    );
    expect(p!.date).toBe('2026-10-30');
    expect(p!.warnings.map((w) => w.code)).toContain('MULTI_DAY');
  });
  it('a missing SUMMARY needs the student (a title)', () => {
    const [p] = one(ev({ summary: '' }));
    expect(p).toMatchObject({ status: 'NEEDS_REVIEW', blocking: ['title'], selected: false });
  });
  it('an invalid DTSTART is unsupported, never guessed', () => {
    const [p] = one(ev({ start: null }));
    expect(p).toMatchObject({ kindProposal: 'UNSUPPORTED', selected: false });
    expect(p!.reason).toMatch(/fecha de inicio/);
  });
  it('a cancelled event and a modified instance are unsupported with a reason', () => {
    expect(one(ev({ status: 'CANCELLED' }))[0]).toMatchObject({ kindProposal: 'UNSUPPORTED' });
    expect(one(ev({ hasRecurrenceId: true }))[0]!.reason).toMatch(/modificada/);
  });
});

describe('a weekly repetition is a SCHEDULE BLOCK', () => {
  it('BYDAY=TU 07:00–09:00 → one weekly block on Tuesday, until the end of the period', () => {
    const [p] = one(
      ev({
        summary: 'Ciberseguridad',
        ...timed('2026-10-20', '07:00', '09:00'),
        rrule: weekly({ byday: ['TU'] }),
      }),
      { subjects: [SUBJECTS[1]!] },
    );
    expect(p).toMatchObject({
      kindProposal: 'SCHEDULE_BLOCK',
      repeats: 'WEEKLY',
      date: '2026-10-20',
      startTime: '07:00',
      endTime: '09:00',
      until: null,
      status: 'READY',
    });
    expect(p!.warnings.map((w) => w.code)).toContain('REPEATS_TO_PERIOD_END');
  });
  it('BYDAY=TU,TH → one block per day', () => {
    const ps = one(
      ev({
        summary: 'Anatomía',
        ...timed('2026-10-20', '07:00', '09:00'),
        rrule: weekly({ byday: ['TU', 'TH'] }),
      }),
    );
    expect(ps.map((p) => [p.date, p.clientId.split(':')[1]])).toEqual([
      ['2026-10-20', '2'],
      ['2026-10-22', '4'],
    ]);
  });
  it('without BYDAY it repeats on the weekday of DTSTART', () => {
    const [p] = one(
      ev({ summary: 'Anatomía', ...timed('2026-10-21', '07:00', '09:00'), rrule: weekly() }),
    );
    expect(p!.date).toBe('2026-10-21');
  });
  it('UNTIL ends the series that day', () => {
    const [p] = one(
      ev({
        summary: 'Anatomía',
        ...timed('2026-10-20', '07:00', '09:00'),
        rrule: weekly({ byday: ['TU'], until: '2026-11-17' }),
      }),
    );
    expect(p!.until).toBe('2026-11-17');
  });
  it('COUNT=4 on Tuesdays ends on the fourth Tuesday; with two days each day ends at ITS last date', () => {
    const base = { summary: 'Anatomía', ...timed('2026-10-20', '07:00', '09:00') };
    const [p] = one(ev({ ...base, rrule: weekly({ byday: ['TU'], count: 4 }) }));
    expect(p!.until).toBe('2026-11-10');
    const ps = one(ev({ ...base, rrule: weekly({ byday: ['TU', 'TH'], count: 3 }) }));
    expect(ps.map((x) => x.until)).toEqual(['2026-10-27', '2026-10-22']); // Tue 20, Thu 22, Tue 27
  });
  it('a huge COUNT is refused, never expanded', () => {
    const [p] = one(
      ev({ summary: 'Anatomía', rrule: weekly({ byday: ['TU'], count: ICS_MAX_COUNT + 1 }) }),
    );
    expect(p).toMatchObject({ kindProposal: 'UNSUPPORTED' });
  });
  it('EXDATE is never dropped: the student must decide', () => {
    const [p] = one(ev({ summary: 'Anatomía', rrule: weekly({ byday: ['TU'] }), exdateCount: 2 }));
    expect(p).toMatchObject({ status: 'NEEDS_REVIEW', exceptions: 2, selected: false });
    expect(p!.blocking).toContain('exceptions');
    expect(p!.warnings.find((w) => w.code === 'EXCEPTIONS')!.message).toMatch(
      /excepciones de calendario/,
    );
  });
  it('no DTEND: no invented duration, the end time is asked', () => {
    const [p] = one(ev({ summary: 'Anatomía', end: null, rrule: weekly({ byday: ['TU'] }) }));
    expect(p!.blocking).toContain('endTime');
    expect(p!.endTime).toBeNull();
  });
  it('a block without a matched subject needs one (a class belongs to a subject)', () => {
    const [p] = one(ev({ summary: 'Farmacología', rrule: weekly({ byday: ['TU'] }) }));
    expect(p!.subject).toEqual({ kind: 'NONE' });
    expect(p!.blocking).toContain('subject');
  });
  it('MONTHLY, YEARLY, INTERVAL 2, other parts, "1MO" days and all-day repetitions are unsupported', () => {
    for (const rrule of [
      weekly({ freq: 'MONTHLY' }),
      weekly({ freq: 'YEARLY' }),
      weekly({ interval: 2 }),
      weekly({ other: true }),
      weekly({ byday: ['1MO'] }),
    ]) {
      expect(one(ev({ summary: 'Anatomía', rrule }))[0]!.kindProposal).toBe('UNSUPPORTED');
    }
    expect(
      one(
        ev({ summary: 'Anatomía', start: { allDay: true, date: '2026-10-20' }, rrule: weekly() }),
      )[0]!.kindProposal,
    ).toBe('UNSUPPORTED');
    expect(one(ev({ rrule: 'INVALID' }))[0]!.kindProposal).toBe('UNSUPPORTED');
  });
  it('a class that ends the next day is unsupported', () => {
    expect(
      one(
        ev({
          summary: 'Anatomía',
          end: { allDay: false, date: '2026-10-24', time: '01:00' },
          rrule: weekly(),
        }),
      )[0]!.kindProposal,
    ).toBe('UNSUPPORTED');
  });
});

describe('subjects: deterministic, never guessed, never created', () => {
  it('two equal subjects in two studies → ambiguous, ONLY those two', () => {
    const [p] = one(ev({ summary: 'Ciberseguridad - Parcial' }));
    expect(p!.subject.kind).toBe('AMBIGUOUS');
    if (p!.subject.kind === 'AMBIGUOUS')
      expect(p!.subject.candidates.map((c) => c.periodId).sort()).toEqual([U(100), U(200)]);
    expect(p).toMatchObject({ status: 'NEEDS_REVIEW', selected: false });
    expect(p!.blocking).toContain('subject');
  });
  it('a subject written that does not exist stays without subject (no other one is offered)', () => {
    const [p] = one(ev({ summary: 'Farmacología - Parcial' }));
    expect(p!.subject).toEqual({ kind: 'NONE' });
    expect(p!.status).toBe('READY'); // an activity without subject is valid
  });
});

describe('the same UID twice in the file', () => {
  it('the second is flagged and unticked', () => {
    const { proposals } = proposeIcsEvents(
      [ev({ uid: 'same', summary: 'A' }), ev({ uid: 'same', summary: 'A' })],
      ctx,
    );
    expect(proposals[0]!.duplicateOf).toBeNull();
    expect(proposals[1]).toMatchObject({ selected: false });
    expect(proposals[1]!.duplicateOf).toBe(proposals[0]!.clientId);
    expect(proposals[1]!.warnings.map((w) => w.code)).toContain('DUPLICATE_UID');
  });
});

describe('summary', () => {
  it('counts activities, blocks, needs-review and unsupported', () => {
    const { summary } = proposeIcsEvents(
      [
        ev({ summary: 'Anatomía', rrule: weekly({ byday: ['TU'] }) }),
        ev({ summary: 'Parcial' }),
        ev({ summary: 'Ciberseguridad' }),
        ev({ start: null }),
      ],
      ctx,
    );
    expect(summary).toEqual({
      total: 4,
      activities: 2,
      scheduleBlocks: 1,
      needsReview: 1,
      unsupported: 1,
    });
  });
});
