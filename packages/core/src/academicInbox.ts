import { z } from 'zod';
import { normalizeNameKey, periodSchema, type DateOnly } from './academic.js';
import { ACTIVITY_TYPES, type ActivityType } from './activity.js';
import {
  FIELD_CERTAINTIES,
  QUICK_CAPTURE_FIELDS,
  QUICK_CAPTURE_WARNING_CODES,
  STOPWORDS,
  buildSubjectEntries,
  findDateExpressions,
  findTypes,
  interpretTokens,
  tokenize,
  type QuickCaptureContext,
  type SubjectEntry,
  type Token,
} from './captureShared.js';
import { toLocalParts } from './time.js';

/**
 * ACADEMIC INBOX: a longer message pasted by the student (a professor's reminder, an instruction) becomes ONE OR
 * MORE proposals for an Activity. The flow is always PASTE -> INTERPRET -> REVIEW -> CONFIRM: nothing here saves
 * anything, and the text is interpreted in memory and never stored.
 *
 * It is the same deterministic engine as quick capture (captureShared.ts: tokens, times, dates, subject matching,
 * type words, `interpretTokens`), plus a transparent segmentation: the message is cut into sentences, each sentence
 * into one clause per activity ("tendremos parcial ... y entregaremos el taller ...") and every clause is read with
 * the quick-capture rules. No AI, no remote service. It is conservative on purpose: a sentence that is not clearly
 * about an activity yields nothing, and a subject, date or time that is not clear is left for the student rather
 * than guessed. See docs/academic-inbox.md.
 */

export const ACADEMIC_INBOX_MAX_LENGTH = 5000;
/** Hard cap of the request body: far above the product limit, only a guard against abuse. */
export const ACADEMIC_INBOX_REQUEST_MAX = 20_000;
export const ACADEMIC_INBOX_MAX_PROPOSALS = 10;

export const ACADEMIC_INBOX_MESSAGES = {
  EMPTY: 'Pega un mensaje para continuar.',
  TOO_LONG: 'El texto es demasiado largo. Pega únicamente el mensaje académico relevante.',
  NO_ACTIVITIES: 'No encontramos actividades claras en este mensaje.',
  TOO_MANY_PROPOSALS: `Encontré más de ${ACADEMIC_INBOX_MAX_PROPOSALS} actividades: muestro las primeras ${ACADEMIC_INBOX_MAX_PROPOSALS}.`,
  SUBJECT_INHERITED: 'La asignatura se tomó del resto de la oración: verifícala.',
  POSSIBLE_DUPLICATE: 'Ya existe una actividad similar.',
} as const;

// ───────────────────────── Sentences ─────────────────────────

/** Abbreviations whose period does not end a sentence (folded). */
const ABBREVIATIONS = new Set([
  'sr',
  'sra',
  'srs',
  'dr',
  'dra',
  'prof',
  'profe',
  'ing',
  'lic',
  'mg',
  'esp',
  'no',
  'num',
  'nro',
  'etc',
  'ej',
  'vs',
  'cap',
  'pag',
  'pp',
  'tel',
  'av',
  'art',
  'depto',
  'univ',
  'aprox',
  'obs',
]);

/**
 * Does the period at `line[i]` end a sentence? Not when it is glued to the next character ("a.m.", "10.5"),
 * not after an initial or an abbreviation ("Prof."), not after list numbering ("1."), and not when the next
 * sentence would start in lowercase. After "a. m." / "p. m." it does end one if a capital follows.
 */
function periodEndsSentence(line: string, i: number): boolean {
  const next = line[i + 1];
  if (next !== undefined && !/\s/.test(next)) return false;
  const after = line.slice(i + 1).trimStart();
  const startsLowercase = after !== '' && /^\p{Ll}/u.test(after);
  const before = line.slice(0, i);
  const word = (/\S*$/.exec(before)?.[0] ?? '').replace(/^[^\p{L}\p{N}]+/u, '');
  const folded = normalizeNameKey(word);
  const head = before.slice(0, before.length - word.length);
  if (folded === 'm' && /\b[ap]\.\s*$/i.test(head)) return !startsLowercase; // "10:00 a. m. Además ..."
  if (startsLowercase) return false;
  if (/^[a-z]$/.test(folded)) return false; // an initial: "a." "p."
  if (ABBREVIATIONS.has(folded)) return false;
  if (/^\d+$/.test(folded) && head.trim() === '') return false; // list numbering: "1. Parcial ..."
  return true;
}

