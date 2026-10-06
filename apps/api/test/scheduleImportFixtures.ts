import { createCanvas } from '@napi-rs/canvas';

/**
 * Synthetic schedule documents, generated on demand (no real timetable, no copyright, nothing private):
 * PNG/JPEG images drawn with a canvas, and minimal hand-written PDFs (one with a text layer, one that is
 * only a picture, i.e. "scanned"). Used by the API tests and by the Playwright specs.
 */

export interface DrawnText {
  text: string;
  x: number;
  y: number;
}

/** A white page with black text. `y` is the text baseline from the top. */
export function drawTextImage(
  items: DrawnText[],
  size = { width: 900, height: 460 },
  format: 'png' | 'jpeg' = 'png',
  fontSize = 28,
): Buffer {
  const canvas = createCanvas(size.width, size.height);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size.width, size.height);
  g.fillStyle = '#000000';
  g.font = `${fontSize}px sans-serif`;
  for (const item of items) g.fillText(item.text, item.x, item.y);
  return format === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', 95);
}

export const DAY_COLUMNS = [
  { x: 200, label: 'Lunes' },
  { x: 420, label: 'Martes' },
  { x: 640, label: 'Miércoles' },
];

/**
 * Format A: a table by days. `cells` are placed under the day column of their `day` index (0 = first
 * column) at the row of their time label.
 */
export function tableItems(
  rows: { time: string; cells: { day: number; text: string }[] }[],
  days = DAY_COLUMNS,
): DrawnText[] {
  const items: DrawnText[] = [{ text: 'Hora', x: 20, y: 50 }];
  for (const d of days) items.push({ text: d.label, x: d.x, y: 50 });
  rows.forEach((row, i) => {
    const y = 130 + i * 90;
    items.push({ text: row.time, x: 20, y });
    for (const cell of row.cells) items.push({ text: cell.text, x: days[cell.day]!.x, y });
  });
  return items;
}

/** Format B: a list, one line per entry (day headings and "08:00 - 10:00 Redes" lines). */
export function listItems(lines: string[]): DrawnText[] {
  return lines.map((text, i) => ({ text, x: 30, y: 50 + i * 55 }));
}

// ───────────────────────── PDF ─────────────────────────

const latin1 = (s: string) => Buffer.from(s, 'latin1');

