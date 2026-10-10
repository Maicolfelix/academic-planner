import { describe, expect, it } from 'vitest';
import { createActivitySchema } from './activity.js';
import { createSubjectSchema, subjectNameSchema } from './academic.js';
import { captureConfirmSchema } from './captureConfirm.js';

const item = (over: Record<string, unknown> = {}) => ({
  clientId: 'p1',
  title: 'Ensayo',
  dueDate: '2026-10-12',
  dueTime: '07:30',
  subject: { kind: 'NONE' },
  ...over,
});
const parse = (items: unknown[]) => captureConfirmSchema.safeParse({ items });

describe('the confirmation request', () => {
  it('accepts the fields of an activity plus where it came from and its subject', () => {
    const r = parse([
      item(),
      item({ clientId: 'p2', subject: { kind: 'NEW', name: 'Criptografía' }, type: 'EXAM' }),
      item({ clientId: 'p3', subject: { kind: 'EXISTING', subjectId: crypto.randomUUID() } }),
    ]);
    expect(r.success).toBe(true);
    if (r.success) {
      // The server's defaults are the activity's own: a task of medium priority.
      expect(r.data.items[0]).toMatchObject({ type: 'TASK', priority: 'MEDIUM' });
    }
  });

  it('is strict at every level: nothing the server derives is accepted', () => {
    for (const extra of [
      { periodId: crypto.randomUUID() },
      { userId: crypto.randomUUID() },
      { status: 'COMPLETED' },
      { dueAt: '2026-10-12T12:30:00.000Z' },
      { reminders: [] },
      { subjectId: crypto.randomUUID() }, // the subject goes in `subject`
    ]) {
      expect(parse([item(extra)]).success, JSON.stringify(extra)).toBe(false);
    }
    expect(captureConfirmSchema.safeParse({ items: [item()], count: 1 }).success).toBe(false);
    for (const subject of [
      { kind: 'NONE', subjectId: crypto.randomUUID() },
      { kind: 'NEW', name: 'X', color: '#000000' },
      { kind: 'EXISTING' },
      { kind: 'OTHER' },
    ]) {
      expect(parse([item({ subject })]).success, JSON.stringify(subject)).toBe(false);
    }
  });

  it('needs between 1 and 10 activities with distinct client ids', () => {
    expect(parse([]).success).toBe(false);
    expect(parse(Array.from({ length: 11 }, (_, i) => item({ clientId: `p${i}` }))).success).toBe(
      false,
    );
    expect(parse(Array.from({ length: 10 }, (_, i) => item({ clientId: `p${i}` }))).success).toBe(
      true,
    );
    expect(parse([item(), item({ dueDate: '2026-10-13' })]).success).toBe(false);
  });

  it('validates each activity like the single create does', () => {
    expect(parse([item({ dueDate: '2026-02-31' })]).success).toBe(false);
    expect(parse([item({ dueTime: '25:00' })]).success).toBe(false);
    expect(parse([item({ title: '   ' })]).success).toBe(false);
    expect(parse([item({ type: 'ESSAY' })]).success).toBe(false);
    expect(parse([item({ clientId: '' })]).success).toBe(false);
  });
});

describe('free text never carries a NUL character (the database would refuse it with a 500)', () => {
  it('in an activity title and description', () => {
    expect(
      createActivitySchema.safeParse({ title: 'a\u0000b', dueDate: '2026-10-12' }).success,
    ).toBe(false);
    expect(
      createActivitySchema.safeParse({
        title: 'ok',
        dueDate: '2026-10-12',
        description: 'x\u0000',
      }).success,
    ).toBe(false);
    expect(createActivitySchema.safeParse({ title: 'ok', dueDate: '2026-10-12' }).success).toBe(
      true,
    );
  });

  it('in a subject name, wherever the name enters', () => {
    expect(subjectNameSchema.safeParse('Redes\u0000').success).toBe(false);
    expect(subjectNameSchema.safeParse('Redes de Computadores').success).toBe(true);
    expect(
      createSubjectSchema.safeParse({ periodId: crypto.randomUUID(), name: 'a\u0000' }).success,
    ).toBe(false);
    expect(parse([item({ subject: { kind: 'NEW', name: 'a\u0000b' } })]).success).toBe(false);
  });
});
