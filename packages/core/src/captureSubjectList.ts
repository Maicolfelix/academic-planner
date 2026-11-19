import { subjectPattern } from './captureTimetableOrder.js';

/**
 * ONE type word, SEVERAL subjects: "Tengo parcial de Redes y Cálculo el viernes" are two exams, and "parcial de Redes a las 8 y
 * de Cálculo a las 10" too. The engine reads one activity per type word, so the second subject was lost without a word. This
 * pass says the type word again for each subject ("parcial de Redes el viernes y parcial de Cálculo el viernes"): the same
 * words, repeated, and ONLY with subjects the student already has. Nothing is invented.
 */

/** Singular type words that can be said once for several subjects, and the plurals that stand for them. */
const TYPES: Readonly<Record<string, string>> = {
  parcial: 'parcial',
  parciales: 'parcial',
  examen: 'examen',
  exámenes: 'examen',
  examenes: 'examen',
  quiz: 'quiz',
  quices: 'quiz',
  taller: 'taller',
  talleres: 'taller',
  tarea: 'tarea',
  tareas: 'tarea',
  proyecto: 'proyecto',
  proyectos: 'proyecto',
  trabajo: 'trabajo',
  trabajos: 'trabajo',
  exposición: 'exposición',
  exposicion: 'exposición',
  exposiciones: 'exposición',
  laboratorio: 'laboratorio',
  laboratorios: 'laboratorio',
  informe: 'informe',
  informes: 'informe',
  evaluación: 'evaluación',
  evaluacion: 'evaluación',
  evaluaciones: 'evaluación',
  prueba: 'prueba',
  pruebas: 'prueba',
  lectura: 'lectura',
  lecturas: 'lectura',
};
const TYPE_ALT = Object.keys(TYPES)
  .sort((a, b) => b.length - a.length)
  .join('|');
const WORD = '[\\p{L}\\p{N}]';

/**
 * `text` with the type word repeated for each subject it was said once for, or null when nothing changed.
 *  - "parcial de Redes y Cálculo el viernes"        -> "parcial de Redes el viernes y parcial de Cálculo el viernes"
 *  - "parcial de Redes a las 8 y de Cálculo a las 10" -> "parcial de Redes a las 8 y parcial de Cálculo a las 10"
 * A single subject, two subjects with a type word of their own, or a name that is itself "X y Y" are left as they are.
 */
export function repeatTypePerSubject(
  text: string,
  subjects: readonly { name: string }[],
): string | null {
  const subj = subjectPattern(subjects.map((s) => s.name));
  if (subj === null) return null;
  let changed = false;

  // "parcial de Redes a las 8 y de Cálculo a las 10": the second "de <subject>" is another one of the same
  const second = new RegExp(
    `(?<!${WORD})(${TYPE_ALT})(\\s+(?:de|del)\\s+${subj}(?![\\p{L}\\p{N}])[^.;,\\n]{0,40}?)\\s+(?:y|e)\\s+(?=(?:de|del)\\s+${subj}(?![\\p{L}\\p{N}]))`,
    'giu',
  );
  let out = text.replace(second, (whole, type: string, middle: string) => {
    // a type word inside the middle ("parcial de Redes y quiz …") means that part is not about the same type
    if (new RegExp(`(?<!${WORD})(?:${TYPE_ALT})(?!${WORD})`, 'iu').test(middle)) return whole;
    changed = true;
    return `${type}${middle} y ${TYPES[type.toLowerCase()] ?? type} `;
  });

  // "parcial de Redes y Cálculo el viernes": a list of subjects right after "de", then what is said about all of them
  const list = new RegExp(
    `(?<!${WORD})(${TYPE_ALT})\\s+(?:de|del)\\s+(${subj})((?:\\s*,\\s*${subj})*)\\s+(?:y|e)\\s+(${subj})(?![\\p{L}\\p{N}])([^.;,\\n]*)`,
    'giu',
  );
  out = out.replace(
    list,
    (whole, type: string, first: string, more: string, last: string, tail: string) => {
      const names = [
        first,
        ...more
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        last,
      ];
      // the tail is what is said about all of them; it ends where another activity starts ("… y quiz de Física")
      const cut = new RegExp(
        `\\s+(?:y|e)\\s+(?:(?:el|la|los|las|un|una)\\s+)?(?:${TYPE_ALT})(?!${WORD})`,
        'iu',
      ).exec(tail);
      const shared = cut ? tail.slice(0, cut.index) : tail;
      const rest = cut ? tail.slice(cut.index) : '';
      if (new RegExp(`(?<!${WORD})(?:${TYPE_ALT})(?!${WORD})`, 'iu').test(shared)) return whole;
      const word = TYPES[type.toLowerCase()] ?? type;
      changed = true;
      return `${names.map((n) => `${word} de ${n}${shared}`).join(' y ')}${rest}`;
    },
  );
  return changed ? out : null;
}

/**
 * Several subjects with NO type word, each with its own day or hour: "Redes mañana a las 7 am y Cálculo mañana a las 9 am",
 * "Mañana 7 am clase de Redes y 9 am clase de Cálculo". With nothing to tell them apart, the engine read the whole phrase as
 * ONE activity (the first subject with the last hour) and lost the other. One piece per clause that names a subject; a piece
 * with an hour but no day takes the one day the text gives. null unless every piece names a subject and says when.
 */
export function splitBySubject(
  text: string,
  subjects: readonly { name: string }[],
  hasWhen: (piece: string) => boolean,
  hasDay: (piece: string) => boolean,
): string[] | null {
  const subj = subjectPattern(subjects.map((s) => s.name));
  if (subj === null) return null;
  const named = new RegExp(`(?<!${WORD})${subj}(?!${WORD})`, 'iu');
  const pieces = text
    .split(/\s+(?:y|e)\s+|[,;.]\s*/iu)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pieces.length < 2 || !pieces.every((p) => named.test(p) && hasWhen(p))) return null;
  // the names must differ: "Redes el lunes y Redes el martes" is the same subject twice, which the engine already reads
  const names = pieces.map((p) => named.exec(p)![0].toLowerCase());
  if (new Set(names).size < 2) return null;
  const dayOwner = pieces.find(hasDay);
  const day = dayOwner === undefined ? '' : (dayWords(dayOwner) ?? '');
  return pieces.map((p) => (hasDay(p) || day === '' ? p : `${p} ${day}`));
}

/** The day words of a piece: "mañana", "hoy", "el lunes", "el 25 de noviembre"… found the cheap way, by the words themselves. */
function dayWords(piece: string): string | null {
  const m =
    /(?<![\p{L}\p{N}])(?:hoy|pasado\s+ma[nñ]ana|ma[nñ]ana|(?:el\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\s+\d{1,2})?|el\s+\d{1,2}\s+de\s+\p{L}+)(?![\p{L}\p{N}])/iu.exec(
      piece,
    );
  return m ? m[0] : null;
}
