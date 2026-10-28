/**
 * "Tengo dos actividades, una el martes y la otra el jueves; la del martes es sobre redes y la del jueves es práctica con
 * Kali Linux": the days are announced first and what each activity IS comes later, pointing back by its day ("la del
 * martes") or its place ("la primera"). This reads that shape and writes it again as one activity per sentence ("Actividad
 * de redes el martes. Práctica con Kali Linux el jueves."), which the rest of the engine already understands.
 *
 * Strict on purpose: the opening must be ONLY the announcement, and every announced item must be described exactly once.
 * Anything else returns null and the message is read as before. Nothing is invented: every word of the result is the
 * student's, the weekday included.
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