/** Sentences of a message: line breaks, ";" and sentence-ending periods, "!" and "?". Never throws. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  const push = (s: string) => {
    const trimmed = s.trim();
    if (trimmed !== '') sentences.push(trimmed);
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    let start = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      const isBoundary =
        c === ';' ||
        ((c === '!' || c === '?') && (line[i + 1] === undefined || /\s/.test(line[i + 1]!))) ||
        (c === '.' && periodEndsSentence(line, i));
      if (!isBoundary) continue;
      let end = i + 1;
      while (end < line.length && /[.!?)"'»”]/.test(line[end]!)) end++;
      push(line.slice(start, end));
      start = end;
      i = end - 1;
    }
    push(line.slice(start));
  }
  return sentences;
}

// ───────────────────────── Activity detection ─────────────────────────

const CLAUSE_SPLITTERS = new Set(['y', 'e', 'ademas', 'tambien', 'luego', 'despues', 'asimismo']);
/** "presentación del proyecto": the second type word only qualifies the first one. */
const PHRASE_CONNECTORS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para']);
const DELIVER_VERBS = new Set([
  'entregar',
  'entrega',
  'entregan',
  'entreguen',
  'entregamos',
  'entregaremos',
  'entregara',
  'entregaran',
  'entregue',
]);
const READ_VERBS = new Set(['leer', 'lean', 'leeremos', 'leera', 'lea', 'leamos']);
/** Nouns that make "entregar X" a TASK even though X is not a type word. */
const TASK_NOUNS = new Set([
  'informe',
  'informes',
  'reporte',
  'reportes',
  'ejercicio',
  'ejercicios',
  'guia',
  'guias',
  'documento',
  'documentos',
  'avance',
  'avances',
  'ensayo',
  'ensayos',
  'resumen',
  'laboratorio',
  'actividad',
]);
const READ_NOUNS = new Set([
  'capitulo',
  'capitulos',
  'articulo',
  'articulos',
  'texto',
  'textos',
  'libro',
  'paginas',
]);
const NOUN_SKIPPABLE = new Set([
  ...STOPWORDS,
  'su',
  'sus',
  'mi',
  'nuestro',
  'nuestra',
  'este',
  'esta',
]);
/**
 * Words that say "this is something that will happen or must be handed in". A type word alone ("el parcial es
 * importante") is not enough to propose an activity: it needs a date, a time, a subject or one of these.
 */
export const ACADEMIC_CUES = new Set([
  'tendremos',
  'tendran',
  'tenemos',
  'tendra',
  'tengan',
  'entregar',
  'entrega',
  'entregan',
  'entreguen',
  'entregaremos',
  'entregara',
  'entregaran',
  'deben',
  'debemos',
  'deberan',
  'realizara',
  'realizaremos',
  'realizaran',
  'realizamos',
  'habra',
  'hay',
  'presentaran',
  'presentar',
  'presentaremos',
  'programado',
  'programada',
]);

interface Anchor {
  start: number;
  length: number;
  /** Set when the activity is recognised from wording ("entregar informe") rather than from a type word. */
  implicitType: ActivityType | null;
}

/** Token ranges where a subject's FULL name is written: a type word inside them ("Taller de Redes") is not an activity. */
function exactSubjectRanges(tokens: Token[], entries: SubjectEntry[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const entry of entries) {
    const n = entry.tokens.length;
    if (n === 0) continue;
    for (let start = 0; start + n <= tokens.length; start++) {
      if (tokens[start]!.norm !== entry.tokens[0]) continue;
      const joined = tokens
        .slice(start, start + n)
        .map((t) => t.norm)
        .join(' ');
      if (joined === entry.norm) ranges.push([start, start + n]);
    }
  }
  return ranges;
}

