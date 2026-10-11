import { splitSentences, findAnchors, CLAUSE_SPLITTERS, type Anchor } from './academicInbox.js';
import { cueLength } from './captureContext.js';
import type { ActivityType } from './activity.js';
import {
  PLURAL_TYPE_WORDS,
  QUICK_CAPTURE_TYPE_ALIASES,
  STOPWORDS,
  buildSubjectEntries,
  findDateExpressions,
  matchSubject,
  matchTimeAt,
  tokenize,
  type QuickCaptureContext,
  type SubjectEntry,
  type Token,
} from './captureShared.js';

/**
 * THE DISCOURSE LAYER: who is talking about what.
 *
 * A loose message ("tengo un parcial de redes para el jueves y un ensayo de ciberseguridad el lunes, el parcial es a las
 * 7 y el ensayo a las 5 de la tarde") does not say each activity once, next to its day and hour. It MENTIONS an activity,
 * and later REFERS to it again to add a detail. This layer reads the text into spans (one per noun phrase that names an
 * activity) and decides, for each, whether it INTRODUCES a new activity or REFERS to one already introduced:
 *
 *   entities   the activity words (a type, "ensayo", "reunión"), a quantity ("dos tareas"), a determiner ("un", "el");
 *   relations  a span runs from its noun phrase to the next one: the days, hours and subject inside it are its own;
 *   references a definite noun phrase ("el parcial", "las dos tareas", "ambos") whose type matches an earlier mention
 *              is not a new activity: it adds details to that one. If it could be either of several, it says so.
 *
 * It is a handful of Spanish rules over tokens, deterministic, with no grammar and no model. What it cannot place it
 * leaves visible (an ambiguous reference) instead of guessing. The engine (`captureProposals.ts`) turns the spans into
 * proposals.
 */

export type SpanKind = 'TYPE' | 'IMPLICIT' | 'ELLIPTICAL' | 'PRONOUN' | 'LEADING' | 'DETAIL';
export type SpanRole = 'INTRO' | 'REFER';

export interface DiscourseSpan {
  /** Position among all the spans of the text. */
  index: number;
  sentenceIndex: number;
  /** The words as written (for "where did this come from?"). */
  rawSegment: string;
  /** The span's words, to be tokenised again by whoever reads it. */
  text: string;
  /** Words of the sentence BEFORE its first activity, shared by the activities that follow ("El martes … tendremos"). */
  sharedText: string;
  /** The type read from wording that is not a type word ("entregar informe", "ensayo"). */
  implicitType: ActivityType | null;
  kind: SpanKind;
  role: SpanRole;
  /** The quantity said in the noun phrase ("dos tareas" -> 2); null when it did not say one. */
  count: number | null;
  /** "el parcial", "las dos tareas": it can refer back; "un parcial", "tarea" cannot. */
  definite: boolean;
  /** What kind of activity the noun names: the type, or the noun itself for "ensayo", "reunión". */
  typeKey: string;
  /** Index, in the tokens of `text`, of the word that names the activity; -1 for a pronoun. */
  anchorIndex: number;
  /** Index where the noun phrase ("las dos", "un") starts. */
  headIndex: number;
  /** How many tokens the activity word (or the pronoun) takes. */
  anchorLength: number;
  /** REFER: the `index` of every introduced span it adds details to. Empty: nothing to add to. */
  targets: number[];
  /** REFER that could have been several activities and no word chose one. */
  ambiguous: boolean;
}

// ───────────────────────── Small dictionaries ─────────────────────────

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
};
/** "dos", "tres", "12": a quantity. A digit only counts before a PLURAL noun ("3 tareas"), never in "taller 2". */
const numberOf = (norm: string, allowDigits = true): number | null =>
  NUMBER_WORDS[norm] ?? (allowDigits && /^([2-9]|[1-9]\d)$/.test(norm) ? Number(norm) : null);

