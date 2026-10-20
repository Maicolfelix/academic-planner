import {
  captureConfirmSchema,
  parseCaptureProposals,
  type CaptureResult,
  type QuickCaptureContext,
} from '@planner/core';
import { describe, expect, it } from 'vitest';
import { captureDraftSchema, toCaptureDraft } from './captureDraft';
import { scheduleLines } from './RecurrenceCard';
import {
  buildConfirmRequest,
  confirmLabel,
  createdMessage,
  createReview,
  effectiveSlots,
  isRecurrenceComplete,
  recurrencePendingOf,
  removeRecurrences,
  setRecurrenceSharedEnd,
  setRecurrenceSubject,
  setRecurrenceTime,
  setError,
  summarize,
  toggle,
  toggleRecurrence,
  toggleRecurrenceDay,
  type ReviewState,
} from './reviewModel';

// "Today" is Monday 5 October 2026, 12:00 in Bogotá.
const NOW = new Date('2026-10-05T17:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const SUBJECTS = [
  { id: id(1), name: 'Redes de Computadores' },
  { id: id(4), name: 'Ciberseguridad' },
];
const ctx = (subjects = SUBJECTS): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects,
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const review = (text: string, subjects = SUBJECTS): ReviewState => {
  const result: CaptureResult = parseCaptureProposals(text, ctx(subjects), 'QUICK');
  return createReview(result);
};

