import { addDays } from './calendar.js';
import {
  MONTH_BY_NAME,
  oneSlipApart,
  QUICK_CAPTURE_TYPE_ALIASES,
  WEEKDAY_BY_NAME,
} from './captureShared.js';
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

// ───────────────────────── Wording of dates and hours that the engine reads better written plainly ─────────────────────────

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;
const MONTH_ABBREVIATIONS: Readonly<Record<string, string>> = {
  ene: 'enero',
  feb: 'febrero',
  abr: 'abril',
  may: 'mayo',
  jun: 'junio',
  jul: 'julio',
  ago: 'agosto',
  sep: 'septiembre',
  sept: 'septiembre',
  set: 'septiembre',
  oct: 'octubre',
  nov: 'noviembre',
  dic: 'diciembre',
};
/** "3 dic", "3 de dic.": a day and a month written short. */
const DAY_MONTH_ABBREVIATION =
  /(?<![\p{L}\p{N}])(\d{1,2})\s+(?:de\s+)?(ene|feb|abr|may|jun|jul|ago|sept|sep|set|oct|nov|dic)\.?(?![\p{L}])/giu;
/** "19 de noviembre del 2026": the year after "del". */
const MONTH_DEL_YEAR = new RegExp(`(${MONTH_NAMES.join('|')})\\s+del\\s+(\\d{4})`, 'giu');
/** "hoy mismo", "mañana mismo": "mismo" only stresses the day. */
const SAME_DAY_STRESS = /(?<![\p{L}])(hoy|ma[nñ]ana|pasado\s+ma[nñ]ana)\s+mismo(?![\p{L}])/giu;
/** "la semana entrante" is the next week. */
const WEEK_ENTRANTE = /(?<![\p{L}])semana\s+entrante(?![\p{L}])/giu;
const NOON =
  /(?<![\p{L}])(?<!(?:el|del)\s)(?:(?:al|a)\s+(?:la\s+)?)?(?:mediod[ií]a|medio\s+d[ií]a)(?![\p{L}])/giu;
const MIDNIGHT = /(?<![\p{L}])(?:a\s+(?:la\s+)?)?medianoche(?![\p{L}])/giu;
const MINUTE_WORDS: Readonly<Record<string, number>> = {
  media: 30,
  cuarto: 15,
  quince: 15,
  cinco: 5,
  diez: 10,
  veinte: 20,
  veinticinco: 25,
};
/** "a las 8 y media", "a las 9 menos cuarto", "a la 1 y cuarto". */
const SPOKEN_CLOCK =
  /(?<![\p{L}\p{N}])(las|la)\s+(\d{1,2})\s+(y|menos)\s+(media|cuarto|quince|veinticinco|veinte|diez|cinco)(?![\p{L}])/giu;
/** "a eso de las 8", "sobre las 8", "como a las 8": the same hour, said loosely. */
const APPROXIMATELY =
  /(?<![\p{L}])(?:a\s+eso\s+de|como\s+a|aproximadamente\s+a|alrededor\s+de|hacia|sobre)\s+(las|la)\s+(?=\d)/giu;
/** "14:30 horas", "a las 8 hs": the unit adds nothing. */
const CLOCK_UNIT = /(?<![\p{L}\p{N}])(\d{1,2}:\d{2})\s*(?:horas|hrs|hs|h)(?![\p{L}\p{N}])/giu;
const BARE_HOUR_UNIT = /(?<=(?:\blas|\bla)\s)(\d{1,2})\s*(?:horas|hrs|hs)(?![\p{L}\p{N}])/giu;
const ON_THE_DOT = /\s+en\s+punto(?![\p{L}])/giu;
/** "el día 24", "para el 24", "hasta el 24": a day of the month with no month: the next time the calendar shows it. */
const DAY_OF_MONTH_A =
  /(?<![\p{L}\p{N}])(?:el\s+)?d[ií]a\s+(\d{1,2})(?!\s*(?:de\s+\p{L}|[\p{N}/:.-]|am\b|pm\b))/giu;
const DAY_OF_MONTH_B =
  /(?<![\p{L}\p{N}])(para|hasta|antes\s+del?|es)\s+el\s+(\d{1,2})(?!\s*(?:de\s+\p{L}|[\p{N}/:.-]|am\b|pm\b))/giu;

/** "ayyy", "oye", "hola", "bueno,": an opening that is only how the message starts. */
const OPENER =
  /^\s*(?:(?:a+y+|ay+|uf+|oye|oe|oiga|ey|eh|mira|bueno|pues|hola|buenas|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|ojo|ok|okay)[\s,!.:;]+)+/iu;