const DEFINITE = new Set([
  'el',
  'la',
  'los',
  'las',
  'lo',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'esos',
  'esas',
  'dicho',
  'dicha',
  'dichos',
  'dichas',
  'mi',
  'mis',
  'su',
  'sus',
  'ambos',
  'ambas',
]);
const INDEFINITE_HEAD = new Set(['un', 'una', 'unos', 'unas', 'otro', 'otra', 'otros', 'otras']);
/** Words that make up the noun phrase before the activity word ("las dos", "un", "esos"). */
const HEAD_WORDS = new Set([...DEFINITE, ...INDEFINITE_HEAD, ...Object.keys(NUMBER_WORDS)]);
/** "uno para el jueves y otro para el viernes": an enumerator, not a new activity. */
const ENUMERATORS = new Set(['uno', 'una', 'unos', 'unas', 'otro', 'otra', 'otros', 'otras']);
/** What may follow "las dos" for it to be a pronoun ("las dos son a las 8") and not a time or a positional phrase. */
const PRONOUN_FOLLOWERS = new Set([
  'son',
  'es',
  'a',
  'para',
  'seran',
  'sera',
  'van',
  'quedan',
  'se',
  'tengo',
  'tienen',
  'deben',
  'debo',
  'entregar',
  'entregarlas',
  'entregarlos',
  'presentar',
  'presentarlas',
  'presentarlos',
  'con',
  'en',
  'hay',
  'que',
  'ya',
  'no',
]);
const NOUN_IMPLICIT = new Set([
  'ensayo',
  'ensayos',
  'reunion',
  'reuniones',
  'cita',
  'citas',
  'tramite',
  'tramites',
]);

// ───────────────────────── Anchors and noun phrases ─────────────────────────

type DiscourseAnchor = Anchor & { kind: SpanKind; count: number | null; headStart: number };

/** The type word of an anchor: "parcial" -> EXAM; "ensayo" -> itself (singular); others by their own key. */
function typeKeyOf(tokens: readonly Token[], anchor: Anchor): string {
  const first = tokens[anchor.start]!.norm;
  const two = anchor.length > 1 ? `${first} ${tokens[anchor.start + 1]!.norm}` : first;
  const type = QUICK_CAPTURE_TYPE_ALIASES[two] ?? QUICK_CAPTURE_TYPE_ALIASES[first];
  if (type && anchor.implicitType === null) return type;
  return `word:${first.replace(/(es|s)$/, '')}`;
}

/** Where the noun phrase of the anchor starts: the determiner and quantity words right before it. */
function headStartOf(
  tokens: readonly Token[],
  anchorStart: number,
  lowerBound: number,
  plural: boolean,
): number {
  let h = anchorStart;
  while (
    h > lowerBound &&
    anchorStart - h < 3 &&
    (HEAD_WORDS.has(tokens[h - 1]!.norm) || (plural && numberOf(tokens[h - 1]!.norm) !== null)) &&
    !tokens[h]!.afterBreak
  )
    h--;
  return h;
}

function nounPhrase(
  tokens: readonly Token[],
  head: number,
  anchor: number,
  plural: boolean,
): { count: number | null; definite: boolean } {
  let count: number | null = null;
  let definite = false;
  for (let i = head; i < anchor; i++) {
    const norm = tokens[i]!.norm;
    if (DEFINITE.has(norm)) definite = true;
    const n = numberOf(norm, plural);
    if (n !== null && count === null && !(norm === 'un' || norm === 'una')) count = n;
  }
  if (count === null && !plural && head < anchor) count = 1;
  return { count, definite };
}

const isPluralWord = (norm: string) => PLURAL_TYPE_WORDS.has(norm) || norm === 'ensayos';

/**
 * Anchors that are not a noun: "las dos" / "ambos" (a reference to a group, "las dos son a las 8") and "otra" ("una
 * tarea el jueves y OTRA el viernes": a second activity of the same kind as the previous one).
 */
