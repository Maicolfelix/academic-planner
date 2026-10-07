// A4-0b spike tooling: NOT product code. The concrete CONTRACT the A4-1 serializer must meet, as executable cases:
// how an untrusted title is turned into one RFC 5545 TEXT value (RFC 5545 §3.3.11) and then into folded content
// lines (§3.1). generate.mjs uses these functions to write `spike-robustness.ics` and validate.mjs reads the file back
// with an independent parser and checks that every title survives EXACTLY (and that no case injects a component).
//
// The rules (each one is tested by the cases below):
//   1. Line breaks: CRLF, CR and LF in a title become ONE logical newline, written as the two characters `\n`.
//      A raw CR or LF must never reach the output: it would end the content line and let the title inject
//      properties or components (`BEGIN:VEVENT`, `ATTENDEE`, …).
//   2. Control characters (U+0000-U+0008, U+000B, U+000C, U+000E-U+001F, U+007F) are not allowed in TEXT: removed.
//      TAB (U+0009) is whitespace and is kept.
//   3. Escape `\` as `\\`, `;` as `\;` and `,` as `\,`. Do NOT escape `:` or `"` (RFC 5545 §3.3.11).
//   4. A lone UTF-16 surrogate cannot be encoded in UTF-8: replace it with U+FFFD (otherwise the byte count and the
//      bytes disagree).
//   5. Fold at 75 OCTETS (the line break excluded; the leading space of a continuation line counts), only between
//      code points (never inside a multi-octet UTF-8 sequence), and never leave a physical line ending in a space
//      (a tool that trims trailing whitespace would corrupt the text). Not splitting a grapheme cluster (base letter +
//      combining mark, emoji sequences) is NOT required by the RFC but is preferable: see `combining-marks`.
import { Buffer } from 'node:buffer';

/** The text the title must read back as: rules 1, 2 and 4, without the escaping of rule 3. */
export function normalizeText(raw) {
  return [...raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n')]
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code >= 0xd800 && code <= 0xdfff) return '�';
      const control =
        code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f);
      return control || code === 0x7f ? '' : ch;
    })
    .join('');
}

/** Rule 1-4: an untrusted title -> the value of a TEXT property. */
export function escapeText(raw) {
  return normalizeText(raw)
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');
}

/** Rule 5: one logical content line -> physical lines of at most 75 octets joined by CRLF + space. */
export function fold(line) {
  const chunks = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = chunks.length === 0 ? 75 : 74; // a continuation line starts with one space
    if (bytes + size > limit) {
      const trailing = / +$/.exec(current)?.[0] ?? '';
      chunks.push(current.slice(0, current.length - trailing.length));
      current = trailing;
      bytes = Buffer.byteLength(trailing);
    }
    current += ch;
    bytes += size;
  }
  chunks.push(current);
  return chunks.map((c, i) => (i === 0 ? c : ` ${c}`)).join('\r\n');
}

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);

/** [id, raw title, what it exercises]. Synthetic: nothing here is real student data. */
export const ROBUSTNESS_CASES = [
  ['specials', 'a, b; c \\ d', 'comma, semicolon and backslash are escaped'],
  [
    'escape-lookalikes',
    'barra-n literal: \\n y \\, y \\;',
    'text that LOOKS escaped is escaped again (not a newline)',
  ],
  ['colon-quotes', 'Hora: 10:30 "entrega" y \'ok\'', 'colon and double quote are NOT escaped'],
  ['newline-lf', 'línea uno\nlínea dos', 'LF becomes the two characters \\n'],
  ['lone-cr', 'a\rb', 'a lone CR is a newline, never a raw CR'],
  [
    'crlf-injection',
    'Parcial\r\nBEGIN:VEVENT\r\nUID:injected\r\nSUMMARY:pwned\r\nEND:VEVENT',
    'a title cannot end its line and start a component',
  ],
  [
    'property-injection',
    'Parcial\r\nATTENDEE;CN=Atacante:mailto:atacante@example.test\r\nDESCRIPTION:falso',
    'a title cannot add properties to the event',
  ],
  ['control-chars', `a${NUL}b${BEL}c${ESC}d${DEL}e`, 'control characters are removed'],
  ['tab', 'a\tb', 'TAB is whitespace and survives'],
  ['accents', 'Evaluación ¿Qué tal? Pérez, Núñez; ñ á é í ó ú ü', 'Latin-1 multibyte text'],
  [
    'emoji-boundary',
    `${'x'.repeat(65)}😀😀😀 fin`,
    'a 4-octet emoji falls on the 75-octet limit: no split inside it',
  ],
  [
    'combining-marks',
    `${'x'.repeat(66)}${'é'.repeat(12)} fin`,
    'base + combining mark at the limit: valid to split between them (RFC), preferable not to',
  ],
  ['cjk', '日本語のテスト'.repeat(10), '3-octet characters across many folds'],
  ['rtl-mixed', 'Reunión שלום עולם 12:30', 'right-to-left text mixed with Latin'],
  ['very-long', 'Palabra '.repeat(60).trimEnd(), 'many folds, several landing right after a space'],
  ['lone-surrogate', `a${String.fromCharCode(0xd83d)}b`, 'an unpaired surrogate becomes U+FFFD'],
];