/**
 * Activities that are not a school type but are still one ("reunión de semillero", "cita con el tutor", "llevar
 * documentos"): the noun or the verb is the anchor and the type is read from the wording. Only the multi-activity
 * capture asks for them (`extendedAnchors`): the inbox keeps its conservative reading of pasted messages.
 */
const MEETING_NOUNS = new Set(['reunion', 'reuniones', 'cita', 'citas', 'tramite', 'tramites']);
const ERRAND_VERBS = new Set([
  'llevar',
  'pagar',
  'renovar',
  'inscribir',
  'solicitar',
  'recoger',
  'radicar',
  'matricular',
]);

function findAnchors(tokens: Token[], entries: SubjectEntry[], extended = false): Anchor[] {
  const subjectRanges = exactSubjectRanges(tokens, entries);
  const anchors: Anchor[] = [];
  for (const hit of findTypes(tokens)) {
    if (subjectRanges.some(([from, to]) => hit.start >= from && hit.start + hit.length <= to))
      continue;
    const previous = anchors.at(-1);
    if (previous && previous.implicitType === null) {
      const between = tokens.slice(previous.start + previous.length, hit.start);
      if (between.length <= 2 && between.every((t) => PHRASE_CONNECTORS.has(t.norm))) continue;
    }
    anchors.push({ start: hit.start, length: hit.length, implicitType: null });
  }
  for (let i = 0; i < tokens.length; i++) {
    const verb = tokens[i]!.norm;
    const kind: ActivityType | null = DELIVER_VERBS.has(verb)
      ? 'TASK'
      : READ_VERBS.has(verb)
        ? 'READING'
        : null;
    if (kind === null) continue;
    const nouns = kind === 'TASK' ? TASK_NOUNS : READ_NOUNS;
    let j = i + 1;
    while (j < tokens.length && j <= i + 3 && NOUN_SKIPPABLE.has(tokens[j]!.norm)) j++;
    const noun = tokens[j];
    if (noun && nouns.has(noun.norm) && !anchors.some((a) => a.start >= i && a.start <= j)) {
      anchors.push({ start: i, length: 1, implicitType: kind });
    }
  }
  if (extended) {
    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i]!.norm;
      const implicitType: ActivityType | null = MEETING_NOUNS.has(word)
        ? 'OTHER'
        : ERRAND_VERBS.has(word)
          ? 'TASK'
          : null;
      if (implicitType === null) continue;
      const inside = anchors.some((a) => i >= a.start && i < a.start + a.length);
      const inSubjectName = subjectRanges.some(([from, to]) => i >= from && i < to);
      if (!inside && !inSubjectName) anchors.push({ start: i, length: 1, implicitType });
    }
  }
  return anchors.sort((a, b) => a.start - b.start);
}

// ───────────────────────── Candidates ─────────────────────────

/** A stretch of a message that talks about ONE activity. Plain data: nothing is interpreted yet. */
export interface AcademicCandidate {
  sentenceIndex: number;
  /** The words as pasted (punctuation kept): "where did this proposal come from?". */
  rawSegment: string;
  /** What is interpreted: the activity's own words. */
  text: string;
  /** Words of the sentence BEFORE its first activity ("El martes a las 10 tendremos…"), shared by all of them. */
  sharedText: string;
  /** The type recognised from wording ("entregar informe") when `text` has no type word. */
  implicitType: ActivityType | null;
}

/**
 * Where does the clause of anchor `k` begin? After the last conjunction ("y", "además"…) or at the last
 * comma/semicolon between the two activities; with neither, right before the second activity's own word.
 */
function clauseStart(tokens: Token[], previous: Anchor, current: Anchor): number {
  let best = -1;
  for (let p = previous.start + previous.length; p < current.start; p++) {
    const t = tokens[p]!;
    if (CLAUSE_SPLITTERS.has(t.norm)) best = Math.max(best, p + 1);
    else if (t.afterBreak) best = Math.max(best, p);
  }
  return best >= 0 ? best : current.start;
}

/**
 * Segments a message into candidates, one per activity. Pure and deterministic. A sentence with no activity word
 * ("Buenas tardes estudiantes.", "Gracias por su atención.") yields none. Several activities in one sentence are
 * cut at their conjunctions or commas; what the sentence says BEFORE its first activity is shared by all of them.
 */
