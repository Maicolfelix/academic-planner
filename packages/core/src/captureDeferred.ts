import { addDays } from './calendar.js';
import { MONTH_BY_NAME } from './captureShared.js';
import { toLocalParts } from './time.js';
/**
 * "Tengo dos actividades, una el martes y la otra el jueves; la del martes es sobre redes y la del jueves es práctica con
 * Kali Linux": the days are announced first and what each activity IS comes later, pointing back by its day ("la del
 * martes") or its place ("la primera"). This reads that shape and writes it again as one activity per sentence ("Actividad
 * de redes el martes. Práctica con Kali Linux el jueves."), which the rest of the engine already understands.
 *
 * Strict on purpose: the opening must be ONLY the announcement, and every announced item must be described exactly once.
 * Anything else returns null and the message is read as before. The result is only what the engine reads: the words and
 * weekdays are the student's, but the evidence line of a proposal shows this rewritten sentence, not the original.
 */

const DAY = '(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)';
const NOUN =
  '(actividades|actividad|tareas|tarea|parciales|parcial|ex[aá]menes|examen|quices|quiz|proyectos|proyecto|talleres|taller|trabajos|trabajo|entregas|entrega|pr[aá]cticas|pr[aá]ctica|laboratorios|laboratorio)';
const COUNT = '(dos|tres|cuatro|cinco|[2-9])';
const ITEM = `(?:un[ao]|(?:la|el)\\s+otr[ao]|otr[ao])\\s+(?:${NOUN}\\s+)?(?:para\\s+|de\\s+)?(?:el\\s+)?${DAY}`;
const OPENING = new RegExp(
  `^\\s*(?:(?:hola|buenas)[,.!\\s]+)?(?:tengo|tenemos|hay|son)\\s+${COUNT}\\s+${NOUN}\\s*[,:;.]?\\s*((?:${ITEM}\\s*(?:[,;]|\\by\\b|\\be\\b)?\\s*)+)`,
  'iu',
);
const ITEM_DAY = new RegExp(`(?:^|[^\\p{L}])${DAY}(?![\\p{L}])`, 'giu');
const REFERENCE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(?:la|el)\\s+(?:de|del)\\s+(?:el\\s+)?${DAY}|(?:la|el)\\s+(primer[ao]|segund[ao]|tercer[ao]|[uú]ltim[ao]))\\s+(?:es|ser[aá]|trata\\s+(?:de|sobre))\\s+`,
  'giu',
);
const ORDINAL: Readonly<Record<string, number>> = { primer: 0, segund: 1, tercer: 2 };

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const IRREGULAR: Readonly<Record<string, string>> = {
  actividades: 'actividad',
  parciales: 'parcial',
  examenes: 'examen',
  quices: 'quiz',
  talleres: 'taller',
};
const singular = (noun: string) => {
  const n = fold(noun);
  return IRREGULAR[n] ?? (n.endsWith('s') ? n.slice(0, -1) : n);
};

/** The message as one activity per sentence, or null when it is not an announcement followed by its descriptions. */
export function resolveDeferredDescriptions(text: string): string | null {
  const opening = OPENING.exec(text);
  if (!opening) return null;
  const days = [...opening[3]!.matchAll(ITEM_DAY)].map((m) => fold(m[1]!));
  const expected =
    Number(opening[1]) || { dos: 2, tres: 3, cuatro: 4, cinco: 5 }[fold(opening[1]!)];
  if (days.length < 2 || days.length !== expected || new Set(days).size !== days.length)
    return null;

  const rest = text.slice(opening[0].length);
  const refs = [...rest.matchAll(REFERENCE)];
  if (
    refs.length !== days.length ||
    rest.slice(0, refs[0]!.index).replace(/[\s,;.:y]+/giu, '') !== ''
  )
    return null;

  const described = new Map<number, string>();
  refs.forEach((ref, k) => {
    const end = k + 1 < refs.length ? refs[k + 1]!.index : rest.length;
    const body = rest
      .slice(ref.index + ref[0].length, end)
      .replace(/[\s,;.]*(?:\by\b|\be\b)?[\s,;.]*$/iu, '')
      .trim();
    const index = ref[1]
      ? days.indexOf(fold(ref[1]))
      : ref[2]
        ? (ORDINAL[fold(ref[2]).slice(0, -1)] ?? days.length - 1)
        : -1;
    if (index >= 0 && body !== '' && !described.has(index)) described.set(index, body);
  });
  if (described.size !== days.length) return null;

  const noun = singular(opening[2]!);
  return days
    .map((day, i) => {
      const body = described.get(i)!;
      // "sobre redes", "de redes": more about the activity named at the start; anything else names it by itself.
      const about = /^(?:sobre|de|del|acerca\s+de)\s+(.*)$/iu.exec(body);
      const label = about ? `${noun} de ${about[1]}` : body;
      return `${label} el ${day}.`;
    })
    .join(' ');
}

// ───────────────────────── Loose wording that says nothing about the activity ─────────────────────────

const OFFSET_WORDS: Readonly<Record<string, number>> = {
  un: 1,
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
};
const OFFSET =
  /(?<![\p{L}\p{N}])(?:en|dentro\s+de)\s+(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(d[ií]as?|semanas?)(?![\p{L}\p{N}])/giu;
/** Who says it ("el profe dijo que", "me dijeron que", "creo que"): hearsay or hedging around the activity, not part of it. */
const REPORTING =
  /(?<=^\s*|[.!?]\s+)(?:(?:(?:el|la)\s+)?(?:profe(?:sor(?:a)?)?|docente|monitor(?:a)?)\s+(?:me\s+)?(?:dijo|dice|mencion[oó]|avis[oó]|inform[oó]|escribi[oó])|me\s+dijeron|dijeron|dicen|creo|parece|supongo|entend[ií])\s+que\s+/giu;
/** "para la próxima semana: lunes quiz, martes taller": every bare weekday after the colon is of that week. */
const NEXT_WEEK_LIST = /^\s*(?:para\s+)?(?:la\s+)?(?:pr[oó]xima|siguiente|otra)\s+semana\s*[:,-]/iu;
/** "hay parcial el lunes": the "hay" only says it exists. */
const EXISTENTIAL = /(?<=^\s*|[.,;]\s*|\by\s+)hay\s+(?!que\b)/giu;
/** A weekday that does not already say which week. */
const BARE_DAY = new RegExp(
  String.raw`(?<![\p{L}])${DAY}(?![\p{L}])(?!\s+de\s+la\s+(?:otra|pr[oó]xima|siguiente)\s+semana)`,
  'giu',
);
/** "se cambió para el viernes en vez del jueves": that clause only (up to a full stop), where the new day stands alone. */
const MOVED_CLAUSE =
  /(?<![\p{L}\p{N}])se\s+(?:cambi[oó]|movi[oó]|pas[oó]|aplaz[oó]|corri[oó])\s+(?:para|a)\s+[^.;!?]*/iu;
const MOVED_VERB = /^se\s+\S+\s+(?:para|a)\s+/iu;
const INSTEAD = new RegExp(
  String.raw`[,\s]*(?:en\s+vez\s+de(?:l)?|y\s+no|no|en\s+lugar\s+de(?:l)?)\s+(?:el\s+)?${DAY}(?![\p{L}])`,
  'giu',
);

/**
 * The message with its relative offsets written as dates ("en dos semanas" -> "el 19 de octubre"), hearsay removed and
 * corrections applied. The engine reads the result; the student's own text is what the screen keeps showing. Null when
 * nothing changed.
 */
export function normalizeLooseText(text: string, now: Date, timeZone: string): string | null {
  const today = toLocalParts(now, timeZone).date;
  let out = text.replace(OFFSET, (whole, n: string, unit: string) => {
    const count = Number(n) || OFFSET_WORDS[n.toLowerCase()] || 0;
    if (count < 1) return whole; // "en 0 días" is today, which the engine reads by itself
    const [, month, day] = addDays(
      today,
      count * (unit.toLowerCase().startsWith('s') ? 7 : 1),
    ).split('-');
    const name = Object.keys(MONTH_BY_NAME).find((k) => MONTH_BY_NAME[k] === Number(month));
    return `el ${Number(day)} de ${name}`;
  });
  out = out.replace(REPORTING, '');
  if (NEXT_WEEK_LIST.test(out)) {
    out = out.replace(NEXT_WEEK_LIST, '').replace(BARE_DAY, (day) => `${day} de la próxima semana`);
  }
  out = out.replace(EXISTENTIAL, '');
  out = out.replace(MOVED_CLAUSE, (clause) =>
    clause.replace(MOVED_VERB, 'para ').replace(INSTEAD, ''),
  );
  return out === text ? null : out;
}
