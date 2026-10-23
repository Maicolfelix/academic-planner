import { describe, expect, it } from 'vitest';
import { sharedDayRoots } from './captureProposals.js';

/**
 * `sharedDayRoots` decides which mentions share ONE day said once. It must be structural: by the order written and the day
 * actually carried, never by the wording and never by the sentence alone. These cases feed it the shapes the segmenter can
 * (and, one day, may) produce, including two chains of inheritance in the SAME sentence.
 */
const own = (sentence: number, days: string) => ({ sentence, inherited: false, days });
const inh = (sentence: number, days: string) => ({ sentence, inherited: true, days });
const TUE = 'martes';
const THU = 'jueves';

describe('sharedDayRoots', () => {
  it('one group: the carrier and who inherits its day share one root; the carrier alone is no group', () => {
    expect(sharedDayRoots([own(0, TUE), inh(0, TUE), inh(0, TUE)])).toEqual([0, 0, 0]);
    expect(sharedDayRoots([own(0, TUE)])).toEqual([null]);
    expect(sharedDayRoots([])).toEqual([]);
  });

  it('two chains in the SAME sentence get two roots (the martes group never absorbs the jueves one)', () => {
    // 0 martes carrier, 1 inherits martes, 2 jueves carrier, 3 inherits jueves
    expect(sharedDayRoots([own(0, TUE), inh(0, TUE), own(0, THU), inh(0, THU)])).toEqual([
      0, 0, 2, 2,
    ]);
    // A search "the first inheriting mention of the sentence" would root the jueves one at 1: that is the failure.
    expect(
      sharedDayRoots([own(0, TUE), inh(0, TUE), own(0, THU), inh(0, THU), inh(0, THU)]),
    ).toEqual([0, 0, 2, 2, 2]);
  });

  it('interleaved chains in one sentence still go to the root that carries THEIR day', () => {
    // martes carrier, jueves carrier, then one inheriting each day
    expect(sharedDayRoots([own(0, TUE), own(0, THU), inh(0, TUE), inh(0, THU)])).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it('same wording in different sentences stays apart', () => {
    expect(sharedDayRoots([own(0, TUE), inh(0, TUE), own(1, TUE), inh(1, TUE)])).toEqual([
      0, 0, 2, 2,
    ]);
    expect(sharedDayRoots([inh(0, TUE), inh(1, TUE)])).toEqual([0, 1]);
  });

  it('a mention with a day of its own is never pulled into a group of another day', () => {
    // 1 carries its own jueves: out of the martes group, which is 0 and 2
    expect(sharedDayRoots([own(0, TUE), own(0, THU), inh(0, TUE)])).toEqual([0, null, 0]);
  });

  it('the day said before the first activity (no carrier): the first mention that inherits it is the root', () => {
    expect(sharedDayRoots([inh(0, TUE), inh(0, TUE), inh(0, TUE)])).toEqual([0, 0, 0]);
    expect(sharedDayRoots([inh(0, TUE), inh(0, THU), inh(0, TUE), inh(0, THU)])).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it('is deterministic and pure: the same input gives the same roots and the input is untouched', () => {
    const input = [own(0, TUE), inh(0, TUE), own(0, THU), inh(0, THU)];
    const copy = JSON.stringify(input);
    expect(sharedDayRoots(input)).toEqual(sharedDayRoots(input));
    expect(JSON.stringify(input)).toBe(copy);
  });
});
