/**
 * TIMETABLE ORDER: the engine reads a weekly timetable as "<subject> <days> <hours>" ("Redes lunes de 8 a 10, Cálculo martes de
 * 10 a 12"). Students also write it the other way round, with the hours first ("Lunes 8-10 Redes, martes 10-12 Cálculo"), or with
 * a day heading over several subjects ("Lunes: Redes 8-10, Cálculo 10-12"). Both are the same timetable, but read in the first
 * order they hand every subject the hours of the one before it. This pass puts them in the order the engine reads, and ONLY
 * with a subject the student already has (a word that is not a subject is never moved), so nothing is invented: the same words
 * in a different order.
 */

const DAY = '(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)';
const DAYS = `${DAY}(?:\\s*(?:,|y|e)\\s*${DAY})*`;
const HOUR = '\\d{1,2}(?::\\d{2})?(?:\\s*[ap]\\.?\\s?m\\.?)?';
const RANGE = `(?:(?:de|desde|entre)\\s+)?(?:las\\s+)?${HOUR}\\s*(?:-|–|—|a|y|hasta)\\s*(?:las\\s+)?${HOUR}`;
const VERB = '(?:(?:tengo|tenemos|veo|vemos|hay)\\s+)?(?:(?:la\\s+)?clase\\s+de\\s+)?';
const WORD = '[\\p{L}\\p{N}]';
/** "10 a 12" reads as a range of hours only after "de": "jueves 10 a 12" -> "jueves de 10 a 12". */
const withDe = (range: string) => (/^(?:de|desde|entre)\s/iu.test(range) ? range : `de ${range}`);
/** What can come right before the first item of a list: the start of the text, a sentence or clause, or a small lead-in word. */
const STARTS_LIST =
  /(?:^|[.,;:!?\n]\s*|\b(?:y|e|tengo|tenemos|horario|clases?|hay|veo|vemos)\s*:?\s*)$/iu;

const ACCENTS: Record<string, string> = {
  a: 'aáàä',
  e: 'eéèë',
  i: 'iíìï',
  o: 'oóòö',
  u: 'uúùü',
  n: 'nñ',
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern that matches one subject name the way a student types it: any case, with or without accents. */
export function subjectPattern(names: readonly string[]): string | null {
  const parts = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))]
    .sort((a, b) => b.length - a.length)
    .map((name) =>
      [...name.normalize('NFC').toLowerCase()]
        .map((ch) => {
          const base = ch.normalize('NFD').charAt(0);
          const klass = ACCENTS[base];
          if (klass) return `[${klass}]`;
          return /\s/.test(ch) ? '\\s+' : escape(ch);
        })
        .join(''),
    );
  return parts.length === 0 ? null : `(?:${parts.join('|')})`;
}

/**
 * `text` with its hour-first timetables rewritten subject-first, or null when nothing changed.
 *  - "Lunes 8-10 Redes, martes 10-12 Cálculo" -> "Redes Lunes 8-10, Cálculo martes 10-12"
 *  - "Lunes y miércoles de 8 a 10 am tengo Cálculo" -> "Cálculo Lunes y miércoles de 8 a 10 am"
 *  - "Lunes: Redes 8-10, Cálculo 10-12" -> "Redes Lunes 8-10, Cálculo Lunes 10-12"
 * A list that already starts with its subject ("Redes lunes 8-10, Cálculo martes 9-11") is left as it is.
 */
export function orderTimetable(text: string, subjects: readonly { name: string }[]): string | null {
  const subj = subjectPattern(subjects.map((s) => s.name));
  if (subj === null) return null;
  const hasSubject = new RegExp(`(?<!${WORD})${subj}(?!${WORD})`, 'iu');
  const hourFirst = new RegExp(
    `(?<!${WORD})(${DAYS})\\s*(?:,|:)?\\s*(${RANGE})\\s*(?:,\\s*)?${VERB}(${subj})(?!${WORD})`,
    'giu',
  );
  // after a first "<days> <hours> <subject>", more "<hours> <subject>" on the same days: "Lunes 8-10 Redes, 10-12 Cálculo"
  const sameDays = new RegExp(
    `^\\s*(?:,|;|\\by)\\s*(${RANGE})\\s*(?:,\\s*)?${VERB}(${subj})(?!${WORD})`,
    'iu',
  );
  const heading = new RegExp(
    `(?<!${WORD})(?:los\\s+)?(${DAYS})\\s*(?::|,)?\\s*(?:(?:tengo|tenemos|veo|vemos|hay)\\s+)?(?=${subj})`,
    'giu',
  );
  const headItem = new RegExp(`^(${subj})\\s*(?:[:,\\-–—]\\s*)?(${RANGE})(?!\\d)`, 'iu');
  const headSep = /^\s*(?:,|;|\by)\s*/iu;

  let out = '';
  let cursor = 0;
  let changed = false;
  let lastEnd = -1;

  hourFirst.lastIndex = 0;
  for (let m = hourFirst.exec(text); m !== null; m = hourFirst.exec(text)) {
    const before = text.slice(cursor, m.index);
    const gap = lastEnd >= 0 ? text.slice(lastEnd, m.index) : null;
    const chained = gap !== null && /^[\s,;.]*(?:y\s*)?$/iu.test(gap);
    // the first item of a list must not follow a subject in its own sentence: then it is "<subject> <days> <hours> y <days> <hours>",
    // already in the engine's order
    const lead = text.slice(0, m.index).replace(/\s+(?:el|la|los|las)\s*$/iu, ' ');
    if (!chained && !STARTS_LIST.test(lead)) {
      hourFirst.lastIndex = m.index + m[1]!.length;
      continue;
    }
    const sentenceStart = text.slice(0, m.index).search(/[^.!?\n]*$/u);
    if (!chained && hasSubject.test(text.slice(sentenceStart, m.index))) {
      hourFirst.lastIndex = m.index + m[1]!.length;
      continue;
    }
    const days = m[1]!;
    let piece = `${m[3]!} ${days} ${withDe(m[2]!)}`;
    let end = m.index + m[0].length;
    for (;;) {
      const more = sameDays.exec(text.slice(end));
      if (!more) break;
      piece += `, ${more[2]!} ${days} ${withDe(more[1]!)}`;
      end += more[0].length;
    }
    out += before + piece;
    cursor = end;
    lastEnd = end;
    hourFirst.lastIndex = end;
    changed = true;
  }
  out += text.slice(cursor);

  // "Lunes: Redes 8-10, Cálculo 10-12": a day heading over several "<subject> <hours>"
  const source = out;
  out = '';
  cursor = 0;
  heading.lastIndex = 0;
  for (let h = heading.exec(source); h !== null; h = heading.exec(source)) {
    const days = h[1]!;
    const items: string[] = [];
    let end = h.index + h[0].length;
    for (;;) {
      const item = headItem.exec(source.slice(end));
      if (!item) break;
      items.push(`${item[1]!} ${days} ${withDe(item[2]!)}`);
      end += item[0].length;
      const sep = headSep.exec(source.slice(end));
      if (!sep || !new RegExp(`^${subj}`, 'iu').test(source.slice(end + sep[0].length))) break;
      end += sep[0].length;
    }
    if (items.length < 2) {
      heading.lastIndex = h.index + Math.max(1, h[0].length);
      continue;
    }
    out += source.slice(cursor, h.index) + items.join(', ');
    cursor = end;
    heading.lastIndex = end;
    changed = true;
  }
  out += source.slice(cursor);
  return changed ? out : null;
}