/** "recuérdame", "no olvidar", "me toca", "cambiaron": words around the activity that are not its name. */
const TITLE_NOISE =
  /(?<![\p{L}])(?<!se\s)(?:recu[eé]rdame|recu[eé]rdanos|recuerda|record[aá]rme|record[aá]rnos|aplazad[oa]s?|vence[n]?|me\s+acab[oó]\s+de\s+acordar(?:\s+(?:de\s+)?que)?|me\s+acord[eé](?:\s+(?:de\s+)?que)?|sin\s+falta|lo(?=\s+de\s+\p{L})|no\s+olvides?(?:\s+(?:que|de))?|no\s+olvidar(?:\s+(?:que|de))?|me\s+toca|nos\s+toca|toca|cambiaron|cambi[oó]|movieron|pasaron|aplazaron|reprogramaron)(?![\p{L}])\s*/giu;
/** "en la tarde", "por la mañana" after an hour is that hour's part of the day; anywhere else it is only said. */
const HOUR_DAYPART =
  /(\d{1,2}(?::\d{2})?)\s+(?:en|por)\s+la\s+(ma[nñ]ana|tarde|noche|madrugada)(?![\p{L}])/giu;
const LOOSE_DAYPART =
  /(?<![\p{L}\p{N}])(?:en|por)\s+la\s+(?:ma[nñ]ana|tarde|noche|madrugada)(?![\p{L}])\s*/giu;
/** "el lunes no el martes", "el lunes y no el martes": only the first day stands. */
const NOT_THAT_DAY = new RegExp(
  String.raw`${DAY}\s*,?\s*(?:y\s+|pero\s+)?no\s+(?:el\s+|los\s+)?${DAY}(?![\p{L}])`,
  'giu',
);
/** "el martes, perdón el miércoles": the second day replaces the first. */
const CORRECTED_DAY = new RegExp(
  String.raw`(?:(?:el|los)\s+)?${DAY}\s*,?\s*(?:perd[oó]n|perdona|digo|mejor|no\s*,?\s*mejor|corrijo|me\s+equivoqu[eé])\s*,?\s*(?:el\s+|los\s+)?${DAY}`,
  'giu',
);
/** A clause that says there is NOTHING ("no tengo parcial", "se canceló el quiz"): it creates no activity. */
const NOTHING_CLAUSE =
  /(?:^|(?<=[.;!?]\s*))(?:ya\s+)?(?:no\s+(?:hay|tengo|tenemos|habr[aá]|tendremos)|se\s+cancel[oó]|se\s+suspendi[oó]|cancelaron|suspendieron|ya\s+no\s+hay)(?![\p{L}])[^.;!?]*?(?=\s+(?:pero|sino|aunque)(?![\p{L}])|\s+y\s+s[ií](?![\p{L}])|[.;!?]|$)/giu;
const MONTH_ALT = MONTH_NAMES.join('|');
/**
 * "Parcial de Física EL 25", "sustentación el 11": a bare "el <day>" is that day of the next month that has it. Only when what follows
 * is the end of the clause or a small connector (not "el 2 parcial", not "el 5 de diciembre", which is already a date).
 */
const DAY_OF_MONTH_C = new RegExp(
  String.raw`(?<![\p{L}\p{N}])el\s+(\d{1,2})(?=\s*(?:$|[,.;:!?)]|(?:y|e|o|a|de|del|para|en|por|con|antes|hasta|pero)(?![\p{L}])))(?!\s*de\s+(?:${MONTH_ALT})(?![\p{L}]))`,
  'giu',
);

/** "jueves 10 a 12", "viernes 2 a 4 pm": a range of hours with no "de" in front of it. */
const BARE_HOUR_RANGE = new RegExp(
  String.raw`(?<![\p{L}])${DAY}\s+(\d{1,2}(?::\d{2})?)(\s*[ap]\.?\s?m\.?)?\s+a\s+(\d{1,2}(?::\d{2})?)(?![\p{L}\p{N}])`,
  'giu',
);
/** "el taller se entrega el jueves": the passive only says what happens to it. */
const PASSIVE_DELIVERY = /(?<![\p{L}])se\s+(?:entregan?|presentan?)(?![\p{L}])\s*/giu;
/** "Tengo muchas cosas:", "esta semana tengo bastante:": an opening that only announces a list. */
const ANNOUNCES_LIST =
  /(?<![\p{L}])(?:tengo|tenemos|hay|me\s+dejaron|nos\s+dejaron)\s+(?:bastantes?(?:\s+cosas)?|mucho|muchas\s+cosas|muchos\s+pendientes|varias\s+cosas|varias|un\s+mont[oó]n(?:\s+de\s+cosas)?|de\s+todo|cosas)\s*:\s*/giu;