function extraAnchors(tokens: Token[], anchors: DiscourseAnchor[]): DiscourseAnchor[] {
  const out: DiscourseAnchor[] = [];
  const covered = (i: number) => anchors.some((a) => i >= a.headStart && i < a.start + a.length);
  for (let i = 0; i < tokens.length; i++) {
    if (covered(i)) continue;
    const norm = tokens[i]!.norm;
    const next = tokens[i + 1]?.norm;
    const before = tokens[i - 1]?.norm;
    if ((norm === 'los' || norm === 'las') && next !== undefined) {
      const n = numberOf(next);
      const after = tokens[i + 2]?.norm;
      if (
        n !== null &&
        n >= 2 &&
        before !== 'a' &&
        before !== 'de' &&
        (after === undefined || PRONOUN_FOLLOWERS.has(after))
      ) {
        out.push({
          start: i,
          length: 2,
          implicitType: null,
          kind: 'PRONOUN',
          count: n,
          headStart: i,
        });
        i += 1;
      }
    } else if (norm === 'ambos' || norm === 'ambas') {
      const after = tokens[i + 1]?.norm;
      if (after === undefined || PRONOUN_FOLLOWERS.has(after) || !HEAD_WORDS.has(after)) {
        const isNoun = anchors.some((a) => a.start === i + 1);
        if (!isNoun)
          out.push({
            start: i,
            length: 1,
            implicitType: null,
            kind: 'PRONOUN',
            count: 2,
            headStart: i,
          });
      }
    }
  }
  return out;
}

/** "y otra el viernes": the previous activity's kind again, with its own day. Only after a single activity, not a group. */
function ellipticalAnchors(tokens: Token[], anchors: DiscourseAnchor[]): DiscourseAnchor[] {
  const out: DiscourseAnchor[] = [];
  const sorted = [...anchors].sort((a, b) => a.start - b.start);
  for (let i = 1; i < tokens.length; i++) {
    const norm = tokens[i]!.norm;
    if (norm !== 'otro' && norm !== 'otra') continue;
    if (sorted.some((a) => i >= a.headStart && i < a.start + a.length)) continue;
    const joined = CLAUSE_SPLITTERS.has(tokens[i - 1]!.norm) || tokens[i]!.afterBreak;
    if (!joined) continue;
    const previous = [...sorted, ...out].filter((a) => a.start < i).at(-1);
    if (!previous || previous.kind === 'PRONOUN') continue;
    if (previous.count !== null && previous.count > 1) continue; // a group's own enumerators
    const word = tokens[previous.start]!.norm;
    const isNoun = QUICK_CAPTURE_TYPE_ALIASES[word] !== undefined || NOUN_IMPLICIT.has(word);
    if (!isNoun) continue;
    const reach = tokens.slice(i + 1, i + 5);
    if (findDateExpressions(reach).length === 0 && !reach.some((t) => t.norm === 'para')) continue;
    out.push({
      start: i,
      length: 1,
      implicitType: previous.implicitType,
      kind: 'ELLIPTICAL',
      count: 1,
      headStart: i,
    });
  }
  return out;
}

const datesIn = (tokens: readonly Token[], from: number, to: number) =>
  from >= to ? 0 : findDateExpressions(tokens.slice(from, to)).length;

/**
 * Where the stretch of anchor `cur` begins, between the previous anchor and it. The cut goes after the last
 * conjunction or comma that really starts a new activity, else right before its noun phrase. A conjunction does NOT
 * start one when what follows it is an enumerator ("uno para el jueves y OTRO para el viernes") or the previous activity
 * still needs days ("dos tareas jueves y viernes").
 */
function cutBetween(
  tokens: readonly Token[],
  previous: DiscourseAnchor,
  previousFrom: number,
  cur: DiscourseAnchor,
): number {
  const limit = cur.headStart;
  let best = -1;
  for (let p = previous.start + previous.length; p < limit; p++) {
    const t = tokens[p]!;
    let cut = -1;
    if (CLAUSE_SPLITTERS.has(t.norm)) cut = p + 1;
    else if (t.afterBreak) cut = p;
    if (cut < 0 || cut > limit) continue;
    if (cut < limit && ENUMERATORS.has(tokens[cut]!.norm)) continue;
    if (cut < limit && datesIn(tokens, cut, limit) > 0) {
      const needsMore =
        previous.count !== null &&
        previous.count > 1 &&
        datesIn(tokens, previousFrom, cut) < previous.count;
      if (needsMore) continue;
    }
    best = Math.max(best, cut);
  }
  return best >= 0 ? best : limit;
}

