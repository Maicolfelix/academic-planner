import { z } from 'zod';
import type { ACTIVITY_TYPES } from './activity.js';
import { normalizeNameKey, type EducationContext } from './academic.js';
import type { CaptureResult } from './captureProposals.js';
import {
  buildSubjectEntries,
  capitalize,
  findTypes,
  matchSubject,
  tokenize,
  use,
  type Token,
} from './captureShared.js';
import { GRADING_NAME_MAX, GRADE_MILLI_MAX, WEIGHT_BP_MAX } from './grading.js';
import { rawToScoreMilli } from './gradingMath.js';

/**
 * SMART CAPTURE OF GRADES (B3). The same sentence that creates an activity can also say how it counts or how it went; this
 * module reads those words deterministically (no model, no fuzzy matching) and PROPOSES — it never creates anything:
 *   "Saqué 4.3 en el Corte 2 de Farmacología"         -> the grade of a whole cut (a direct cut grade)
 *   "Parcial de Anatomía el viernes, vale 40% del Corte 1" -> an activity AND a pending evaluation linked to it
 *   "Saqué 4.2 en el parcial de Anatomía"               -> the score of an existing pending evaluation
 *   "Saqué 18 de 20 en el parcial de Bioquímica"        -> the same, with the points kept apart
 * An Activity never receives a grade: the evaluation is another thing that may point at it.
 *
 * What the words do not settle is never guessed, it is asked, and only that: which subject (several current studies can have
 * the same one), which cut, what a "40 %" is a percentage OF (the cut or the final grade), which evaluation received a score,
 * and the grade itself when "18 of 20" cannot be converted (a scale that does not start at 0).
 */

// ── What the interpreter needs to know (the server builds it from the student's CURRENT periods) ────────────────────────

export interface GradeProfileCtx {
  minMilli: number;
  maxMilli: number;
  passMilli: number;
  decimals: number;
}
export interface GradeCutCtx {
  id: string;
  name: string;
  position: number;
  finalShareBp: number;
}
export interface GradeEvaluationCtx {
  id: string;
  name: string;
  gradingPeriodId: string;
  /** The title of the linked activity, if any (a second exact name to recognise it by). */
  activityTitle: string | null;
  scoreMilli: number | null;
  isCutGrade: boolean;
}
export interface GradeSubjectCtx {
  id: string;
  name: string;
  periodId: string;
  /** The study it belongs to (to tell two subjects with the same name apart). */
  studyName: string | null;
  studyType: EducationContext;
  /** In the period where new activities go: only there can a grade be linked to an activity of this capture. */
  isHome: boolean;
  profile: GradeProfileCtx | null;
  cuts: GradeCutCtx[];
  evaluations: GradeEvaluationCtx[];
}
export interface GradeCaptureContext {
  subjects: GradeSubjectCtx[];
}

// ── What it proposes ────────────────────────────────────────────────────────────────────────────────────────────────────

export const GRADE_CAPTURE_MAX = 20;

const subjectRef = z.object({
  id: z.uuid(),
  name: z.string(),
  periodId: z.uuid(),
  studyName: z.string().nullable(),
  isHome: z.boolean(),
});
export type GradeSubjectRef = z.infer<typeof subjectRef>;

const cutRef = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number(),
  finalShareBp: z.number(),
});
export type GradeCutRef = z.infer<typeof cutRef>;

const evaluationRef = z.object({
  id: z.uuid(),
  name: z.string(),
  cutName: z.string(),
  activityTitle: z.string().nullable(),
});

/** What a score or an evaluation can be applied to. Exactly one is chosen; the interpreter chooses it only when the words settle it. */
export const gradeChoiceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SET_CUT_GRADE'), cut: cutRef }),
  z.object({
    action: z.literal('UPDATE_CUT_GRADE'),
    cut: cutRef,
    evaluationId: z.uuid(),
    currentScoreMilli: z.number(),
  }),
  z.object({ action: z.literal('SCORE_EVALUATION'), evaluation: evaluationRef }),
  z.object({ action: z.literal('CREATE_EVALUATION'), cut: cutRef }),
]);
export type GradeChoice = z.infer<typeof gradeChoiceSchema>;

export const GRADE_NOTICES = [
  'NO_CONFIG',
  'CUT_BROKEN_DOWN',
  'CUT_HAS_DIRECT',
  'NO_PENDING_EVALUATIONS',
  'NO_MATCHING_CUT',
] as const;

