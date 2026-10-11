import { parseCaptureProposals, type Subject } from '@planner/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { toCaptureDraft } from './captureDraft';
import { CaptureReview } from './CaptureReview';
import { createReview, summarize } from './reviewModel';

/** The review at its limit: fifty proposals. Timings are printed as evidence; the bounds only catch a blow-up. */

const NOW = new Date('2026-10-05T17:00:00.000Z');
const subjects: Subject[] = [];
const text = Array.from(
  { length: 50 },
  (_, i) =>
    `Taller ${i + 1} el ${String((i % 28) + 1).padStart(2, '0')}/${i < 28 ? '12' : '01'}, hay que llevar el portátil`,
).join(', ');

const time = <T,>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const out = fn();
  return [out, performance.now() - t0];
};

describe('fifty proposals at once', () => {
  const [result, parseMs] = time(() =>
    parseCaptureProposals(
      text,
      {
        now: NOW,
        timeZone: 'America/Bogota',
        subjects: [],
        period: { startDate: '2026-08-03', endDate: '2027-02-28' },
      },
      'INBOX',
    ),
  );

  it('parse, render and draft stay far from anything a student could notice', () => {
    expect(result.proposals).toHaveLength(50);
    const state = createReview(result);
    const [html, renderMs] = time(() =>
      renderToStaticMarkup(
        <StaticRouter location="/inbox">
          <CaptureReview
            state={state}
            onChange={() => {}}
            subjects={subjects}
            pending={false}
            onConfirm={() => {}}
            onBack={() => {}}
            onDiscard={() => {}}
            level={2}
          />
        </StaticRouter>,
      ),
    );
    const [draft, draftMs] = time(() => JSON.stringify(toCaptureDraft(text, state)));
    console.info(
      `50 proposals: parse ${parseMs.toFixed(0)} ms, render ${renderMs.toFixed(0)} ms (${(html.length / 1024).toFixed(0)} KB of HTML), draft ${draftMs.toFixed(0)} ms (${(draft.length / 1024).toFixed(0)} KB)`,
    );
    expect(html.match(/<article/g)).toHaveLength(50);
    expect(summarize(state)).toMatchObject({ total: 50, needsReview: 0 });
    expect(html).toContain('50 actividades encontradas');
    expect(html).toContain('50 listas');
    expect(parseMs).toBeLessThan(2000);
    expect(renderMs).toBeLessThan(2000);
    expect(draft.length).toBeLessThan(1_000_000);
  });
});
