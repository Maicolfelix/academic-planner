import {
  parseCaptureProposals,
  type CaptureMode,
  type CaptureResult,
  type QuickCaptureContext,
  type Subject,
} from '@planner/core';
import { describe, expect, it } from 'vitest';
import { captureDraftSchema, toCaptureDraft } from './captureDraft';
import {
  buildConfirmRequest,
  chooseGroupSubject,
  chooseGroupTime,
  createReview,
  effectiveSubject,
  effectiveTime,
  isComplete,
  pendingOf,
  reconcileSubjects,
  remove,
  setDate,
  setSubject,
  setTime,
  summarize,
  toggle,
} from './reviewModel';

// "Today" is Monday 5 October 2026, 12:00 in Bogotá.
const NOW = new Date('2026-10-05T17:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const subject = (n: number, name: string) => ({ id: id(n), name, color: '#3B82F6' }) as Subject;
const SUBJECTS = [subject(1, 'Redes de Computadores'), subject(4, 'Ciberseguridad')];
const ctx = (subjects: Subject[] = SUBJECTS): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const review = (text: string, subjects = SUBJECTS, mode: CaptureMode = 'QUICK') => {
  const result: CaptureResult = parseCaptureProposals(text, ctx(subjects), mode);
  return createReview(result);
};
const CRITICAL =
  'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM';

describe('the review of a text that needs nothing', () => {
  it('the critical example: four complete, ticked, nothing to answer, one request creates four', () => {
    const state = review(CRITICAL);
    expect(state.items).toHaveLength(4);
    expect(state.items.every((i) => i.selected && isComplete(state, i))).toBe(true);
    expect(summarize(state)).toMatchObject({ total: 4, toCreate: 4, incomplete: 0, skipped: 0 });
    const request = buildConfirmRequest(state);
    expect(request.items.map((i) => [i.dueDate, i.dueTime, i.subject.kind])).toEqual([
      ['2026-10-12', '07:30', 'NONE'],
      ['2026-10-13', '07:30', 'NONE'],
      ['2026-10-15', '17:40', 'NONE'],
      ['2026-10-16', '17:40', 'NONE'],
    ]);
    expect(request.items.every((i) => i.title === 'Ensayo' && i.type === 'TASK')).toBe(true);
  });

  it('does not send what the student did not tick, nor what is still missing something', () => {
    let state = review('parcial de redes martes y ensayo lunes a las 7');
    const [ready, ambiguous] = state.items;
    expect(ready!.selected).toBe(true);
    expect(ambiguous!.selected).toBe(false);
    expect(buildConfirmRequest(state).items).toHaveLength(1);
    state = toggle(state, ready!.proposal.clientId, false);
    expect(buildConfirmRequest(state).items).toEqual([]);
  });
});

describe('a question several proposals share is answered once', () => {
  const TEXT = 'ensayo lunes, martes y jueves a las 7:30';

  it('the three days are waiting for ONE hour', () => {
    const state = review(TEXT);
    expect(state.corrections).toHaveLength(1);
    expect(state.items.every((i) => pendingOf(state, i).join() === 'time')).toBe(true);
    expect(summarize(state)).toMatchObject({ toCreate: 0 });
  });

  it('one answer completes and ticks all three', () => {
    const key = review(TEXT).corrections[0]!.key;
    const state = chooseGroupTime(review(TEXT), key, '07:30');
    expect(state.items.every((i) => isComplete(state, i) && i.selected)).toBe(true);
    expect(buildConfirmRequest(state).items.map((i) => i.dueTime)).toEqual([
      '07:30',
      '07:30',
      '07:30',
    ]);
  });

  it('what is changed on ONE proposal stops following the shared answer', () => {
    const base = review(TEXT);
    const key = base.corrections[0]!.key;
    const id2 = base.items[1]!.proposal.clientId;
    let state = setTime(base, id2, '19:30'); // the student fixes the second one by hand
    state = chooseGroupTime(state, key, '07:30'); // and answers the shared question afterwards
    expect(buildConfirmRequest(state).items.map((i) => i.dueTime)).toEqual([
      '07:30',
      '19:30',
      '07:30',
    ]);
  });

  it('"sin hora" is an answer', () => {
    const base = review(TEXT);
    const state = chooseGroupTime(base, base.corrections[0]!.key, '');
    expect(effectiveTime(state, state.items[0]!)).toBe('');
    expect(buildConfirmRequest(state).items.every((i) => i.dueTime === undefined)).toBe(true);
  });
});

describe('the subject', () => {
  it('a subject that does not exist is offered by name and created only when confirmed, once', () => {
    const text = 'parcial de criptografía martes y tarea de criptografía jueves';
    const base = review(text, [subject(1, 'Redes de Computadores')]);
    expect(base.corrections.map((c) => c.field)).toEqual(['subject']);
    const key = base.corrections[0]!.key;
    const state = chooseGroupSubject(base, key, { kind: 'NEW', name: 'Criptografía' });
    expect(summarize(state)).toMatchObject({ toCreate: 2, newSubjects: ['Criptografía'] });
    const request = buildConfirmRequest(state);
    expect(request.items.map((i) => i.subject)).toEqual([
      { kind: 'NEW', name: 'Criptografía' },
      { kind: 'NEW', name: 'Criptografía' },
    ]);
  });

  it('leaving it out is a valid answer; picking an existing one too', () => {
    const base = review('parcial de criptografía martes', [subject(1, 'Redes de Computadores')]);
    const only = base.items[0]!.proposal.clientId;
    expect(buildConfirmRequest(setSubject(base, only, { kind: 'NONE' })).items[0]!.subject).toEqual(
      { kind: 'NONE' },
    );
    const picked = setSubject(base, only, {
      kind: 'EXISTING',
      id: id(1),
      name: 'Redes de Computadores',
    });
    expect(buildConfirmRequest(picked).items[0]!.subject).toEqual({
      kind: 'EXISTING',
      subjectId: id(1),
    });
  });

  it('a subject the student never mentioned is not a question', () => {
    const state = review('parcial martes');
    expect(pendingOf(state, state.items[0]!)).toEqual([]);
    expect(effectiveSubject(state, state.items[0]!)).toEqual({ kind: 'NONE' });
  });

  it('a chosen subject that was deleted meanwhile becomes a question again', () => {
    const base = review('parcial de criptografía martes', [subject(1, 'Redes de Computadores')]);
    const only = base.items[0]!.proposal.clientId;
    const chosen = setSubject(base, only, { kind: 'EXISTING', id: id(9), name: 'Borrada' });
    expect(isComplete(chosen, chosen.items[0]!)).toBe(true);
    const back = reconcileSubjects(chosen, SUBJECTS);
    expect(pendingOf(back, back.items[0]!)).toContain('subject');
    expect(back.items[0]!.selected).toBe(false);
  });
});

describe('dates and doubts', () => {
  it('a day to be given completes and ticks the proposal', () => {
    const base = review('parcial de redes');
    expect(pendingOf(base, base.items[0]!)).toEqual(['date']);
    const state = setDate(base, base.items[0]!.proposal.clientId, '2026-10-20');
    expect(isComplete(state, state.items[0]!)).toBe(true);
    expect(state.items[0]!.selected).toBe(true);
    expect(buildConfirmRequest(state).items[0]).toMatchObject({ dueDate: '2026-10-20' });
  });

  it('two days the text gave are a question until one is chosen', () => {
    const base = review('el parcial es lunes y después dice el parcial es martes');
    expect(pendingOf(base, base.items[0]!)).toEqual(['date']);
    const state = setDate(
      base,
      base.items[0]!.proposal.clientId,
      base.items[0]!.proposal.date.alternatives[1]!,
    );
    expect(isComplete(state, state.items[0]!)).toBe(true);
  });

  it('an hour offered by an ambiguous reference is applied only if the student takes it', () => {
    const base = review(
      'tengo un parcial de redes jueves y otro parcial de bases viernes. el parcial es a las 7 am',
      [subject(1, 'Redes de Computadores'), subject(3, 'Bases de Datos')],
    );
    expect(base.items.map((i) => pendingOf(base, i))).toEqual([['time'], ['time']]);
    const first = base.items[0]!.proposal.clientId;
    const state = setTime(setTime(base, first, '07:00'), base.items[1]!.proposal.clientId, '');
    expect(buildConfirmRequest(state).items.map((i) => i.dueTime)).toEqual(['07:00', undefined]);
  });
});

describe('ticking and removing', () => {
  it('ticking a copy of something that already exists means "yes, again"', () => {
    const result = parseCaptureProposals('parcial de redes martes', ctx(), 'QUICK');
    const withCopy = {
      ...result,
      proposals: result.proposals.map((p) => ({
        ...p,
        selected: false,
        duplicateOf: { id: id(77), title: 'Parcial' },
      })),
    };
    let state = createReview(withCopy);
    expect(buildConfirmRequest(state).items).toEqual([]);
    state = toggle(state, state.items[0]!.proposal.clientId, true);
    expect(buildConfirmRequest(state).items[0]).toMatchObject({ allowDuplicate: true });
  });

  it('removing a proposal also drops a shared question that no longer has two', () => {
    const base = review('ensayo lunes y martes a las 7:30');
    expect(base.corrections).toHaveLength(1);
    const state = remove(base, base.items[0]!.proposal.clientId);
    expect(state.items).toHaveLength(1);
    expect(state.corrections).toEqual([]);
  });
});

describe('what is kept as a draft', () => {
  it("survives a round trip through the stored shape, with the student's decisions", () => {
    const base = review('ensayo lunes, martes y jueves a las 7:30');
    const state = chooseGroupTime(base, base.corrections[0]!.key, '07:30');
    const draft = toCaptureDraft('ensayo lunes, martes y jueves a las 7:30', state)!;
    const restored = captureDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(restored.review!.groupTime).toEqual(state.groupTime);
    expect(buildConfirmRequest(restored.review as never).items).toEqual(
      buildConfirmRequest(state).items,
    );
  });

  it('there is nothing to keep for an empty text with nothing interpreted', () => {
    expect(toCaptureDraft('   ', null)).toBeNull();
  });

  it('a draft from another engine version is not accepted', () => {
    const draft = toCaptureDraft('parcial', null)!;
    expect(captureDraftSchema.safeParse({ ...draft, engine: 999 }).success).toBe(false);
  });

  it('never carries an error message from the last attempt', () => {
    const state = review('parcial martes');
    state.items[0]!.error = 'algo';
    const draft = toCaptureDraft('parcial martes', state)!;
    expect(JSON.stringify(draft)).not.toContain('algo');
  });
});