/** Words that place the activity in time without giving a day: they stay out of the title (the day is asked). */
const UNDATED_TIME = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:para|en|a|el|del)\s+)?(?:pr[oó]ximo\s+mes|fin\s+de\s+mes|fin\s+de\s+semestre|mediados\s+de\s+(?:${MONTH_ALT})|(?:este\s+|el\s+|del\s+)?fin\s+de\s+semana|(?:la\s+)?semana\s+del\s+\d{1,2}(?:\s+de\s+(?:${MONTH_ALT}))?|primera\s+hora|[uú]ltima\s+hora)(?![\p{L}])\s*`,
  'giu',
);
/** "del 23 al 27 de noviembre", "entre el 1 y el 3 de diciembre": the activity is due on the last day. */
const DAY_RANGE = new RegExp(
  String.raw`(?:del|desde\s+el)\s+\d{1,2}\s+(?:al|hasta\s+el)\s+(\d{1,2})\s+de\s+(${MONTH_ALT})|entre\s+el\s+\d{1,2}\s+y\s+el\s+(\d{1,2})\s+de\s+(${MONTH_ALT})`,
  'giu',
);
/** "en lugar del martes", "en vez del jueves", "y no el martes" after a day already given. */
const REPLACED_DAY = new RegExp(
  String.raw`(?<=${DAY}[^.;!?]{0,60}?)[,\s]*(?:en\s+lugar\s+de(?:l)?|en\s+vez\s+de(?:l)?)\s+(?:el\s+)?${DAY}(?![\p{L}])`,
  'giu',
);
/** 2026-12-04 */
const ISO_DATE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/gu;
/** "1. parcial de redes 2. quiz de cálculo" on one line: the numbers only number the items. */
const INLINE_LIST = /(?:^|\s)1[.)]\s+\p{L}[\s\S]*?\s2[.)]\s+\p{L}/u;
const LIST_PREAMBLE = /^[^:\d]{0,90}:\s*(?=1[.)]\s)/u;
const INLINE_MARKER = /(^|\s)\d{1,2}[.)]\s+(?=\p{L})/gu;
/** Typed short: "d" for "de", "q" for "que", "x" for "por". */
const SHORT_WORDS: readonly [RegExp, string][] = [
  [/(?<![\p{L}\p{N}])d(?=\s+\p{L})/giu, 'de'],
  [/(?<![\p{L}\p{N}])q(?=\s+\p{L})/giu, 'que'],
  [/(?<![\p{L}\p{N}])(?:xq|pq|porq)(?![\p{L}\p{N}])/giu, 'porque'],
  [/(?<![\p{L}\p{N}])x(?=\s+(?:la|el|los|las|mi)(?![\p{L}]))/giu, 'por'],
  [/(?<![\p{L}\p{N}])(?:tb|tmb|tbn)(?![\p{L}\p{N}])/giu, 'también'],
  [/(?<![\p{L}\p{N}])pa(?=\s+(?:el|la|los|las|ma[nñ]ana|hoy)(?![\p{L}]))/giu, 'para'],
];

/** Words the engine reads, with their usual typing slips, fixed when the slip is one letter and cannot be another word here. */
const TYPO_VOCABULARY: readonly string[] = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
  'manana',
  'parcial',
  'taller',
  'tarea',
  'proyecto',
  'exposicion',
  'lectura',
  'presentacion',
];
const TYPO_SLIPS: Readonly<Record<string, string>> = {
  tngo: 'tengo',
  tego: 'tengo',
  tenog: 'tengo',
  tengp: 'tengo',
  tnego: 'tengo',
};
function fixTypos(input: string): string {
  return input.replace(/\p{L}+/gu, (word) => {
    const f = fold(word);
    if (TYPO_SLIPS[f]) return TYPO_SLIPS[f]!;
    if (f.length < 5) return word;
    if (TYPO_VOCABULARY.includes(f) || f in QUICK_CAPTURE_TYPE_ALIASES || f in WEEKDAY_BY_NAME)
      return word;
    const near = TYPO_VOCABULARY.filter((v) => v[0] === f[0] && oneSlipApart(f, v));
    return near.length === 1 ? near[0]! : word;
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The month name of the next date (today included) whose day of the month is `day`, or null for an impossible day. */
function monthOfNextDay(today: string, day: number): string | null {
  const [year, month] = today.split('-').map(Number) as [number, number];
  for (let k = 0; k < 14; k++) {
    const m0 = month - 1 + k;
    const y = year + Math.floor(m0 / 12);
    const m = (m0 % 12) + 1;
    const real = new Date(Date.UTC(y, m - 1, day));
    if (real.getUTCMonth() !== m - 1) continue;
    if (`${y}-${pad2(m)}-${pad2(day)}` >= today) return MONTH_NAMES[m - 1]!;
  }
  return null;
}

/** The loose spellings of dates and hours written the plain way the engine reads. */
function plainDatesAndHours(input: string, today: string): string {
  let out = input.replace(OPENER, '');
  for (const [pattern, word] of SHORT_WORDS) out = out.replace(pattern, word);
  out = fixTypos(out);
  if (INLINE_LIST.test(out)) {
    // "Les comparto el cronograma: 1) …": what comes before the first number only announces the list
    out = out.replace(LIST_PREAMBLE, '');
    out = out.replace(INLINE_MARKER, (_w, lead: string) => (lead === '' ? '' : '; '));
  }
  out = out.replace(ANNOUNCES_LIST, '').replace(PASSIVE_DELIVERY, '');
  // "ahora será el miércoles 25 EN LUGAR DEL MARTES": the day it replaces is not a date of the activity
  out = out.replace(REPLACED_DAY, '');
  out = out.replace(NOTHING_CLAUSE, '');
  out = out.replace(ISO_DATE, (whole, y: string, m: string, d: string) => {
    const name = MONTH_NAMES[Number(m) - 1];
    return name === undefined || Number(d) < 1 || Number(d) > 31
      ? whole
      : `el ${Number(d)} de ${name} de ${y}`;
  });
  out = out.replace(
    DAY_RANGE,
    (
      _w,
      d1: string | undefined,
      m1: string | undefined,
      d2: string | undefined,
      m2: string | undefined,
    ) => `el ${d1 ?? d2} de ${m1 ?? m2}`,
  );
  out = out.replace(
    BARE_HOUR_RANGE,
    (whole, day: string, from: string, meridiem: string | undefined, to: string) => {
      const [h1, h2] = [Number.parseInt(from, 10), Number.parseInt(to, 10)];
      // two real hours in order ("jueves 10 a 12"); "viernes 20 a 22" is still hours, "lunes 5 a 3" is not a range
      return h1 >= 0 && h2 <= 24 && (h1 < h2 || meridiem)
        ? `${day} de ${from}${meridiem ?? ''} a ${to}`
        : whole;
    },
  );
  out = out.replace(UNDATED_TIME, '');
  out = out.replace(CORRECTED_DAY, (_w, _first: string, second: string) => `el ${second}`);
  out = out.replace(NOT_THAT_DAY, (_w, first: string) => first);
  out = out.replace(TITLE_NOISE, '');
  out = out.replace(HOUR_DAYPART, '$1 de la $2').replace(LOOSE_DAYPART, '');
  out = out.replace(DAY_MONTH_ABBREVIATION, (_w, d: string, ab: string) => {
    return `${d} de ${MONTH_ABBREVIATIONS[ab.toLowerCase()]}`;
  });
  out = out.replace(MONTH_DEL_YEAR, '$1 de $2');
  out = out.replace(SAME_DAY_STRESS, '$1');
  out = out.replace(WEEK_ENTRANTE, 'próxima semana');
  out = out.replace(NOON, 'a las 12:00 pm');
  out = out.replace(MIDNIGHT, 'a las 11:59 pm');
  out = out.replace(SPOKEN_CLOCK, (_w, article: string, h: string, kind: string, word: string) => {
    const minutes = MINUTE_WORDS[word.toLowerCase()]!;
    if (kind.toLowerCase() === 'y') return `${article} ${Number(h)}:${pad2(minutes)}`;
    const hour = Number(h) === 1 ? 12 : Number(h) - 1;
    return `${hour === 1 ? 'la' : 'las'} ${hour}:${pad2(60 - minutes)}`;
  });
  out = out.replace(APPROXIMATELY, 'a $1 ');
  out = out.replace(CLOCK_UNIT, '$1').replace(BARE_HOUR_UNIT, '$1').replace(ON_THE_DOT, '');
  out = out.replace(DAY_OF_MONTH_A, (whole, d: string) => {
    const month = monthOfNextDay(today, Number(d));
    return month === null ? whole : `el ${Number(d)} de ${month}`;
  });
  out = out.replace(DAY_OF_MONTH_C, (whole, d: string) => {
    const day = Number(d);
    const month = day >= 1 && day <= 31 ? monthOfNextDay(today, day) : null;
    return month === null ? whole : `el ${day} de ${month}`;
  });
  out = out.replace(DAY_OF_MONTH_B, (whole, lead: string, d: string) => {
    const month = monthOfNextDay(today, Number(d));
    return month === null ? whole : `${lead} el ${Number(d)} de ${month}`;
  });
  return out;
}

/**
 * The message with its relative offsets written as dates ("en dos semanas" -> "el 19 de octubre"), hearsay removed and
 * corrections applied. The engine reads the result; the student's own text is what the screen keeps showing. Null when
 * nothing changed.
 */
export function normalizeLooseText(text: string, now: Date, timeZone: string): string | null {
  const today = toLocalParts(now, timeZone).date;
  let out = plainDatesAndHours(text, today).replace(OFFSET, (whole, n: string, unit: string) => {
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
