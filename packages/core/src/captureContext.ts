import type { Token } from './captureShared.js';

/** Connectors and articles (the same small set the title uses at its edges; kept here so this module needs nothing of the engine). */
const CONNECTORS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'un',
  'una',
  'y',
  'e',
  'a',
  'al',
  'en',
  'para',
  'por',
  'con',
  'lo',
]);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * CONTEXT: what the student says ABOUT an activity besides what it is and when it is ("estudiar VLAN, subnetting y routing
 * estático", "hay que subirla en PDF al campus"). It becomes the activity's optional description, never its title.
 *
 * Deterministic and conservative, in small composable pieces:
 *  - a CUE starts a piece of context: a verb of preparing or handing in ("estudiar", "llevar", "subir"…), "hay que", a
 *    topic marker ("tema", "incluye"), what the professor said;
 *  - what follows the title (the words after the activity word, up to a connector, a comma or a cue) is context only when
 *    it has real content: chatter ("tengo que", "dos días distintos") is not;
 *  - nothing is dropped for being unsure: the words are kept, in the order written, as the description, and the student
 *    can see and edit them. Nothing is invented: only words the student wrote.
 */

/** Stems (folded) of the verbs that introduce context: study, prepare, bring, remember, upload, read, attach, practise… */
const CUE_STEMS = [
  'estudi',
  'repas',
  'prepar',
  'llev',
  'trae',
  'traer',
  'record',
  'subi',
  'subir',
  'lee',
  'lean',
  'leer',
  'adjunt',
  'imprim',
  'compr',
  'practic',
  'revis',
  'resolv',
  'incluy',
  'inclu',
] as const;

/** Words that mark a topic or an instruction ("tema", "importante"). */
const CUE_WORDS = new Set([
  'tema',
  'temas',
  'incluye',
  'incluyen',
  'importante',
  'ojo',
  'nota',
  'detalle',
  'detalles',
  'contenido',
]);

/** "hay que", "no olvides", "debo", "el profesor dijo…": two or three words that open an instruction. */
const CUE_PHRASES: readonly (readonly string[])[] = [
  ['hay', 'que'],
  ['no', 'olvides'],
  ['no', 'olvidar'],
  ['debo'],
  ['debemos'],
  ['deben'],
  ['necesito'],
  ['el', 'profesor', 'dijo'],
  ['la', 'profesora', 'dijo'],
  ['el', 'profe', 'dijo'],
  ['el', 'profesor', 'pidio'],
  ['la', 'profesora', 'pidio'],
  ['el', 'profesor', 'indico'],
  ['la', 'profesora', 'indico'],
];

/** How many tokens the cue at `i` takes (0: none). Delivery ("entregar") is a cue only with a channel after it. */
export function cueLength(tokens: readonly Token[], i: number): number {
  const norm = tokens[i]?.norm;
  if (norm === undefined) return 0;
  for (const phrase of CUE_PHRASES) {
    if (phrase.every((w, k) => tokens[i + k]?.norm === w)) return phrase.length;
  }
  if (CUE_WORDS.has(norm)) return 1;
  if (CUE_STEMS.some((s) => norm.startsWith(s))) return 1;
  if (/^entreg/.test(norm) && ['en', 'por', 'al', 'via', 'a'].includes(tokens[i + 1]?.norm ?? '')) {
    return 1;
  }
  return 0;
}

/** Chatter that carries no information about the activity: dropped at the edges and never a reason to keep a piece. */
const CHATTER = new Set([
  'tengo',
  'tienes',
  'tiene',
  'tienen',
  'tenemos',
  'quiero',
  'voy',
  'vamos',
  'puedo',
  'hay',
  'que',
  'para',
  'por',
  'dias',
  'dia',
  'distintos',
  'distintas',
  'diferentes',
  'semana',
  'es',
  'son',
  'sera',
  'seran',
  'esta',
  'estan',
  'entonces',
  'pues',
  'pero',
  'porque',
  'ademas',
  'tambien',
  'luego',
  'despues',
  'ambos',
  'ambas',
  'cada',
  'uno',
  'una',
  'otro',
  'otra',
  'otros',
  'otras',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'lo',
  'la',
  'las',
  'los',
  'se',
  'les',
  'nos',
  'me',
]);
const CLITIC_DELIVERY = /^(entreg|present|realiz|termin)\w*(lo|la|los|las)$/;

const isChatter = (norm: string) =>
  CONNECTORS.has(norm) || CHATTER.has(norm) || CLITIC_DELIVERY.test(norm) || /^\d+$/.test(norm);

/** A word that says something: not chatter, not a connector, not a number, and long enough to mean a thing. */
export const isContentWord = (norm: string) => norm.length >= 3 && !isChatter(norm);

/**
 * The description in `tokens` (the words of a stretch that nothing else used, in order): from its first cue (or, with
 * none, its first word that is not chatter) to the end, with the comma the student wrote kept and chatter trimmed from the
 * edges. null when there is nothing that says anything.
 */
export function describeTokens(tokens: readonly Token[]): string | null {
  if (tokens.length === 0) return null;
  const cueAt = tokens.findIndex((_, i) => cueLength(tokens, i) > 0);
  let from = cueAt >= 0 ? cueAt : tokens.findIndex((t) => !isChatter(t.norm));
  if (from < 0) return null;
  // "la verdad no sé…": the article that belongs to the first word is kept (nothing the student wrote is lost for tidiness).
  if (
    cueAt < 0 &&
    from > 0 &&
    ['el', 'la', 'los', 'las', 'un', 'una'].includes(tokens[from - 1]!.norm)
  ) {
    from -= 1;
  }
  // A comma right before the first word belongs to the sentence, not to the description.
  let to = tokens.length;
  while (to > from && isChatter(tokens[to - 1]!.norm) && cueLength(tokens, to - 1) === 0) to--;
  if (to <= from) return null;
  const kept = tokens.slice(from, to);
  // Without a cue the piece must say something by itself; with one, the cue's verb plus one real word is enough.
  const content = kept.filter((t, i) => isContentWord(t.norm) && cueLength(kept, i) === 0).length;
  if (content === 0) return null;
  const text = kept
    .map((t, i) => (i > 0 && t.afterBreak ? `, ${t.raw}` : i > 0 ? ` ${t.raw}` : t.raw))
    .join('');
  return capitalize(text.trim());
}