describe('a weekly schedule in the review', () => {
  it('case 1: "todos los martes y jueves de 6 pm a 8 pm" is ONE ready card that creates two weekly blocks', () => {
    const state = review('Tengo Ciberseguridad todos los martes y jueves de 6 pm a 8 pm');
    expect(state.items).toHaveLength(0);
    expect(state.recurrences).toHaveLength(1);
    const [r] = state.recurrences;
    expect(r!.selected && isRecurrenceComplete(r!)).toBe(true);
    expect(scheduleLines(effectiveSlots(r!))).toEqual([
      'Todos los martes y jueves · 6:00 p. m. – 8:00 p. m.',
    ]);

    const summary = summarize(state);
    expect(summary).toMatchObject({ total: 0, schedules: 1, blocksToCreate: 2, incomplete: 0 });
    expect(confirmLabel(summary)).toBe('Crear horario');

    const request = buildConfirmRequest(state);
    expect(request.items).toEqual([]);
    expect(request.blocks).toEqual([
      expect.objectContaining({ weekday: 2, startTime: '18:00', endTime: '20:00', type: 'CLASS' }),
      expect.objectContaining({ weekday: 4, startTime: '18:00', endTime: '20:00', type: 'CLASS' }),
    ]);
    // exactly what the server accepts, and never a period, a date or an owner
    expect(captureConfirmSchema.safeParse(request).success).toBe(true);
    expect(JSON.stringify(request)).not.toMatch(/periodId|userId|startAt|recurrence/);
  });

  it('case 2: a missing end time is asked ONCE, never invented, and one answer fills every day', () => {
    let state = review('Tengo Redes todos los lunes y miércoles a las 7 am');
    const r = () => state.recurrences[0]!;
    expect(recurrencePendingOf(r())).toEqual(['end']);
    expect(r().selected).toBe(false);
    expect(effectiveSlots(r()).map((x) => x.end)).toEqual(['', '']);
    expect(summarize(state)).toMatchObject({ blocksToCreate: 0, needsReview: 1 });

    state = setRecurrenceSharedEnd(state, r().suggestion.clientId, '09:00');
    expect(recurrencePendingOf(r())).toEqual([]);
    expect(r().selected).toBe(true); // it ticks itself once complete
    expect(
      buildConfirmRequest(state).blocks.map((b) => [b.weekday, b.startTime, b.endTime]),
    ).toEqual([
      [1, '07:00', '09:00'],
      [3, '07:00', '09:00'],
    ]);
  });

  it('an end that is not after the start is still a question', () => {
    let state = review('Tengo Redes todos los lunes a las 7 am');
    const id0 = state.recurrences[0]!.suggestion.clientId;
    state = setRecurrenceSharedEnd(state, id0, '06:00');
    expect(recurrencePendingOf(state.recurrences[0]!)).toEqual(['end']);
    expect(buildConfirmRequest(state).blocks).toEqual([]);
  });

  it('case 4: an activity and a weekly schedule live in one review and one request', () => {
    const state = review(
      'Tengo un parcial de redes el viernes a las 8 am y clase de ciberseguridad todos los martes y jueves de 6 pm a 8 pm',
    );
    expect(state.items).toHaveLength(1);
    expect(state.recurrences).toHaveLength(1);
    const summary = summarize(state);
    expect(summary).toMatchObject({ toCreate: 1, blocksToCreate: 2, schedules: 1 });
    expect(confirmLabel(summary)).toBe('Crear 1 actividad y 2 bloques');
    const request = buildConfirmRequest(state);
    expect(request.items).toHaveLength(1);
    expect(request.blocks).toHaveLength(2);
    // the clientIds are distinct across both lists
    const ids = [...request.items, ...request.blocks].map((x) => x.clientId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('an unticked schedule is not sent and does not block a ticked activity', () => {
    let state = review(
      'Tengo un parcial de redes el viernes a las 8 am y clase de ciberseguridad todos los martes y jueves de 6 pm a 8 pm',
    );
    state = toggleRecurrence(state, state.recurrences[0]!.suggestion.clientId, false);
    const summary = summarize(state);
    expect(summary).toMatchObject({ toCreate: 1, blocksToCreate: 0, incomplete: 0, skipped: 1 });
    expect(confirmLabel(summary)).toBe('Crear 1 actividad');
    expect(buildConfirmRequest(state).blocks).toEqual([]);
  });

  it('case 6: "la del martes es de 8 a 10 y la del jueves de 2 a 4" keeps each day its own hours; only the subject is asked', () => {
    const state = review(
      'Tengo clases martes y jueves; la del martes es de 8 a 10 y la del jueves de 2 a 4',
    );
    const r = state.recurrences[0]!;
    expect(recurrencePendingOf(r)).toEqual(['subject']);
    expect(scheduleLines(effectiveSlots(r))).toEqual([
      'Los martes · 8:00 a. m. – 10:00 a. m.',
      'Los jueves · 2:00 p. m. – 4:00 p. m.',
    ]);
    const answered = setRecurrenceSubject(state, r.suggestion.clientId, {
      kind: 'EXISTING',
      id: SUBJECTS[1]!.id,
      name: 'Ciberseguridad',
    });
    expect(answered.recurrences[0]!.selected).toBe(true);
    expect(summarize(answered).newSubjects).toEqual([]);
  });

  it('a class cannot be "sin asignatura", and a NEW name is only a name until the request', () => {
    const state = review('Tengo Ciberseguridad todos los martes de 6 pm a 8 pm', []);
    const r = state.recurrences[0]!;
    expect(recurrencePendingOf(r)).toContain('subject');
    const none = setRecurrenceSubject(state, r.suggestion.clientId, { kind: 'NONE' });
    expect(recurrencePendingOf(none.recurrences[0]!)).toContain('subject');
    const created = setRecurrenceSubject(state, r.suggestion.clientId, {
      kind: 'NEW',
      name: 'Ciberseguridad',
    });
    expect(summarize(created).newSubjects).toEqual(['Ciberseguridad']);
    expect(buildConfirmRequest(created).blocks[0]!.subject).toEqual({
      kind: 'NEW',
      name: 'Ciberseguridad',
    });
  });

  it('editing days and times changes only that schedule', () => {
    let state = review('Tengo Ciberseguridad todos los martes y jueves de 6 pm a 8 pm');
    const cid = state.recurrences[0]!.suggestion.clientId;
    state = toggleRecurrenceDay(state, cid, 4); // out Thursday
    state = toggleRecurrenceDay(state, cid, 5); // in Friday: starts like the first day
    state = setRecurrenceTime(state, cid, 5, 'end', '21:00');
    expect(effectiveSlots(state.recurrences[0]!)).toEqual([
      { weekday: 2, start: '18:00', end: '20:00' },
      { weekday: 5, start: '18:00', end: '21:00' },
    ]);
    expect(scheduleLines(effectiveSlots(state.recurrences[0]!))).toEqual([
      'Los martes · 6:00 p. m. – 8:00 p. m.',
      'Los viernes · 6:00 p. m. – 9:00 p. m.',
    ]);
    state = toggleRecurrenceDay(toggleRecurrenceDay(state, cid, 2), cid, 5);
    expect(recurrencePendingOf(state.recurrences[0]!)).toContain('days');
  });
});

describe('a repeating activity is explained, never created', () => {
  it('"un quiz todos los viernes" has no block, no tick and does not appear in any request', () => {
    const state = review('Tengo un quiz todos los viernes');
    expect(state.items).toHaveLength(0);
    expect(state.recurrences).toHaveLength(1);
    const r = state.recurrences[0]!;
    expect(r.suggestion.kind).toBe('RECURRING_ACTIVITY_UNSUPPORTED');
    expect(r.selected).toBe(false);
    expect(summarize(state)).toMatchObject({ schedules: 0, unsupported: 1, blocksToCreate: 0 });
    expect(buildConfirmRequest(state)).toEqual({ items: [], blocks: [] });
    // ticking it by hand still creates nothing
    expect(
      buildConfirmRequest(toggleRecurrence(state, r.suggestion.clientId, true)).blocks,
    ).toEqual([]);
  });
});

describe('the words around the confirmation', () => {
  it('the button says what it does', () => {
    const base = {
      total: 0,
      schedules: 0,
      unsupported: 0,
      needsReview: 0,
      incomplete: 0,
      skipped: 0,
      newSubjects: [],
      grades: 0,
      gradesToCreate: 0,
    };
    const label = (toCreate: number, blocksToCreate: number) =>
      confirmLabel({ ...base, toCreate, blocksToCreate });
    expect(label(2, 0)).toBe('Crear 2 actividades');
    expect(label(1, 0)).toBe('Crear 1 actividad');
    expect(label(0, 3)).toBe('Crear horario');
    expect(label(1, 2)).toBe('Crear 1 actividad y 2 bloques');
    expect(label(3, 4)).toBe('Crear 3 actividades y 4 bloques');
  });

  it('says what was created and what was already there', () => {
    expect(createdMessage({ count: 1, createdBlocks: [1, 2], reusedBlocks: [] })).toBe(
      '1 actividad creada y 2 bloques de horario creados.',
    );
    expect(createdMessage({ count: 0, createdBlocks: [], reusedBlocks: [1] })).toBe(
      '1 bloque ya estaba en tu horario.',
    );
  });

  it('a refusal of one weekday is shown on its schedule card', () => {
    const state = review('Tengo Ciberseguridad todos los martes y jueves de 6 pm a 8 pm');
    const cid = state.recurrences[0]!.suggestion.clientId;
    const failed = setError(state, { [`${cid}:4`]: 'Ese horario se cruza con otra clase.' });
    expect(failed.recurrences[0]!.error).toBe('Ese horario se cruza con otra clase.');
    expect(removeRecurrences(failed, new Set([cid])).recurrences).toEqual([]);
  });
});

describe('the draft keeps a mixed review', () => {
  it('round-trips the schedule with the answers already given, and the activities too', () => {
    let state = review(
      'Tengo un parcial de redes el viernes a las 8 am y clase de redes todos los lunes a las 7 am',
    );
    const cid = state.recurrences[0]!.suggestion.clientId;
    state = setRecurrenceSharedEnd(state, cid, '09:00');
    state = toggle(state, state.items[0]!.proposal.clientId, false);
    const draft = toCaptureDraft('texto', state)!;
    const back = captureDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(back.review!.recurrences[0]!.sharedEnd).toBe('09:00');
    expect(back.review!.recurrences[0]!.selected).toBe(true);
    expect(back.review!.items[0]!.selected).toBe(false);
    expect(back.review!.items).toHaveLength(1);
  });

  it('a draft of another engine version is dropped', () => {
    const draft = toCaptureDraft('x', review('Tengo Redes todos los lunes a las 7 am'))!;
    expect(captureDraftSchema.safeParse({ ...draft, engine: 2 }).success).toBe(false);
  });
});
