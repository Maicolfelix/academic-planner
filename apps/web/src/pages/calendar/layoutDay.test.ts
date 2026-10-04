import { describe, expect, it } from 'vitest';
import { layoutDay, minutesOf } from './layoutDay';

const span = (start: string, end: string, id = `${start}-${end}`) => ({
  id,
  startMin: minutesOf(start),
  endMin: minutesOf(end),
});
const shape = (items: ReturnType<typeof span>[]) =>
  Object.fromEntries(layoutDay(items).map((p) => [p.id, [p.lane, p.lanes]]));

describe('minutesOf', () => {
  it('converts HH:mm to minutes', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('08:30')).toBe(510);
    expect(minutesOf('23:59')).toBe(1439);
  });
});

describe('layoutDay', () => {
  it('a lone block takes the whole width', () => {
    expect(shape([span('08:00', '10:00', 'a')])).toEqual({ a: [0, 1] });
  });

  it('blocks that only touch (10:00 / 10:00) do not share columns', () => {
    expect(shape([span('08:00', '10:00', 'a'), span('10:00', '12:00', 'b')])).toEqual({
      a: [0, 1],
      b: [0, 1],
    });
  });

  it('two overlapping blocks sit side by side', () => {
    expect(shape([span('08:00', '10:00', 'a'), span('09:00', '11:00', 'b')])).toEqual({
      a: [0, 2],
      b: [1, 2],
    });
  });

  it('a third block reuses a free lane inside the same cluster', () => {
    // a 08–10 and b 09–12 overlap; c 10–11 overlaps b but fits in a's lane once a is over.
    expect(
      shape([
        span('08:00', '10:00', 'a'),
        span('09:00', '12:00', 'b'),
        span('10:00', '11:00', 'c'),
      ]),
    ).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [0, 2],
    });
  });

  it('three simultaneous blocks use three lanes', () => {
    expect(
      shape([
        span('08:00', '10:00', 'a'),
        span('08:00', '10:00', 'b'),
        span('08:30', '09:30', 'c'),
      ]),
    ).toEqual({ a: [0, 3], b: [1, 3], c: [2, 3] });
  });

  it('independent clusters do not widen each other', () => {
    expect(
      shape([
        span('08:00', '10:00', 'a'),
        span('09:00', '10:30', 'b'),
        span('14:00', '15:00', 'c'),
      ]),
    ).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });

  it('does not depend on input order', () => {
    const forward = shape([span('08:00', '10:00', 'a'), span('09:00', '11:00', 'b')]);
    const backward = shape([span('09:00', '11:00', 'b'), span('08:00', '10:00', 'a')]);
    expect(backward).toEqual(forward);
  });
});