// ───────────────────────── Segmentation ─────────────────────────

interface RawSpan extends Omit<DiscourseSpan, 'index' | 'role' | 'targets' | 'ambiguous'> {
  /** The subject written in these words (to match a reference to the right activity). */
  subjectId: string | null;
}

function subjectOfText(text: string, entries: SubjectEntry[]): string | null {
  const m = matchSubject(tokenize(text), entries);
  return m.kind === 'match' ? m.subject.id : null;
}

export function segmentDiscourse(
  text: string,
  context: Pick<QuickCaptureContext, 'subjects'>,
  options: { splitLeading?: boolean; implicitDetails?: boolean } = {},
): DiscourseSpan[] {
  const entries = buildSubjectEntries(context.subjects);
  const raws: RawSpan[] = [];

  /**
   * "Es el jueves a las 7": a sentence with no activity word but with a day or an hour, right after one that named
   * activities, is a detail about THEM (Quick Capture only: a pasted message may have sentences about anything). Which
   * one is decided with the references.
   */
  const pushDetail = (sentence: string, tokens: Token[], sentenceIndex: number) => {
    if (!options.implicitDetails || raws.length === 0) return;
    const temporal =
      findDateExpressions(tokens).length > 0 ||
      tokens.some((_, i) => matchTimeAt(tokens, i, { ambiguousBareHours: true }) !== null);
    // ...or a piece of context ("Hay que subirlas en PDF"): it is about the activities just named.
    const context = tokens.some((_, i) => cueLength(tokens, i) > 0);
    if (!temporal && !context) return;
    raws.push({
      sentenceIndex,
      rawSegment: sentence,
      text: sentence,
      sharedText: '',
      implicitType: null,
      kind: 'DETAIL',
      count: null,
      definite: true,
      typeKey: 'detail',
      anchorIndex: -1,
      headIndex: 0,
      anchorLength: 0,
      subjectId: subjectOfText(sentence, entries),
    });
  };

  splitSentences(text).forEach((sentence, sentenceIndex) => {
    const tokens = tokenize(sentence);
    // "otro" is also a type word ("Otro"), but in running text it is "uno … otro": an enumerator, never an activity.
    const found = findAnchors(tokens, entries, true, new Set(['otro']));
    const base = found.map((a): DiscourseAnchor => {
      const word = tokens[a.start]!.norm;
      const kind: SpanKind = a.implicitType === null ? 'TYPE' : 'IMPLICIT';
      const plural = isPluralWord(word);
      const headStart = headStartOf(tokens, a.start, 0, plural);
      const { count } = nounPhrase(tokens, headStart, a.start, plural);
      return { ...a, kind, count, headStart };
    });
    if (base.length === 0 && !tokens.some((t) => numberOf(t.norm) !== null)) {
      pushDetail(sentence, tokens, sentenceIndex);
      return;
    }
    let anchors: DiscourseAnchor[] = [...base, ...extraAnchors(tokens, base)];
    anchors.sort((a, b) => a.start - b.start);
    anchors = [...anchors, ...ellipticalAnchors(tokens, anchors)].sort((a, b) => a.start - b.start);
    // "Reunión el viernes, LLEVAR el portátil": a verb of preparing right after another activity, with no day or hour
    // of its own, is context for that activity (its description), not a new activity.
    anchors = anchors.filter((a, i) => {
      if (i === 0 || a.kind !== 'IMPLICIT' || cueLength(tokens, a.start) === 0) return true;
      const end = anchors[i + 1]?.headStart ?? tokens.length;
      const own = tokens.slice(a.start, end);
      const dated =
        findDateExpressions(own).length > 0 ||
        own.some((_, j) => matchTimeAt(own, j, { ambiguousBareHours: true }) !== null);
      return dated;
    });
    // A pronoun with nothing before it to refer to is not an activity: only keep it when a real anchor precedes it.
    anchors = anchors.filter(
      (a, i) =>
        a.kind !== 'PRONOUN' ||
        anchors.slice(0, i).some((b) => b.kind !== 'PRONOUN') ||
        sentenceIndex > 0,
    );
    if (anchors.length === 0) {
      pushDetail(sentence, tokens, sentenceIndex);
      return;
    }

    const starts: number[] = [0];
    for (let k = 1; k < anchors.length; k++) {
      starts.push(cutBetween(tokens, anchors[k - 1]!, starts[k - 1]!, anchors[k]!));
    }
    const slice = (from: number, to: number) =>
      from >= to ? '' : sentence.slice(tokens[from]!.start, tokens[to - 1]!.end);
    const sharedText = slice(0, anchors[0]!.headStart);

    // "Ensayo lunes y reunión martes" / "Ciberseguridad martes y reunión jueves": the words BEFORE the first activity
    // word are an activity of their own when they carry their own day and the stretch of that word has its own too
    // (quick capture only: a pasted message shares what comes before, "El martes tendremos parcial…").
    let leadingSplit = false;
    if (options.splitLeading && anchors[0]!.headStart > 0) {
      const lead = tokens.slice(0, anchors[0]!.headStart);
      const stretchEnd = anchors.length > 1 ? starts[1]! : tokens.length;
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
        findDateExpressions(tokens.slice(anchors[0]!.headStart, stretchEnd)).length > 0
      ) {
        let cut = anchors[0]!.headStart;
        while (cut > 0 && CLAUSE_SPLITTERS.has(tokens[cut - 1]!.norm)) cut--;
        const own = slice(0, cut);
        raws.push({
          sentenceIndex,
          rawSegment: own.trim(),
          text: own,
          sharedText: '',
          implicitType: null,
          kind: 'LEADING',
          count: null,
          definite: false,
          typeKey: 'leading',
          anchorIndex: -1,
          headIndex: 0,
          anchorLength: 0,
          subjectId: subjectOfText(own, entries),
        });
        starts[0] = anchors[0]!.headStart;
        leadingSplit = true;
      }
    }

    let previousSubjectText = '';
    anchors.forEach((anchor, k) => {
      const from = starts[k]!;
      const to = k + 1 < anchors.length ? starts[k + 1]! : tokens.length;
      let own = slice(from, to);
      let anchorIndex = anchor.start - from;
      let headIndex = Math.max(0, anchor.headStart - from);
      let shared = k === 0 || leadingSplit ? '' : sharedText;

      if (anchor.kind === 'ELLIPTICAL') {
        // "otra el viernes" -> "tarea el viernes": the previous activity's noun, and its subject only as shared context.
        const previous = [...anchors]
          .slice(0, k)
          .reverse()
          .find((a) => a.kind !== 'PRONOUN')!;
        const noun = tokens[previous.start]!.raw;
        own = `${noun} ${slice(anchor.start + 1, to)}`.trim();
        anchorIndex = 0;
        headIndex = 0;
        shared = previousSubjectText;
      }
      const plural = anchor.kind !== 'PRONOUN' && isPluralWord(tokens[anchor.start]!.norm);
      const { count, definite } =
        anchor.kind === 'PRONOUN'
          ? { count: anchor.count, definite: true }
          : anchor.kind === 'ELLIPTICAL'
            ? { count: 1, definite: false }
            : nounPhrase(tokens, anchor.headStart, anchor.start, plural);

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

      const typeKey =
        anchor.kind === 'PRONOUN'
          ? 'pronoun'
          : anchor.kind === 'ELLIPTICAL'
            ? typeKeyOf(
                tokens,
                [...anchors]
                  .slice(0, k)
                  .reverse()
                  .find((a) => a.kind !== 'PRONOUN')!,
              )
            : typeKeyOf(tokens, anchor);

      const subjectMatch = matchSubject(tokenize(own), entries);
      if (subjectMatch.kind === 'match') {
        const t = tokenize(own);
        previousSubjectText = t
          .slice(subjectMatch.start, subjectMatch.start + subjectMatch.length)
          .map((x) => x.raw)
          .join(' ');
      }

      raws.push({
        sentenceIndex,
        rawSegment: shown.trim(),
        text: own,
        sharedText: shared,
        implicitType: anchor.implicitType,
        kind: anchor.kind,
        count,
        definite,
        typeKey,
        anchorIndex,
        headIndex,
        anchorLength: anchor.kind === 'ELLIPTICAL' ? 1 : anchor.length,
        subjectId: subjectMatch.kind === 'match' ? subjectMatch.subject.id : null,
      });
    });
  });

  return resolveReferences(raws);
}