export function extractAcademicCandidates(
  text: string,
  context: Pick<QuickCaptureContext, 'subjects'>,
  options: { extendedAnchors?: boolean; splitLeading?: boolean } = {},
): { candidates: AcademicCandidate[]; sentences: number } {
  const entries = buildSubjectEntries(context.subjects);
  const sentences = splitSentences(text);
  const candidates: AcademicCandidate[] = [];

  sentences.forEach((sentence, sentenceIndex) => {
    const tokens = tokenize(sentence);
    const anchors = findAnchors(tokens, entries, options.extendedAnchors === true);
    if (anchors.length === 0) return;

    const starts = [0];
    for (let k = 1; k < anchors.length; k++)
      starts.push(clauseStart(tokens, anchors[k - 1]!, anchors[k]!));
    const slice = (from: number, to: number) =>
      from >= to ? '' : sentence.slice(tokens[from]!.start, tokens[to - 1]!.end);
    const sharedText = slice(0, anchors[0]!.start);

    // "Ensayo lunes y reunión martes": the words BEFORE the first activity word are an activity of their own when they
    // carry their own day and the clause of that activity word has its own too (quick capture only: a pasted message
    // shares what comes before, "El martes tendremos parcial…").
    let leadingSplit = false;
    if (options.splitLeading && anchors[0]!.start > 0) {
      const lead = tokens.slice(0, anchors[0]!.start);
      const clauseEnd = anchors.length > 1 ? starts[1]! : tokens.length;
      const dates = findDateExpressions(lead);
      const dated = new Set(
        dates.flatMap((d) => lead.slice(d.match.start, d.match.start + d.match.length)),
      );
      const ownWords = lead.filter(
        (t) =>
          !dated.has(t) &&
          !STOPWORDS.has(t.norm) &&
          !/^\d/.test(t.norm) &&
          !['am', 'pm', 'las', 'la'].includes(t.norm) &&
          !CLAUSE_SPLITTERS.has(t.norm),
      );
      if (
        dates.length > 0 &&
        ownWords.length > 0 &&
        findDateExpressions(tokens.slice(anchors[0]!.start, clauseEnd)).length > 0
      ) {
        let cut = anchors[0]!.start;
        while (cut > 0 && CLAUSE_SPLITTERS.has(tokens[cut - 1]!.norm)) cut--;
        const own = slice(0, cut);
        candidates.push({
          sentenceIndex,
          rawSegment: own.trim(),
          text: own,
          sharedText: '',
          implicitType: null,
        });
        starts[0] = anchors[0]!.start;
        leadingSplit = true;
      }
    }

    anchors.forEach((anchor, k) => {
      const from = starts[k]!;
      const to = k + 1 < anchors.length ? starts[k + 1]! : tokens.length;
      const own = slice(from, to);
      // For display only: without the conjunction that joined it to its neighbour, and with the sentence's
      // closing punctuation when it is the last activity.
      let shownFrom = from;
      let shownTo = to;
      while (shownFrom < shownTo && CLAUSE_SPLITTERS.has(tokens[shownFrom]!.norm)) shownFrom++;
      while (shownTo > shownFrom && CLAUSE_SPLITTERS.has(tokens[shownTo - 1]!.norm)) shownTo--;
      const shown =
        shownFrom >= shownTo
          ? own
          : sentence.slice(
              tokens[shownFrom]!.start,
              shownTo === tokens.length ? sentence.length : tokens[shownTo - 1]!.end,
            );
      candidates.push({
        sentenceIndex,
        rawSegment: shown.trim(),
        text: own,
        sharedText: k === 0 || leadingSplit ? '' : sharedText,
        implicitType: anchor.implicitType,
      });
    });
  });
  return { candidates, sentences: sentences.length };
}

// ───────────────────────── Proposals ─────────────────────────

export const ACADEMIC_INBOX_WARNING_CODES = [
  ...QUICK_CAPTURE_WARNING_CODES,
  'SUBJECT_INHERITED',
  'POSSIBLE_DUPLICATE',
] as const;

const subjectRef = z.object({ id: z.uuid(), name: z.string() });
const certainty = z.enum(FIELD_CERTAINTIES);