/** The whole reading for ONE candidate subject (when the words fit several, there is one option each and the student picks). */
export const gradeOptionSchema = z.object({
  subject: subjectRef,
  profile: z
    .object({
      minMilli: z.number(),
      maxMilli: z.number(),
      passMilli: z.number(),
      decimals: z.number(),
    })
    .nullable(),
  config: z.enum(['OK', 'NO_PROFILE', 'NO_CUTS']),
  choices: z.array(gradeChoiceSchema),
  /** The index of the only choice the words settle, or null. */
  auto: z.number().nullable(),
  notice: z.enum(GRADE_NOTICES).nullable(),
  /** The cut the notice is about ("Corte 1 está desglosado en evaluaciones"). */
  noticeCut: z.string().nullable(),
  /** The grade in the scale of the period: null when it must still be given (points on a scale that does not start at 0). */
  scoreMilli: z.number().nullable(),
  scoreProblem: z.enum(['OUT_OF_RANGE']).nullable(),
});
export type GradeOption = z.infer<typeof gradeOptionSchema>;

export const gradeSuggestionSchema = z.object({
  clientId: z.string(),
  rawSegment: z.string(),
  /** READY and nothing to ask: ticked by default. */
  selected: z.boolean(),
  status: z.enum(['READY', 'NEEDS_REVIEW']),
  /** What the words said: a score, or a new evaluation that counts for some percentage. */
  intent: z.enum(['SCORE', 'NEW_EVALUATION']),
  /** The words named a subject (otherwise the options are all the subjects the student could mean). */
  subjectMentioned: z.boolean(),
  options: z.array(gradeOptionSchema),
  autoOption: z.number().nullable(),
  score: z.object({
    kind: z.enum(['NONE', 'DECIMAL', 'POINTS']),
    /** A grade written directly ("4.3"), in thousandths. */
    scoreMilli: z.number().nullable(),
    rawEarnedMilli: z.number().nullable(),
    rawMaxMilli: z.number().nullable(),
  }),
  /** The name of a new evaluation, from the words ("Parcial"). */
  name: z.string().nullable(),
  weight: z.object({
    basis: z.enum(['NONE', 'GRADING_PERIOD', 'FINAL', 'UNKNOWN']),
    /** What was said, in basis points of whatever it is a percentage OF. */
    percentBp: z.number().nullable(),
  }),
  /** The activity of this same capture the evaluation is linked to (set by `mergeGradeCapture`). */
  activityClientId: z.string().nullable(),
});
export type GradeSuggestion = z.infer<typeof gradeSuggestionSchema>;

export const gradeCaptureSchema = z.object({ suggestions: z.array(gradeSuggestionSchema) });
export type GradeCapture = z.infer<typeof gradeCaptureSchema>;
export const EMPTY_GRADE_CAPTURE: GradeCapture = { suggestions: [] };

// ── Reading the words ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Clause {
  start: number;
  end: number;
  text: string;
}

/** Sentences, cut at . ; ! ? and line breaks — never at the dot of a decimal ("4.3"). */
function clausesOf(text: string): Clause[] {
  const clauses: Clause[] = [];
  let start = 0;
  const push = (end: number) => {
    const piece = text.slice(start, end);
    if (piece.trim() !== '') clauses.push({ start, end, text: piece });
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === ';' || c === '!' || c === '?' || c === '\n') push(i);
    else if (c === '.' && !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''))) push(i);
  }
  push(text.length);
  return clauses;
}

const fold = (s: string) => normalizeNameKey(s);

const GRADE_VERB =
  /\b(?:saque|saco|sacamos|obtuve|obtuvo|tuve|me fue|me fueron|nota|calificacion)\b/;
const NUM = '(\\d+(?:[.,]\\d+)?)';
const num = (s: string) => Number(s.replace(',', '.'));
const milli = (s: string) => Math.round(num(s) * 1000);

interface Found<T> {
  value: T;
  start: number;
  end: number;
}

/** "18 de 20" / "18/20" (never a date: the second part is a number and no more slashes follow). */
function findPoints(n: string): Found<{ earned: number; max: number }> | null {
  const m = new RegExp(`${NUM}\\s*(?:de|/)\\s*${NUM}(?![\\d/%])`).exec(n);
  if (!m) return null;
  const earned = num(m[1]!);
  const max = num(m[2]!);
  if (!(max > 0) || earned > max) return null;
  return {
    value: { earned: Math.round(earned * 1000), max: Math.round(max * 1000) },
    start: m.index,
    end: m.index + m[0].length,
  };
}