// ───────────────────────── References ─────────────────────────

/**
 * Decides, span by span in the order written, whether it introduces an activity or refers to one introduced before.
 *  - A DEFINITE noun phrase ("el parcial", "las dos tareas") whose kind matches an earlier mention, and whose subject
 *    does not contradict it, is a reference.
 *  - "las dos" / "ambos" with no noun refer to the group of that size (or the last two mentions).
 *  - With several possible activities and nothing in the words to choose one, the reference is ambiguous: it adds its
 *    details to nobody, and the candidates are told so.
 */
function resolveReferences(raws: RawSpan[]): DiscourseSpan[] {
  const spans: DiscourseSpan[] = raws.map((r, index) => ({
    index,
    sentenceIndex: r.sentenceIndex,
    rawSegment: r.rawSegment,
    text: r.text,
    sharedText: r.sharedText,
    implicitType: r.implicitType,
    kind: r.kind,
    role: 'INTRO',
    count: r.count,
    definite: r.definite,
    typeKey: r.typeKey,
    anchorIndex: r.anchorIndex,
    headIndex: r.headIndex,
    anchorLength: r.anchorLength,
    targets: [],
    ambiguous: false,
  }));
  const intros: { span: DiscourseSpan; subjectId: string | null }[] = [];

  /** The last `n` introduced spans, when they are consecutive mentions of one single activity each (a cohort). */
  const cohort = (n: number, key?: string) => {
    const last = intros.slice(-n);
    if (last.length < n) return null;
    if (key !== undefined && !last.every((i) => i.span.typeKey === key)) return null;
    return last.every((i) => i.span.count === null || i.span.count <= 1) ? last : null;
  };

  spans.forEach((span, i) => {
    const subjectId = raws[i]!.subjectId;

    if (span.kind === 'DETAIL') {
      // About the activities of the previous sentence that named some: one of them, or it could be several.
      span.role = 'REFER';
      const before = intros.filter((x) => x.span.sentenceIndex < span.sentenceIndex);
      const last = before.at(-1)?.span.sentenceIndex;
      const same = before.filter((x) => x.span.sentenceIndex === last);
      span.targets = same.map((x) => x.span.index);
      span.ambiguous = same.length > 1;
      return;
    }

    if (span.kind === 'PRONOUN') {
      span.role = 'REFER';
      const n = span.count ?? 2;
      const groups = intros.filter((x) => x.span.count === n);
      const chosen = groups.length === 1 ? groups : (cohort(n) ?? []);
      span.targets = chosen.map((x) => x.span.index);
      span.ambiguous = chosen.length === 0;
      return;
    }

    const compatible = intros.filter(
      (x) =>
        x.span.typeKey === span.typeKey &&
        (subjectId === null || x.subjectId === null || x.subjectId === subjectId),
    );
    if (span.definite && compatible.length > 0) {
      span.role = 'REFER';
      if (span.count !== null && span.count >= 2) {
        const groups = compatible.filter((x) => x.span.count === span.count);
        const chosen = groups.length === 1 ? groups : (cohort(span.count, span.typeKey) ?? []);
        span.targets = chosen.map((x) => x.span.index);
        span.ambiguous = chosen.length === 0;
      } else if (compatible.length === 1) {
        span.targets = [compatible[0]!.span.index];
      } else {
        const exact = subjectId === null ? [] : compatible.filter((x) => x.subjectId === subjectId);
        if (exact.length === 1) span.targets = [exact[0]!.span.index];
        else {
          span.targets = compatible.map((x) => x.span.index);
          span.ambiguous = true;
        }
      }
      return;
    }
    intros.push({ span, subjectId });
  });
  return spans;
}