export const academicInboxProposalSchema = z.object({
  index: z.number().int().nonnegative(),
  /** The words of the message this proposal came from (never stored). */
  rawSegment: z.string(),
  /** COMPLETE when title, subject and date are known; otherwise the student completes it. */
  status: z.enum(['COMPLETE', 'INCOMPLETE']),
  title: z.string(),
  type: z.enum(ACTIVITY_TYPES),
  subjectId: z.uuid().nullable(),
  dueDate: z.string().nullable(),
  /** HH:mm, 24 hours. null = no time (the activity is due at the end of the day). */
  dueTime: z.string().nullable(),
  hasTime: z.boolean(),
  certainty: z.object({ type: certainty, subject: certainty, date: certainty, time: certainty }),
  recognizedFields: z.array(z.enum(QUICK_CAPTURE_FIELDS)),
  missingFields: z.array(z.enum(['title', 'subject', 'date'])),
  ambiguities: z.array(z.object({ field: z.literal('subject'), candidates: z.array(subjectRef) })),
  warnings: z.array(z.object({ code: z.enum(ACADEMIC_INBOX_WARNING_CODES), message: z.string() })),
  /** An existing activity of the user that looks like this one (same subject, day, type and title). */
  duplicateOf: z.object({ id: z.uuid(), title: z.string() }).nullable(),
});
export type AcademicInboxProposal = z.infer<typeof academicInboxProposalSchema>;

export const academicInboxResultSchema = z.object({
  status: z.enum(['OK', 'EMPTY', 'TOO_LONG']),
  proposals: z.array(academicInboxProposalSchema).max(ACADEMIC_INBOX_MAX_PROPOSALS),
  warnings: z.array(
    z.object({ code: z.enum(['EMPTY', 'TOO_LONG', 'TOO_MANY_PROPOSALS']), message: z.string() }),
  ),
  stats: z.object({
    characters: z.number().int().nonnegative(),
    sentences: z.number().int().nonnegative(),
    /** Activities found before the limit and the duplicate collapse. */
    candidates: z.number().int().nonnegative(),
  }),
});
export type AcademicInboxResult = z.infer<typeof academicInboxResultSchema>;

/** POST /api/academic-inbox/parse. Strict: nothing but `text`. */
export const academicInboxRequestSchema = z.strictObject({
  text: z
    .string({ error: ACADEMIC_INBOX_MESSAGES.EMPTY })
    .max(ACADEMIC_INBOX_REQUEST_MAX, ACADEMIC_INBOX_MESSAGES.TOO_LONG),
});
export type AcademicInboxRequest = z.infer<typeof academicInboxRequestSchema>;

export const academicInboxResponseSchema = z.object({
  inbox: academicInboxResultSchema,
  period: periodSchema.nullable(),
});
export type AcademicInboxResponse = z.infer<typeof academicInboxResponseSchema>;

const emptyResult = (status: 'EMPTY' | 'TOO_LONG', characters: number): AcademicInboxResult => ({
  status,
  proposals: [],
  warnings: [{ code: status, message: ACADEMIC_INBOX_MESSAGES[status] }],
  stats: { characters, sentences: 0, candidates: 0 },
});

/**
 * Interprets a pasted message into proposals. Never throws. Each candidate is read with the quick-capture rules;
 * it becomes a proposal only if it has something besides a type word to stand on (a date, a time, a subject or a
 * "must be handed in / will take place" wording), identical proposals are collapsed, and at most
 * ACADEMIC_INBOX_MAX_PROPOSALS are returned. A proposal may be incomplete: it is still useful.
 */