/** "saqué 4.2", "nota 4.5", "me fue 3.8", "Corte 2: 4.5" — a number after a grade word or a colon, never a percentage. */
function findDecimal(n: string, hasCut: boolean): Found<number> | null {
  const verb = new RegExp(
    `\\b(?:saque|saco|sacamos|obtuve|obtuvo|tuve|me fue|me fueron|nota|calificacion)\\b(?:\\s+(?:de|fue|un|una|el|la))*\\s*:?\\s*${NUM}(?!\\s*%|\\d|[/])`,
  ).exec(n);
  if (verb) return { value: milli(verb[1]!), start: verb.index, end: verb.index + verb[0].length };
  if (hasCut) {
    const colon = new RegExp(`:\\s*${NUM}(?!\\s*%|\\d|[/])`).exec(n);
    if (colon)
      return { value: milli(colon[1]!), start: colon.index, end: colon.index + colon[0].length };
  }
  return null;
}

/** "vale 40%", "pesa 30 % del corte 2", "40% de la nota final". */
function findWeight(n: string): Found<{
  percentBp: number;
  basis: 'GRADING_PERIOD' | 'FINAL' | 'UNKNOWN';
  tail: string;
}> | null {
  const verb = new RegExp(
    `\\b(?:vale|valen|pesa|pesan|equivale a|corresponde a|representa|es el|son el)\\s+(?:un\\s+)?${NUM}\\s*(?:%|por ciento)\\s*([^,;.]*)`,
  ).exec(n);
  const bare = verb ?? new RegExp(`${NUM}\\s*%\\s*((?:del?|de la)\\s[^,;.]*)`).exec(n);
  if (!bare) return null;
  const percent = num(bare[1]!);
  if (!(percent > 0) || percent > 100) return null;
  const tail = (bare[2] ?? '').trim();
  const basis = /\b(?:nota final|definitiva|nota definitiva|calificacion final|total)\b/.test(tail)
    ? 'FINAL'
    : /\b(?:corte|periodo|etapa)\b/.test(tail)
      ? 'GRADING_PERIOD'
      : 'UNKNOWN';
  return {
    value: { percentBp: Math.round(percent * 100), basis, tail },
    start: bare.index,
    end: bare.index + bare[0].length,
  };
}

const ORDINALS: Record<string, number> = {
  primer: 1,
  primero: 1,
  primera: 1,
  '1er': 1,
  '1ro': 1,
  segundo: 2,
  segunda: 2,
  '2do': 2,
  tercer: 3,
  tercero: 3,
  tercera: 3,
  '3er': 3,
  cuarto: 4,
  cuarta: 4,
  '4to': 4,
  quinto: 5,
  quinta: 5,
  '5to': 5,
  sexto: 6,
  sexta: 6,
  '6to': 6,
};
const ORDINAL_WORDS = Object.keys(ORDINALS).join('|');
const CUT_WORD = 'periodo de evaluacion|periodo|corte|etapa';

/** The words a study type uses for its cuts (the terminology of that kind of study). */
const TERMS_OF: Record<EducationContext, readonly string[]> = {
  UNIVERSITY: ['corte'],
  SCHOOL: ['periodo de evaluacion', 'periodo'],
  OTHER_ACADEMIC: ['etapa'],
};

interface CutMention {
  term: string;
  number: number;
  start: number;
  end: number;
}

/** "corte 2", "periodo de evaluación 3", "etapa 1", "segundo corte", "primer periodo". */
function findCutMention(n: string): CutMention | null {
  const a = new RegExp(`\\b(${CUT_WORD})\\s*(?:n[o°º]?\\.?\\s*)?(\\d{1,2})\\b`).exec(n);
  if (a) return { term: a[1]!, number: Number(a[2]), start: a.index, end: a.index + a[0].length };
  const b = new RegExp(`\\b(${ORDINAL_WORDS})\\s+(${CUT_WORD})\\b`).exec(n);
  if (b)
    return { term: b[2]!, number: ORDINALS[b[1]!]!, start: b.index, end: b.index + b[0].length };
  return null;
}

/** Marks the tokens that overlap a [start, end) range of the (folded) clause: they are spoken for. */
function consume(tokens: Token[], tokenStarts: number[], start: number, end: number): void {
  tokens.forEach((t, i) => {
    const s = tokenStarts[i]!;
    if (s < end && s + t.norm.length > start) use(tokens, i, 1);
  });
}

