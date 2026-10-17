import type { EducationContext } from './academic.js';
import { GRADING_PERIOD_TERMS } from './grading.js';

/**
 * The human side of the grades (B2): what a student TYPES and READS ("40 %", "4.2", "18 de 20") against what the API stores
 * (basis points and milli). Every conversion lives here, once, pure and tested, so no screen ever shows or builds an internal
 * number. Display always uses a dot ("4.2"); input accepts a dot or a comma.
 */

/** "40", "12.5" or "12,5" (an optional "%") → basis points (4000, 1250); null when it is not a number in 0..100. */
export function percentToBp(text: string): number | null {
  const value = decimalOf(text.replace('%', ''));
  if (value === null || value < 0 || value > 100) return null;
  return Math.round(value * 100);
}

/** 4000 → "40 %", 1250 → "12.5 %". */
export function formatPercent(bp: number): string {
  const percent = bp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, '')} %`;
}

/** The same figure for the editing field: "40", "12.5" (no unit). */
export function bpToPercentText(bp: number): string {
  return formatPercent(bp).replace(' %', '');
}

/** A weight in the FINAL grade, in units (100 % = 100 000 000), as a percentage: 60 000 000 → "60 %". */
export function formatUnitsPercent(units: number): string {
  return formatPercent(Math.round(units / 10_000));
}

/** "4.2" or "4,2" → a number, or null. Nothing but digits and one separator; no exponents, no spaces inside. */
function decimalOf(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "4.2" → 4200. Null when it is not a number (the range is checked against the scale by the caller or the server). */
export function scoreToMilli(text: string): number | null {
  const n = decimalOf(text);
  return n === null ? null : Math.round(n * 1000);
}

/** 4200 → "4.2" with `decimals` digits (rounded half up): FOR DISPLAY ONLY, never compared with the pass mark. */
export function formatScore(milli: number, decimals: number): string {
  const step = 10 ** (3 - decimals);
  const rounded = Math.floor((milli + step / 2) / step) * step;
  return (rounded / 1000).toFixed(decimals);
}

/** Round a needed score UP so the figure shown is always enough. */
export function formatNeeded(milli: number, decimals: number): string {
  const step = 10 ** (3 - decimals);
  return ((Math.ceil(milli / step) * step) / 1000).toFixed(decimals);
}

/** "18" and "20" → 18000 / 20000 (points), or null. */
export const pointsToMilli = scoreToMilli;

/** 18000 / 20000 → "18 / 20". */
export function formatPoints(earnedMilli: number, maxMilli: number): string {
  const n = (m: number) => (m / 1000).toString();
  return `${n(earnedMilli)} / ${n(maxMilli)}`;
}

export interface ScalePreset {
  id: 'FIVE' | 'HUNDRED';
  label: string;
  minMilli: number;
  maxMilli: number;
  passMilli: number;
  decimals: number;
}

export const SCALE_PRESETS: readonly ScalePreset[] = [
  {
    id: 'FIVE',
    label: '0.0–5.0 · aprueba con 3.0',
    minMilli: 0,
    maxMilli: 5000,
    passMilli: 3000,
    decimals: 1,
  },
  {
    id: 'HUNDRED',
    label: '0–100 · aprueba con 60',
    minMilli: 0,
    maxMilli: 100_000,
    passMilli: 60_000,
    decimals: 0,
  },
];

export interface CutDraft {
  name: string;
  finalShareBp: number;
}

export interface CutPreset {
  id: string;
  label: string;
  cuts: readonly CutDraft[];
}

const NO_CUTS_NAME = 'Nota final';

/** The quick ways to split a period, by the kind of study. Never inferred from an institution. */
export function cutPresets(type: EducationContext): readonly CutPreset[] {
  const term = GRADING_PERIOD_TERMS[type].one;
  const equal = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `${term} ${i + 1}`, finalShareBp: 10_000 / n }));
  const noCuts: CutPreset = {
    id: 'NONE',
    label: 'Una sola nota (100 %)',
    cuts: [{ name: NO_CUTS_NAME, finalShareBp: 10_000 }],
  };
  if (type === 'UNIVERSITY')
    return [
      {
        id: '30-30-40',
        label: '30 % / 30 % / 40 %',
        cuts: [
          { name: `${term} 1`, finalShareBp: 3000 },
          { name: `${term} 2`, finalShareBp: 3000 },
          { name: `${term} 3`, finalShareBp: 4000 },
        ],
      },
      noCuts,
    ];
  if (type === 'SCHOOL')
    return [{ id: '4x25', label: '25 % / 25 % / 25 % / 25 %', cuts: equal(4) }, noCuts];
  return [noCuts];
}

/** The default name of the n-th cut when the student adds one ("Corte 4", "Periodo de evaluación 2", "Etapa 3"). */
export const defaultCutName = (type: EducationContext, n: number) =>
  `${GRADING_PERIOD_TERMS[type].one} ${n}`;

/** A row of the cuts editor as the student types it: a name and a percentage that may be blank. */
export interface PercentRow {
  name: string;
  percent: string;
}

/**
 * The AUTO-REMAINDER, per subject: when exactly one cut has no percentage and the others are valid and leave something over, that
 * one takes the rest (30 / 30 / blank → 40; 25 / blank / 40 → 35). With two or more blanks nothing is guessed, and a typo is never
 * "fixed": a non-numeric row is not blank, it is wrong. Returns the index and the percentage (basis points), or null.
 */
export function remainderOf(rows: readonly PercentRow[]): { index: number; bp: number } | null {
  const blanks = rows.flatMap((r, i) => (r.percent.trim() === '' ? [i] : []));
  if (blanks.length !== 1) return null;
  let sum = 0;
  for (const [i, row] of rows.entries()) {
    if (i === blanks[0]) continue;
    const bp = percentToBp(row.percent);
    if (bp === null || bp < 1) return null;
    sum += bp;
  }
  const rest = 10_000 - sum;
  return rest >= 1 ? { index: blanks[0]!, bp: rest } : null;
}

/** The same rows with the remainder written into the blank one (unchanged when nothing can be completed). */
export function withRemainder<T extends PercentRow>(rows: readonly T[]): T[] {
  const rest = remainderOf(rows);
  return rows.map((r, i) =>
    rest && i === rest.index ? { ...r, percent: bpToPercentText(rest.bp) } : r,
  );
}