/** Writes a one-page PDF from objects; computes the xref table. */
function assemblePdf(objects: Buffer[]): Buffer {
  const parts: Buffer[] = [latin1('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([latin1(`${i + 1} 0 obj\n`), body, latin1('\nendobj\n')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xrefAt = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(latin1(xref));
  return Buffer.concat(parts);
}

const escapePdf = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** A PDF with a real text layer (Helvetica, WinAnsi: accents work). `y` is measured from the TOP. */
export function buildTextPdf(items: DrawnText[], size = { width: 612, height: 792 }): Buffer {
  const content = items
    .map((i) => `BT /F1 14 Tf ${i.x} ${size.height - i.y} Td (${escapePdf(i.text)}) Tj ET`)
    .join('\n');
  return assemblePdf([
    latin1('<< /Type /Catalog /Pages 2 0 R >>'),
    latin1('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    latin1(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    ),
    Buffer.concat([
      latin1(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n`),
      latin1(content),
      latin1('\nendstream'),
    ]),
    latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  ]);
}

/** A "scanned" PDF: one page that is only a JPEG, no text layer at all. */
export function buildImagePdf(jpeg: Buffer, image = { width: 900, height: 460 }): Buffer {
  const pageW = 612;
  const pageH = Math.round((pageW * image.height) / image.width);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  return assemblePdf([
    latin1('<< /Type /Catalog /Pages 2 0 R >>'),
    latin1('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    latin1(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`,
    ),
    Buffer.concat([
      latin1(`<< /Length ${content.length} >>\nstream\n`),
      latin1(content),
      latin1('\nendstream'),
    ]),
    Buffer.concat([
      latin1(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      latin1('\nendstream'),
    ]),
  ]);
}

/** A text PDF with `count` pages (each says "Pagina n"): for the page limit. */
export function buildMultiPagePdf(count: number): Buffer {
  const kids = Array.from({ length: count }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  const objects: Buffer[] = [
    latin1('<< /Type /Catalog /Pages 2 0 R >>'),
    latin1(`<< /Type /Pages /Kids [${kids}] /Count ${count} >>`),
  ];
  const fontId = 3 + count * 2;
  for (let i = 0; i < count; i++) {
    const content = `BT /F1 14 Tf 40 700 Td (Pagina ${i + 1}) Tj ET`;
    objects.push(
      latin1(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      ),
      latin1(`<< /Length ${content.length} >>
stream
${content}
endstream`),
    );
  }
  objects.push(latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  return assemblePdf(objects);
}

// ───────────────────────── Ready-made documents ─────────────────────────

/** Two classes: Redes (Monday 08:00-10:00) and Bases de Datos (Wednesday 10:00-12:00), as a table image. */
export const twoClassTable = (format: 'png' | 'jpeg' = 'png') =>
  drawTextImage(
    tableItems([
      { time: '08:00 - 10:00', cells: [{ day: 0, text: 'Redes' }] },
      { time: '10:00 - 12:00', cells: [{ day: 2, text: 'Bases de Datos' }] },
    ]),
    undefined,
    format,
  );

/**
 * What a scanner or a phone produces: a full A4-proportioned page (about 150 dpi) with 12-14 pt text, wrapped as a
 * JPEG inside a PDF. Text this size is what OCR meets in real documents.
 */
export const scannedTwoClassPdf = () =>
  buildImagePdf(
    drawTextImage(
      tableItems(
        [
          { time: '08:00 - 10:00', cells: [{ day: 0, text: 'Redes' }] },
          { time: '10:00 - 12:00', cells: [{ day: 2, text: 'Bases de Datos' }] },
        ],
        [
          { x: 330, label: 'Lunes' },
          { x: 640, label: 'Martes' },
          { x: 950, label: 'Miércoles' },
        ],
      ),
      { width: 1240, height: 700 },
      'jpeg',
      30,
    ),
    { width: 1240, height: 700 },
  );

/** The same two classes as a list. */
export const twoClassListItems = () =>
  listItems(['Lunes', '08:00 - 10:00 Redes', 'Miércoles', '10:00 - 12:00 Bases de Datos']);

/**
 * A visual weekly calendar (the pattern of a real timetable, anonymised): day columns, an hour axis down the left side
 * ("9am"… "8pm") and class blocks whose text starts with a COMPACT 24-hour range ("1900-2030"): Wednesday 19:00–20:30
 * "Proyectos II" and Saturday 14:00–16:15 "Prácticas Empresariales" (room A207).
 */
export const weeklyCalendarItems = (): DrawnText[] => {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const colX = (i: number) => 200 + i * 230;
  const items: DrawnText[] = days.map((label, i) => ({ text: label, x: colX(i), y: 50 }));
  const axis = [
    '9am',
    '10am',
    '11am',
    '12pm',
    '1pm',
    '2pm',
    '3pm',
    '4pm',
    '5pm',
    '6pm',
    '7pm',
    '8pm',
  ];
  axis.forEach((t, i) => items.push({ text: t, x: 20, y: 130 + i * 70 }));
  // Wednesday (column 2), at the 7pm row.
  items.push({ text: '1900-2030', x: colX(2), y: 830 });
  items.push({ text: 'ZISXA-Proyectos II', x: colX(2), y: 862 });
  items.push({ text: 'REMOTO Proyecto', x: colX(2), y: 894 });
  // Saturday (column 5), at the 2pm row.
  items.push({ text: '1400-1615', x: colX(5), y: 480 });
  items.push({ text: 'ZISXA-Practicas', x: colX(5), y: 512 });
  items.push({ text: 'Empresariales Practica', x: colX(5), y: 544 });
  items.push({ text: 'Empresariales A207', x: colX(5), y: 576 });
  return items;
};

export const weeklyCalendarImage = (format: 'png' | 'jpeg' = 'png') =>
  drawTextImage(weeklyCalendarItems(), { width: 1700, height: 960 }, format, 24);