const asRef = (s: GradeSubjectCtx): GradeSubjectRef => ({
  id: s.id,
  name: s.name,
  periodId: s.periodId,
  studyName: s.studyName,
  isHome: s.isHome,
});
const cutRefOf = (c: GradeCutCtx): GradeCutRef => ({
  id: c.id,
  name: c.name,
  position: c.position,
  finalShareBp: c.finalShareBp,
});

interface Reading {
  clause: Clause;
  score: GradeSuggestion['score'];
  weight: GradeSuggestion['weight'];
  mention: CutMention | null;
  noun: string | null;
  nounWords: string[];
  evalType: (typeof ACTIVITY_TYPES)[number] | null;
  subjectMentions: ReturnType<typeof matchSubject>;
  /** Character ranges of the clause the activity engine must NOT read. */
  blank: [number, number][];
}

function readClause(clause: Clause, subjects: GradeSubjectCtx[]): Reading | null {
  const n = fold(clause.text);
  const weight = findWeight(n);
  const mention = findCutMention(n);
  const hasVerb = GRADE_VERB.test(n);
  // A score is a grade only with its words: a verb, or a cut and a colon. "viernes 3/10" or "a las 18" are not grades.
  const points = weight || !(hasVerb || mention) ? null : findPoints(n);
  const decimal = weight || points ? null : findDecimal(n, mention !== null);
  if (!weight && !points && !decimal) return null;

  const score: GradeSuggestion['score'] = points
    ? {
        kind: 'POINTS',
        scoreMilli: null,
        rawEarnedMilli: points.value.earned,
        rawMaxMilli: points.value.max,
      }
    : decimal
      ? { kind: 'DECIMAL', scoreMilli: decimal.value, rawEarnedMilli: null, rawMaxMilli: null }
      : { kind: 'NONE', scoreMilli: null, rawEarnedMilli: null, rawMaxMilli: null };

  // Tokens: those spoken for (score, weight, cut, type word) cannot also name a subject.
  const tokens = tokenize(n);
  const starts: number[] = [];
  let cursor = 0;
  for (const t of tokens) {
    const at = n.indexOf(t.norm, cursor);
    starts.push(at < 0 ? cursor : at);
    cursor = (at < 0 ? cursor : at) + t.norm.length;
  }
  for (const f of [points, decimal, weight]) if (f) consume(tokens, starts, f.start, f.end);
  if (mention) consume(tokens, starts, mention.start, mention.end);
  const types = findTypes(tokens);
  const type = types[0] ?? null;
  let noun: string | null = null;
  let nounWords: string[] = [];
  if (type) {
    const words = tokens.slice(type.start, type.start + type.length);
    const next = tokens[type.start + type.length];
    const number = next && /^\d{1,2}$/.test(next.norm) ? next : null;
    noun = [...words, ...(number ? [number] : [])].map((t) => t.raw).join(' ');
    nounWords = [fold(noun)];
    use(tokens, type.start, type.length + (number ? 1 : 0));
  }
  const subjectMentions = matchSubject(tokens, buildSubjectEntries(subjects));

  const blank: [number, number][] = weight
    ? [[clause.start + weight.start, clause.start + weight.end]]
    : [[clause.start, clause.end]];
  return {
    clause,
    score,
    weight: weight
      ? { basis: weight.value.basis, percentBp: weight.value.percentBp }
      : { basis: 'NONE', percentBp: null },
    mention,
    noun: noun ? capitalize(noun.toLowerCase()) : null,
    nounWords,
    evalType: type ? type.type : null,
    subjectMentions,
    blank,
  };
}