export function parseAcademicInbox(
  text: string,
  context: QuickCaptureContext,
): AcademicInboxResult {
  const trimmed = text.trim();
  if (trimmed === '') return emptyResult('EMPTY', 0);
  if (trimmed.length > ACADEMIC_INBOX_MAX_LENGTH) return emptyResult('TOO_LONG', trimmed.length);

  const { candidates, sentences } = extractAcademicCandidates(trimmed, context);
  const proposals: Omit<AcademicInboxProposal, 'index'>[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const tokens = tokenize(candidate.text);
    const shared = candidate.sharedText === '' ? undefined : tokenize(candidate.sharedText);
    const interpreted = interpretTokens(tokens, context, {
      flagMultipleTypes: false,
      richTitle: true,
      implicitType: candidate.implicitType,
      shared,
    });
    const { meta, ...interpretation } = interpreted;

    const supported =
      interpretation.recognizedFields.some(
        (f) => f === 'date' || f === 'time' || f === 'subject',
      ) ||
      interpretation.certainty.subject === 'AMBIGUOUS' ||
      tokens.some((t) => ACADEMIC_CUES.has(t.norm));
    if (!supported) continue;

    const key = [
      interpretation.type,
      normalizeNameKey(interpretation.title),
      interpretation.dueDate ?? '',
      interpretation.subjectId ?? '',
    ].join('|');
    if (seen.has(key)) continue; // the same reminder said twice
    seen.add(key);

    const warnings: AcademicInboxProposal['warnings'] = [...interpretation.warnings];
    if (meta.subjectFromShared) {
      warnings.push({
        code: 'SUBJECT_INHERITED',
        message: ACADEMIC_INBOX_MESSAGES.SUBJECT_INHERITED,
      });
    }
    proposals.push({
      rawSegment: candidate.rawSegment,
      status: interpretation.missingFields.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
      ...interpretation,
      warnings,
      duplicateOf: null,
    });
  }

  const warnings: AcademicInboxResult['warnings'] = [];
  if (proposals.length > ACADEMIC_INBOX_MAX_PROPOSALS) {
    warnings.push({
      code: 'TOO_MANY_PROPOSALS',
      message: ACADEMIC_INBOX_MESSAGES.TOO_MANY_PROPOSALS,
    });
  }
  return {
    status: 'OK',
    proposals: proposals
      .slice(0, ACADEMIC_INBOX_MAX_PROPOSALS)
      .map((p, index) => ({ ...p, index })),
    warnings,
    stats: { characters: trimmed.length, sentences, candidates: candidates.length },
  };
}

// ───────────────────────── Possible duplicates ─────────────────────────

export interface ExistingActivity {
  id: string;
  title: string;
  type: ActivityType;
  /** null for a general activity: it never matches a proposal (a duplicate is judged by subject). */
  subjectId: string | null;
  dueAt: Date | string;
}

const titleWords = (title: string) => normalizeNameKey(title).split(' ').filter(Boolean);
const isPrefix = (a: string[], b: string[]) =>
  a.length <= b.length && a.every((w, i) => b[i] === w);

/**
 * Two titles are the same activity when, once normalised, one is the other or the start of the other
 * ("Parcial" / "Parcial 1"), but "Parcial 1" and "Parcial 2" are different. No fuzzy matching.
 */
export function titlesAreRelated(a: string, b: string): boolean {
  const [wa, wb] = [titleWords(a), titleWords(b)];
  return wa.length > 0 && wb.length > 0 && (isPrefix(wa, wb) || isPrefix(wb, wa));
}

/**
 * Flags the proposals that look like an activity the user already has: same subject, same local day, same type and
 * related title. It only warns; it never blocks. `existing` must already be the user's own activities.
 */
export function markPossibleDuplicates(
  proposals: readonly AcademicInboxProposal[],
  existing: readonly ExistingActivity[],
  timeZone: string,
): AcademicInboxProposal[] {
  const byDay = new Map<DateOnly, ExistingActivity[]>();
  for (const activity of existing) {
    const day = toLocalParts(activity.dueAt, timeZone).date;
    byDay.set(day, [...(byDay.get(day) ?? []), activity]);
  }
  return proposals.map((p) => {
    if (p.subjectId === null || p.dueDate === null) return p;
    const match = (byDay.get(p.dueDate) ?? []).find(
      (a) => a.subjectId === p.subjectId && a.type === p.type && titlesAreRelated(a.title, p.title),
    );
    if (!match) return p;
    return {
      ...p,
      duplicateOf: { id: match.id, title: match.title },
      warnings: [
        ...p.warnings,
        { code: 'POSSIBLE_DUPLICATE', message: ACADEMIC_INBOX_MESSAGES.POSSIBLE_DUPLICATE },
      ],
    };
  });
}
