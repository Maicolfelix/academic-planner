/**
 * NUMBER RUNS: "capítulos 3 y 4", "ejercicios 1 al 10", "páginas 10 a 15", "problemas 1, 2 y 3", "tema 3 a las 8 am" say WHAT is
 * asked for, not hours, quantities or days. Left alone, the engine read "10 a 15" as a range of hours (an hour nobody wrote),
 * "1, 2 y 3" as three more activities, "1-10" as a date and "tema 3 a las 8" as the hours 3 to 8, and cut the title after the
 * first number. This pass glues each run into ONE word with an invisible joiner (U+2060) so no reader sees several numbers; the
 * joiner turns back into the student's own spaces on the way out (`releaseJoiners`), so titles and evidence show exactly what
 * was typed.
 */
const JOINER = '⁠';
const COMMA = '，';

const NOUN =
  '(?:cap[ií]tulos?|ejercicios?|p[aá]ginas?|p[aá]gs?\\.?|problemas?|puntos?|temas?|unidades?|secciones?|lecciones?|m[oó]dulos?|numerales?|preguntas?)';
const NUMBER = '\\d{1,3}';
const RUN = `(?:del\\s+)?${NUMBER}(?:\\s*(?:,|y|e|al|a|-|–|—|hasta)\\s*${NUMBER})*`;
const NUMBER_RUN = new RegExp(`(?<![\\p{L}\\p{N}])(${NOUN}\\s+)(${RUN})(?![\\p{L}\\p{N}:])`, 'giu');

/** `text` with every number (or run of numbers) after a "chapter / exercise / page…" noun glued into one word. */
export function protectNumberRuns(text: string): string {
  return text.replace(NUMBER_RUN, (_whole, noun: string, run: string) => {
    // the tokenizer splits on commas, so a comma is glued as a full-width one and turns back into ", " on the way out
    const glued = run
      .replace(/\s*,\s*/g, COMMA + JOINER)
      .replace(/\s*([-–—])\s*/g, `${JOINER}$1${JOINER}`)
      .replace(/\s+/g, JOINER);
    return `${noun}${glued}${JOINER}`;
  });
}

/** The same data with every joiner turned back into a plain space (or removed, at the end of a word). */
export function releaseJoiners<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replaceAll(`${COMMA}${JOINER}`, ', ')
      .replace(/([-–—])⁠/g, '$1')
      .replace(/⁠([-–—])/g, '$1')
      .replace(/⁠$|⁠(?=\s)/g, '')
      .replaceAll(JOINER, ' ') as T;
  }
  if (Array.isArray(value)) return value.map((v) => releaseJoiners(v)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, releaseJoiners(v)]),
    ) as T;
  }
  return value;
}