function cutsOf(
  subject: GradeSubjectCtx,
  reading: Reading,
): { cut: GradeCutCtx | null; ambiguous: GradeCutCtx[] } {
  const n = fold(reading.clause.text);
  const byName = subject.cuts.filter((c) => {
    const key = fold(c.name);
    return (
      key.length > 0 &&
      new RegExp(`(^|[^a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(n)
    );
  });
  const m = reading.mention;
  const termOk = m !== null && TERMS_OF[subject.studyType].includes(m.term);
  const byPosition = m && termOk ? subject.cuts.filter((c) => c.position === m.number) : [];
  if (byName.length === 1 && byPosition.length === 1 && byName[0] !== byPosition[0])
    return { cut: null, ambiguous: [byName[0]!, byPosition[0]!] }; // the name and the number disagree: never choose
  const found = byName.length === 1 ? byName[0]! : byPosition.length === 1 ? byPosition[0]! : null;
  return { cut: found, ambiguous: byName.length > 1 ? byName : [] };
}

/** Builds the reading of one clause for ONE candidate subject. */
function optionFor(subject: GradeSubjectCtx, reading: Reading): GradeOption {
  const profile = subject.profile;
  const base = {
    subject: asRef(subject),
    profile,
    auto: null as number | null,
    notice: null as GradeOption['notice'],
    noticeCut: null as string | null,
    choices: [] as GradeChoice[],
    scoreMilli: null as number | null,
    scoreProblem: null as GradeOption['scoreProblem'],
  };
  const config: GradeOption['config'] = !profile
    ? 'NO_PROFILE'
    : subject.cuts.length === 0
      ? 'NO_CUTS'
      : 'OK';
  if (config !== 'OK' || !profile) return { ...base, config, notice: 'NO_CONFIG' };

  // The grade in the period's scale. Points convert only on a scale that starts at 0; otherwise it must still be given.
  let scoreMilli: number | null = null;
  if (reading.score.kind === 'DECIMAL') scoreMilli = reading.score.scoreMilli;
  else if (reading.score.kind === 'POINTS')
    scoreMilli = rawToScoreMilli(
      profile,
      reading.score.rawEarnedMilli!,
      reading.score.rawMaxMilli!,
    );
  const scoreProblem: GradeOption['scoreProblem'] =
    scoreMilli !== null &&
    (scoreMilli < profile.minMilli || scoreMilli > Math.min(profile.maxMilli, GRADE_MILLI_MAX))
      ? 'OUT_OF_RANGE'
      : null;
  const common = { ...base, config, scoreMilli: scoreProblem ? null : scoreMilli, scoreProblem };

  const { cut, ambiguous } = cutsOf(subject, reading);
  const cutNamed = reading.mention !== null || cut !== null || ambiguous.length > 0;
  const directOf = (c: GradeCutCtx) =>
    subject.evaluations.find((e) => e.gradingPeriodId === c.id && e.isCutGrade) ?? null;
  const detailedOf = (c: GradeCutCtx) =>
    subject.evaluations.filter((e) => e.gradingPeriodId === c.id && !e.isCutGrade);
  const pending = (cutId?: string) =>
    subject.evaluations.filter(
      (e) => !e.isCutGrade && e.scoreMilli === null && (!cutId || e.gradingPeriodId === cutId),
    );
  const evalChoice = (e: GradeEvaluationCtx): GradeChoice => ({
    action: 'SCORE_EVALUATION',
    evaluation: {
      id: e.id,
      name: e.name,
      cutName: subject.cuts.find((c) => c.id === e.gradingPeriodId)?.name ?? '',
      activityTitle: e.activityTitle,
    },
  });
  const directChoice = (c: GradeCutCtx): GradeChoice => {
    const d = directOf(c);
    return d && d.scoreMilli !== null
      ? {
          action: 'UPDATE_CUT_GRADE',
          cut: cutRefOf(c),
          evaluationId: d.id,
          currentScoreMilli: d.scoreMilli,
        }
      : { action: 'SET_CUT_GRADE', cut: cutRefOf(c) };
  };

  // A NEW evaluation that counts for some percentage.
  if (reading.weight.basis !== 'NONE') {
    if (cut) {
      if (directOf(cut)) return { ...common, notice: 'CUT_HAS_DIRECT', noticeCut: cut.name };
      return { ...common, choices: [{ action: 'CREATE_EVALUATION', cut: cutRefOf(cut) }], auto: 0 };
    }
    const open = subject.cuts.filter((c) => !directOf(c));
    return {
      ...common,
      choices: (ambiguous.length ? ambiguous : open)
        .filter((c) => !directOf(c))
        .map((c) => ({ action: 'CREATE_EVALUATION' as const, cut: cutRefOf(c) })),
      notice: cutNamed && ambiguous.length === 0 && reading.mention ? 'NO_MATCHING_CUT' : null,
    };
  }

  // A score for a named evaluation ("el parcial"): only pending ones of THIS subject, matched by exact name.
  if (reading.noun) {
    const scope = cut ? pending(cut.id) : pending();
    const exact = scope.filter(
      (e) =>
        reading.nounWords.includes(fold(e.name)) ||
        (e.activityTitle !== null && reading.nounWords.includes(fold(e.activityTitle))),
    );
    if (scope.length === 0) return { ...common, notice: 'NO_PENDING_EVALUATIONS' };
    const pool = exact.length > 0 ? exact : scope;
    return { ...common, choices: pool.map(evalChoice), auto: exact.length === 1 ? 0 : null };
  }

  // A score for a cut as a whole ("Corte 2").
  if (cut) {
    const detailed = detailedOf(cut);
    if (detailed.length > 0)
      return {
        ...common,
        notice: 'CUT_BROKEN_DOWN',
        noticeCut: cut.name,
        choices: detailed.filter((e) => e.scoreMilli === null).map(evalChoice),
      };
    return { ...common, choices: [directChoice(cut)], auto: 0 };
  }
  // Neither an evaluation nor a cut: the student says where it goes.
  const pool = ambiguous.length ? ambiguous : subject.cuts;
  return {
    ...common,
    notice: reading.mention && ambiguous.length === 0 ? 'NO_MATCHING_CUT' : null,
    choices: [
      ...pool.filter((c) => detailedOf(c).length === 0).map(directChoice),
      ...pending().map(evalChoice),
    ],
  };
}

export interface GradeInterpretation extends GradeCapture {
  /** The text with the grade words blanked (same length): what the ACTIVITY engine reads. */
  maskedText: string;
  /** Where each suggestion came from, to link it to the activity proposal of the same sentence. */
  clauses: Record<string, string>;
}

/**
 * Reads every sentence of the capture that talks about a grade or about the weight of an evaluation. A sentence that is only a
 * score is wholly spoken for (nothing of it reaches the activity engine); a weight phrase is blanked and the rest of the
 * sentence ("Parcial de Anatomía el viernes") stays for the activity engine.
 */
export function interpretGrades(text: string, context: GradeCaptureContext): GradeInterpretation {
  const chars = [...text];
  const suggestions: GradeSuggestion[] = [];
  const clauses: Record<string, string> = {};
  for (const clause of clausesOf(text)) {
    if (suggestions.length >= GRADE_CAPTURE_MAX) break;
    const reading = readClause(clause, context.subjects);
    if (!reading) continue;
    const m = reading.subjectMentions;
    const mentioned = m.kind === 'match' || (m.kind === 'ambiguous' && !m.weak);
    const candidates =
      m.kind === 'match'
        ? [m.subject.id]
        : m.kind === 'ambiguous' && !m.weak
          ? m.candidates.map((c) => c.id)
          : [];
    const pool = mentioned
      ? context.subjects.filter((s) => candidates.includes(s.id))
      : context.subjects;
    const options = pool.map((s) => optionFor(s, reading));
    // A subject the words did not name: only the readings that could fit (a cut or an evaluation that exists) are offered.
    const fitting = options.filter((o) => o.choices.length > 0);
    const shown = mentioned ? options : fitting.length > 0 ? fitting : options;
    const autoOption = mentioned && shown.length === 1 ? 0 : null;
    const clientId = `g${suggestions.length + 1}`;
    const suggestion: GradeSuggestion = {
      clientId,
      rawSegment: clause.text.trim(),
      selected: false,
      status: 'NEEDS_REVIEW',
      intent: reading.weight.basis !== 'NONE' ? 'NEW_EVALUATION' : 'SCORE',
      subjectMentioned: mentioned,
      options: shown,
      autoOption,
      score: reading.score,
      name:
        reading.weight.basis !== 'NONE'
          ? (reading.noun ?? 'Evaluación').slice(0, GRADING_NAME_MAX)
          : null,
      weight: reading.weight,
      activityClientId: null,
    };
    const resolved = resolveGrade(suggestion, {});
    suggestion.status = resolved.missing.length === 0 ? 'READY' : 'NEEDS_REVIEW';
    suggestion.selected = suggestion.status === 'READY';
    suggestions.push(suggestion);
    clauses[clientId] = text.slice(clause.start, clause.end);
    for (const [from, to] of reading.blank)
      for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return { suggestions, maskedText: chars.join(''), clauses };
}

// ── Resolving a suggestion with what the student decided ─────────────────────────────────────────────────────────────

/** What the student chose in the review. Anything left out falls back to what the words settled. */
export interface GradeSelection {
  optionIndex?: number;
  choiceIndex?: number;
  /** "40 % of what?": the answer when the words did not say. */
  basis?: 'GRADING_PERIOD' | 'FINAL';
  /** The grade in the scale of the period, when "18 of 20" could not be converted. */
  canonicalMilli?: number | null;
  /** The name of a new evaluation, edited. */
  name?: string;
}

export type GradeMissing =
  'SUBJECT' | 'TARGET' | 'CONFIG' | 'SCORE' | 'CANONICAL' | 'BASIS' | 'WEIGHT';

/** The confirm request of one evaluation action (the shape `POST /api/capture/confirm` takes). */
export const CAPTURE_EVALUATION_ACTIONS = [
  'SET_CUT_GRADE',
  'UPDATE_CUT_GRADE',
  'SCORE_EVALUATION',
  'CREATE_EVALUATION',
] as const;

export interface GradeResolution {
  option: GradeOption | null;
  choice: GradeChoice | null;
  missing: GradeMissing[];
  /** The weight inside the cut, in basis points, once the basis and the cut are known. */
  periodShareBp: number | null;
  weightProblem: 'NOT_EXACT' | 'OUT_OF_RANGE' | null;
  scoreMilli: number | null;
  request: {
    action: (typeof CAPTURE_EVALUATION_ACTIONS)[number];
    subjectId: string;
    gradingPeriodId?: string;
    evaluationId?: string;
    name?: string;
    periodShareBp?: number;
    scoreMilli?: number;
    rawEarnedMilli?: number;
    rawMaxMilli?: number;
    expectScoreMilli?: number | null;
    activityClientId?: string;
  } | null;
}

/**
 * "40 % of the final grade" inside a cut worth 30 % of the final grade is 40/30 of the cut: only an exact whole number of basis
 * points is accepted (a conversion that does not come out exact is a question, never an approximation).
 */
export function weightToShareBp(
  basis: 'GRADING_PERIOD' | 'FINAL',
  percentBp: number,
  cutFinalShareBp: number,
): { bp: number | null; problem: 'NOT_EXACT' | 'OUT_OF_RANGE' | null } {
  if (basis === 'GRADING_PERIOD') {
    return percentBp >= 1 && percentBp <= WEIGHT_BP_MAX
      ? { bp: percentBp, problem: null }
      : { bp: null, problem: 'OUT_OF_RANGE' };
  }
  const numerator = percentBp * WEIGHT_BP_MAX;
  if (numerator % cutFinalShareBp !== 0) return { bp: null, problem: 'NOT_EXACT' };
  const bp = numerator / cutFinalShareBp;
  return bp >= 1 && bp <= WEIGHT_BP_MAX
    ? { bp, problem: null }
    : { bp: null, problem: 'OUT_OF_RANGE' };
}

export function resolveGrade(s: GradeSuggestion, sel: GradeSelection): GradeResolution {
  const missing: GradeMissing[] = [];
  const optionIndex = sel.optionIndex ?? s.autoOption;
  const option =
    optionIndex === null || optionIndex === undefined ? null : (s.options[optionIndex] ?? null);
  const empty: GradeResolution = {
    option,
    choice: null,
    missing,
    periodShareBp: null,
    weightProblem: null,
    scoreMilli: null,
    request: null,
  };
  if (!option) {
    missing.push('SUBJECT');
    return empty;
  }
  if (option.config !== 'OK') {
    missing.push('CONFIG');
    return empty;
  }
  const choiceIndex = sel.choiceIndex ?? option.auto;
  const choice =
    choiceIndex === null || choiceIndex === undefined
      ? null
      : (option.choices[choiceIndex] ?? null);
  if (!choice) {
    missing.push('TARGET');
    // A new evaluation also still owes what its percentage is OF, whichever cut the student ends up choosing.
    if (
      s.intent === 'NEW_EVALUATION' &&
      (s.weight.basis === 'UNKNOWN' || s.weight.basis === 'NONE') &&
      !sel.basis
    )
      missing.push('BASIS');
    return { ...empty, option };
  }

  // The grade in the scale of the period.
  let scoreMilli: number | null = null;
  if (choice.action !== 'CREATE_EVALUATION') {
    scoreMilli = option.scoreMilli ?? sel.canonicalMilli ?? null;
    if (s.score.kind === 'NONE') missing.push('SCORE');
    else if (option.scoreProblem) missing.push('CANONICAL');
    else if (scoreMilli === null) missing.push('CANONICAL');
    else if (
      option.profile &&
      (scoreMilli < option.profile.minMilli || scoreMilli > option.profile.maxMilli)
    )
      missing.push('CANONICAL');
  }

  // The weight of a new evaluation.
  let periodShareBp: number | null = null;
  let weightProblem: GradeResolution['weightProblem'] = null;
  if (choice.action === 'CREATE_EVALUATION') {
    const basis =
      s.weight.basis === 'UNKNOWN' || s.weight.basis === 'NONE' ? sel.basis : s.weight.basis;
    if (!basis) missing.push('BASIS');
    else if (s.weight.percentBp === null) missing.push('WEIGHT');
    else {
      const converted = weightToShareBp(basis, s.weight.percentBp, choice.cut.finalShareBp);
      periodShareBp = converted.bp;
      weightProblem = converted.problem;
      if (converted.bp === null) missing.push('WEIGHT');
    }
  }
  const result: GradeResolution = {
    option,
    choice,
    missing,
    periodShareBp,
    weightProblem,
    scoreMilli,
    request: null,
  };
  if (missing.length > 0) return result;

  const subjectId = option.subject.id;
  // The points the student gave are kept beside the grade of the scale, whoever supplied that grade.
  const points =
    s.score.kind === 'POINTS'
      ? { rawEarnedMilli: s.score.rawEarnedMilli!, rawMaxMilli: s.score.rawMaxMilli! }
      : {};
  const withScore = { scoreMilli: scoreMilli!, ...points };
  switch (choice.action) {
    case 'SET_CUT_GRADE':
      result.request = {
        action: 'SET_CUT_GRADE',
        subjectId,
        gradingPeriodId: choice.cut.id,
        ...withScore,
      };
      break;
    case 'UPDATE_CUT_GRADE':
      result.request = {
        action: 'UPDATE_CUT_GRADE',
        subjectId,
        evaluationId: choice.evaluationId,
        expectScoreMilli: choice.currentScoreMilli,
        ...withScore,
      };
      break;
    case 'SCORE_EVALUATION':
      result.request = {
        action: 'SCORE_EVALUATION',
        subjectId,
        evaluationId: choice.evaluation.id,
        expectScoreMilli: null,
        ...withScore,
      };
      break;
    case 'CREATE_EVALUATION':
      result.request = {
        action: 'CREATE_EVALUATION',
        subjectId,
        gradingPeriodId: choice.cut.id,
        name:
          (sel.name ?? s.name ?? 'Evaluación').trim().slice(0, GRADING_NAME_MAX) || 'Evaluación',
        periodShareBp: periodShareBp!,
        ...(s.activityClientId && option.subject.isHome
          ? { activityClientId: s.activityClientId }
          : {}),
      };
      break;
  }
  return result;
}

// ── Joining the grades to the activities of the same capture ─────────────────────────────────────────────────────────────

const squash = (s: string) => fold(s).replace(/\s+/g, ' ').trim();

/**
 * A new evaluation and the activity that comes from the SAME sentence ("Parcial de Anatomía el viernes, vale 40 % del Corte 1")
 * are linked: confirming creates both. A sentence that gave no date has no activity: it is only an evaluation. An activity that
 * names ANOTHER subject than the evaluation is left alone (never forced). Grade-only sentences never reached the activity
 * engine, so nothing of them is in `capture`.
 */
export function mergeGradeCapture(
  capture: CaptureResult,
  grades: GradeInterpretation,
  homeSubjectIds: ReadonlySet<string>,
): { capture: CaptureResult; grades: GradeCapture } {
  const proposals = [...capture.proposals];
  const removed = new Set<string>();
  const suggestions = grades.suggestions.map((s) => {
    if (s.intent !== 'NEW_EVALUATION') return s;
    const clauseText = squash(grades.clauses[s.clientId] ?? '');
    const match = proposals.find(
      (p) =>
        !removed.has(p.clientId) &&
        clauseText.includes(squash(p.rawSegment)) &&
        squash(p.rawSegment) !== '',
    );
    if (!match) return s;
    if (match.date.value === null) {
      // No date: it is an evaluation, not something to do on a day.
      removed.add(match.clientId);
      return s;
    }
    const subjectId = match.subject.kind === 'EXISTING' ? match.subject.id : null;
    const fits = (o: GradeOption) =>
      o.subject.isHome &&
      homeSubjectIds.has(o.subject.id) &&
      (subjectId === null || subjectId === o.subject.id);
    if (!s.options.some(fits)) return s;
    return { ...s, activityClientId: match.clientId };
  });
  const keep = proposals.filter((p) => !removed.has(p.clientId));
  const kept = new Set(keep.map((p) => p.clientId));
  return {
    capture: {
      ...capture,
      proposals: keep,
      corrections: capture.corrections
        .map((c) => ({ ...c, clientIds: c.clientIds.filter((id) => kept.has(id)) }))
        .filter((c) => c.clientIds.length >= 2),
    },
    grades: { suggestions },
  };
}
