import fs from 'node:fs';
import os from 'node:os';
import {
  SCHEDULE_IMPORT_MAX_BYTES,
  SCHEDULE_IMPORT_MAX_PAGES,
  scheduleImportResultSchema,
  toLocalParts,
  type ExtractedWord,
  type ScheduleImportResult,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';
import {
  buildImagePdf,
  buildMultiPagePdf,
  buildTextPdf,
  drawTextImage,
  listItems,
  scannedTwoClassPdf,
  tableItems,
  twoClassListItems,
  twoClassTable,
  weeklyCalendarImage,
} from '../../test/scheduleImportFixtures.js';
import { validateFile, sniffKind, MAX_IMAGE_PIXELS } from './fileValidation.js';
import { extractContent, MIN_PDF_TEXT_WORDS, type ExtractionDeps } from './pipeline.js';
import { createOcrProvider, createPdfProvider, type OcrProvider } from './providers.js';

const realOcr = createOcrProvider();
const pdf = createPdfProvider();
afterAll(async () => {
  await realOcr.close();
  await prisma.$disconnect();
});
beforeEach(resetDb);

/** The real OCR, counting how often it is asked (to prove a text PDF never reaches it). */
const spyOcr = (): OcrProvider & { calls: number } => {
  const spy = {
    calls: 0,
    recognize: (image: Buffer) => {
      spy.calls++;
      return realOcr.recognize(image);
    },
    abort: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return spy;
};

const word = (text: string, x: number, y: number): ExtractedWord => ({
  text,
  x,
  y,
  width: 60,
  height: 20,
});

const appWith = (
  extraction: ExtractionDeps,
  more: { limit?: number; timeoutMs?: number; log?: (e: unknown) => void } = {},
) => buildApp({ scheduleImport: { extraction, ...more, log: more.log as never } });

const upload = (
  agent: request.Agent,
  buffer: Buffer,
  filename = 'horario.png',
  contentType?: string,
) => agent.post('/api/schedule-import/parse').attach('file', buffer, { filename, contentType });

const parsed = (res: request.Response): ScheduleImportResult => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return scheduleImportResultSchema.parse(res.body);
};

const summary = (r: ScheduleImportResult) =>
  r.proposals.map((p) => [p.weekday, p.startTime, p.endTime, p.title, p.status]);

const TWO_CLASSES = [
  [1, '08:00', '10:00', 'Redes', 'READY'],
  [3, '10:00', '12:00', 'Bases de Datos', 'READY'],
];

// ───────────────────────── File validation ─────────────────────────

const PNG_HEADER = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

describe('validateFile', () => {
  const png = twoClassTable('png');
  const jpeg = twoClassTable('jpeg');
  const textPdf = buildTextPdf([{ text: 'Lunes', x: 40, y: 40 }]);

  it('accepts a PNG, a JPEG and a PDF by their CONTENT', () => {
    expect(validateFile({ buffer: png, originalname: 'h.png', mimetype: 'image/png' }).kind).toBe(
      'png',
    );
    expect(validateFile({ buffer: jpeg, originalname: 'h.jpg', mimetype: 'image/jpeg' }).kind).toBe(
      'jpeg',
    );
    expect(validateFile({ buffer: jpeg, originalname: 'h.JPEG' }).kind).toBe('jpeg');
    expect(
      validateFile({ buffer: textPdf, originalname: 'h.pdf', mimetype: 'application/pdf' }).kind,
    ).toBe('pdf');
    expect(
      validateFile({
        buffer: png,
        originalname: 'sin-extension',
        mimetype: 'application/octet-stream',
      }).kind,
    ).toBe('png');
  });

  it('rejects a text file renamed .png', () => {
    expect(() =>
      validateFile({
        buffer: Buffer.from('Lunes 08:00 Redes'),
        originalname: 'h.png',
        mimetype: 'image/png',
      }),
    ).toThrow(/Formato no compatible/);
  });

  it('rejects content that disagrees with the name or the declared type (spoofing)', () => {
    expect(() =>
      validateFile({ buffer: textPdf, originalname: 'h.png', mimetype: 'image/png' }),
    ).toThrow(/Formato/);
    expect(() => validateFile({ buffer: png, originalname: 'h.pdf' })).toThrow(/Formato/);
    expect(() =>
      validateFile({ buffer: png, originalname: 'h.png', mimetype: 'application/pdf' }),
    ).toThrow(/Formato/);
  });

  it('rejects other formats even when the bytes are an image', () => {
    const gif = Buffer.from('GIF89a......................');
    expect(() =>
      validateFile({ buffer: gif, originalname: 'h.gif', mimetype: 'image/gif' }),
    ).toThrow(/Formato/);
    expect(() => validateFile({ buffer: Buffer.alloc(0), originalname: 'h.png' })).toThrow(
      /Formato/,
    );
  });

  it('rejects more than 10 MB', () => {
    const big = Buffer.concat([png, Buffer.alloc(SCHEDULE_IMPORT_MAX_BYTES)]);
    expect(() => validateFile({ buffer: big, originalname: 'h.png' })).toThrow(
      'El archivo es demasiado grande.',
    );
    expect(() => validateFile({ buffer: Buffer.alloc(SCHEDULE_IMPORT_MAX_BYTES + 1) })).toThrow(
      'El archivo es demasiado grande.',
    );
  });

  it('rejects an image that would decode to too many pixels (decompression bomb)', () => {
    expect(() =>
      validateFile({ buffer: PNG_HEADER(20_000, 20_000), originalname: 'b.png' }),
    ).toThrow(/resolución/);
    expect(MAX_IMAGE_PIXELS).toBeLessThan(20_000 * 20_000);
    expect(() =>
      validateFile({ buffer: PNG_HEADER(1200, 800), originalname: 'ok.png' }),
    ).not.toThrow();
  });

  it('never trusts a file name for anything but a consistency check (path-like names are harmless)', () => {
    const v = validateFile({
      buffer: png,
      originalname: '../../etc/passwd.png',
      mimetype: 'image/png',
    });
    expect(v).toEqual({ kind: 'png', buffer: png });
    expect(sniffKind(Buffer.from('MZ\u0090\u0000'))).toBeNull();
  });
});

// ───────────────────────── Extraction pipeline ─────────────────────────

describe('extractContent', () => {
  const fakePdf = (pages: ExtractedWord[][]) => ({
    readText: vi.fn(async () => pages.map((words, i) => ({ page: i + 1, words }))),
    renderPage: vi.fn(async () => Buffer.from('png')),
  });
  const fakeOcr = (words: ExtractedWord[]) => ({
    recognize: vi.fn(async () => words),
    abort: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  });
  const textWords = Array.from({ length: MIN_PDF_TEXT_WORDS }, (_, i) =>
    word(`palabra${i}`, i * 70, 10),
  );

  it('an image goes to OCR', async () => {
    const ocr = fakeOcr([word('Lunes', 0, 0)]);
    const r = await extractContent(
      { kind: 'png', buffer: Buffer.from('x') },
      { pdf: fakePdf([]), ocr },
    );
    expect(r).toMatchObject({ type: 'IMAGE', method: 'OCR' });
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
  });

  it('a PDF with a text layer NEVER calls OCR', async () => {
    const ocr = fakeOcr([]);
    const pdfFake = fakePdf([textWords, textWords]);
    const r = await extractContent(
      { kind: 'pdf', buffer: Buffer.from('x') },
      { pdf: pdfFake, ocr },
    );
    expect(r).toMatchObject({ type: 'PDF', method: 'PDF_TEXT' });
    expect(ocr.recognize).not.toHaveBeenCalled();
    expect(pdfFake.renderPage).not.toHaveBeenCalled();
  });

  it('a page without text falls back to OCR; the other pages keep their native text', async () => {
    const ocr = fakeOcr([word('Redes', 0, 0)]);
    const pdfFake = fakePdf([textWords, []]);
    const r = await extractContent(
      { kind: 'pdf', buffer: Buffer.from('x') },
      { pdf: pdfFake, ocr },
    );
    expect(r.method).toBe('MIXED');
    expect(r.doc.pages.map((p) => p.method)).toEqual(['PDF_TEXT', 'OCR']);
    expect(pdfFake.renderPage).toHaveBeenCalledTimes(1);
    expect(pdfFake.renderPage).toHaveBeenCalledWith(expect.anything(), 2);
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
  });

  it('a text layer with only a few stray words is not trusted', async () => {
    const ocr = fakeOcr([word('Redes', 0, 0)]);
    const stray = textWords.slice(0, MIN_PDF_TEXT_WORDS - 1);
    const r = await extractContent(
      { kind: 'pdf', buffer: Buffer.from('x') },
      { pdf: fakePdf([stray]), ocr },
    );
    expect(r.method).toBe('OCR');
  });

  it('pages are OCR-ed one after another, never in parallel', async () => {
    let running = 0;
    let peak = 0;
    const ocr = {
      recognize: vi.fn(async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
        return [word('x', 0, 0)];
      }),
      abort: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    await extractContent(
      { kind: 'pdf', buffer: Buffer.from('x') },
      { pdf: fakePdf([[], [], []]), ocr },
    );
    expect(ocr.recognize).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });
});

describe('providers (real engines on synthetic files)', () => {
  it('reads the text layer of a PDF with positions, top to bottom', async () => {
    const [page] = await pdf.readText(buildTextPdf(listItems(['Lunes', '08:00 - 10:00 Redes'])));
    const texts = page!.words.map((w) => w.text);
    expect(texts).toEqual(['Lunes', '08:00', '-', '10:00', 'Redes']);
    const [lunes, , , , redes] = page!.words;
    expect(redes!.y).toBeGreaterThan(lunes!.y); // y grows downwards
    expect(redes!.x).toBeGreaterThan(lunes!.x);
  });

  it('a scanned PDF has no text layer and renders to an image', async () => {
    const scanned = buildImagePdf(twoClassTable('jpeg'));
    const [page] = await pdf.readText(scanned);
    expect(page!.words).toEqual([]);
    expect(sniffKind(await pdf.renderPage(scanned, 1))).toBe('png');
  });

  it('refuses a PDF past the page limit', async () => {
    await expect(pdf.readText(buildMultiPagePdf(SCHEDULE_IMPORT_MAX_PAGES))).resolves.toHaveLength(
      SCHEDULE_IMPORT_MAX_PAGES,
    );
    await expect(
      pdf.readText(buildMultiPagePdf(SCHEDULE_IMPORT_MAX_PAGES + 1)),
    ).rejects.toMatchObject({
      status: 413,
      code: 'TOO_MANY_PAGES',
    });
  });

  it('OCR returns words with a box and a confidence', async () => {
    const words = await realOcr.recognize(drawTextImage([{ text: 'Redes', x: 40, y: 80 }]));
    expect(words.map((w) => w.text)).toEqual(['Redes']);
    expect(words[0]).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
    expect(words[0]!.confidence).toBeGreaterThan(50);
  });
});

// ───────────────────────── The endpoint ─────────────────────────

describe('POST /api/schedule-import/parse — access and input', () => {
  const app = appWith({ pdf, ocr: realOcr });

  it('requires a session', async () => {
    const res = await request(app)
      .post('/api/schedule-import/parse')
      .attach('file', twoClassTable(), 'h.png');
    expect(res.status).toBe(401);
  });

  it.each([
    ['no body', (a: request.Agent) => a.post('/api/schedule-import/parse')],
    ['a JSON body', (a: request.Agent) => a.post('/api/schedule-import/parse').send({ file: 'x' })],
    [
      'a file in the wrong field',
      (a: request.Agent) =>
        a.post('/api/schedule-import/parse').attach('upload', twoClassTable(), 'h.png'),
    ],
    [
      'an extra text field (userId, periodId…)',
      (a: request.Agent) =>
        a
          .post('/api/schedule-import/parse')
          .field('userId', 'x')
          .attach('file', twoClassTable(), 'h.png'),
    ],
    [
      'two files',
      (a: request.Agent) =>
        a
          .post('/api/schedule-import/parse')
          .attach('file', twoClassTable(), 'a.png')
          .attach('file', twoClassTable(), 'b.png'),
    ],
  ])('rejects %s with a validation error', async (_l, send) => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await send(agent);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a user without a current period gets a clear error and nothing is read', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await upload(agent, twoClassTable());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
  });

  it('a text file renamed .png is rejected (415) and never reaches OCR', async () => {
    const ocr = spyOcr();
    const a = appWith({ pdf, ocr });
    const { agent } = await setupUser(a, 'a@example.com');
    const res = await upload(agent, Buffer.from('Lunes 08:00 Redes'), 'horario.png', 'image/png');
    expect(res.status).toBe(415);
    expect(res.body.error.message).toBe(
      'Formato no compatible. Usa una imagen PNG o JPG, o un PDF.',
    );
    expect(ocr.calls).toBe(0);
  });

  it('a file over 10 MB is cut off while uploading (413)', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const big = Buffer.concat([twoClassTable(), Buffer.alloc(SCHEDULE_IMPORT_MAX_BYTES)]);
    const res = await upload(agent, big);
    expect(res.status).toBe(413);
    expect(res.body.error.message).toBe('El archivo es demasiado grande.');
  });

  it('a PDF with too many pages is refused with a clear message', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await upload(
      agent,
      buildMultiPagePdf(SCHEDULE_IMPORT_MAX_PAGES + 1),
      'h.pdf',
      'application/pdf',
    );
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('TOO_MANY_PAGES');
  });
});

describe('POST /api/schedule-import/parse — interpretation', () => {
  const ocr = spyOcr();
  const app = appWith({ pdf, ocr: ocr });

  async function twoSubjects(email = 'a@example.com') {
    const u = await setupUser(app, email, 'Redes');
    const bases = (
      await u.agent.post('/api/subjects').send({ periodId: u.period.id, name: 'Bases de Datos' })
    ).body.subject;
    return { ...u, bases };
  }

  it('a table image: two classes, matched to the subjects, dated from the period start', async () => {
    const { agent, subject, bases } = await twoSubjects();
    const res = await upload(agent, twoClassTable());
    const r = parsed(res);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(summary(r)).toEqual(TWO_CLASSES);
    expect(r).toMatchObject({
      source: { type: 'IMAGE', pages: 1, method: 'OCR' },
      layout: 'TABLE',
      status: 'OK',
    });
    expect(r.proposals[0]).toMatchObject({
      type: 'CLASS',
      subjectId: subject.id,
      date: '2026-08-03',
      recurrence: { frequency: 'WEEKLY', until: periodInput.endDate },
      duplicateOf: null,
      conflicts: [],
    });
    expect(r.proposals[1]).toMatchObject({ subjectId: bases.id, date: '2026-08-05' });
    expect(r.period).toMatchObject({
      startDate: periodInput.startDate,
      endDate: periodInput.endDate,
    });
  });

  it('a list image gives the same classes', async () => {
    const { agent } = await twoSubjects();
    const r = parsed(
      await upload(agent, drawTextImage(twoClassListItems(), { width: 800, height: 320 })),
    );
    expect(r.layout).toBe('LIST');
    expect(summary(r)).toEqual(TWO_CLASSES);
  });

  it('a JPEG works too', async () => {
    const { agent } = await twoSubjects();
    const r = parsed(await upload(agent, twoClassTable('jpeg'), 'horario.jpg', 'image/jpeg'));
    expect(summary(r)).toEqual(TWO_CLASSES);
  });

  it('a time table with single hours and rooms: merges consecutive rows, ignores the room', async () => {
    const { agent } = await twoSubjects();
    const items = tableItems([
      { time: '08:00', cells: [{ day: 0, text: 'Redes' }] },
      { time: '09:00', cells: [{ day: 0, text: 'Redes' }] },
      { time: '10:00', cells: [{ day: 2, text: 'Bases de Datos' }] },
      { time: '11:00', cells: [] },
    ]);
    const r = parsed(await upload(agent, drawTextImage(items, { width: 900, height: 520 })));
    expect(summary(r)).toEqual([
      [1, '08:00', '10:00', 'Redes', 'READY'],
      [3, '10:00', '11:00', 'Bases de Datos', 'READY'],
    ]);
  });

  it('a PDF with a text layer: native text, OCR never used', async () => {
    const { agent } = await twoSubjects();
    const before = ocr.calls;
    const pdfText = buildTextPdf(
      listItems(['Lunes', '08:00 - 10:00 Redes', 'Miércoles', '10:00 - 12:00 Bases de Datos']),
    );
    const r = parsed(await upload(agent, pdfText, 'horario.pdf', 'application/pdf'));
    expect(r.source).toMatchObject({ type: 'PDF', method: 'PDF_TEXT', pages: 1 });
    expect(summary(r)).toEqual(TWO_CLASSES);
    expect(ocr.calls).toBe(before);
  });

  it('a scanned PDF: OCR fallback', async () => {
    const { agent } = await twoSubjects();
    const before = ocr.calls;
    const scanned = scannedTwoClassPdf();
    const r = parsed(await upload(agent, scanned, 'escaneado.pdf', 'application/pdf'));
    expect(r.source).toMatchObject({ type: 'PDF', method: 'OCR' });
    expect(summary(r)).toEqual(TWO_CLASSES);
    expect(ocr.calls).toBe(before + 1);
  });

  it('a partial name is only suggested; an unknown subject asks for a manual choice', async () => {
    const u = await setupUser(app, 'likely@example.com', 'Redes de Computadores');
    const items = listItems(['Lunes', '08:00 - 10:00 Redes', 'Martes', '10:00 - 12:00 Quimica']);
    const r = parsed(await upload(u.agent, drawTextImage(items, { width: 800, height: 320 })));
    const [likely, missing] = r.proposals;
    expect(likely).toMatchObject({ subjectId: null, status: 'REVIEW' });
    expect(likely!.subjectMatch).toMatchObject({ status: 'LIKELY', suggestedId: u.subject.id });
    expect(likely!.warnings.map((w) => w.code)).toContain('SUBJECT_LIKELY');
    expect(missing!.subjectMatch.status).toBe('MISSING');
    expect(missing!.warnings.map((w) => w.code)).toContain('SUBJECT_MISSING');
  });

  it('an image with no text: 200 with an honest message, not an error', async () => {
    const { agent } = await twoSubjects();
    const r = parsed(await upload(agent, drawTextImage([])));
    expect(r.status).toBe('NOTHING_FOUND');
    expect(r.proposals).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['NOTHING_READ', 'LOW_TEXT']);
    expect(r.warnings[0]!.message).toBe('No pudimos leer suficiente información del horario.');
  });

  it('ownership: only the user’s own subjects of the current period are ever matched', async () => {
    const a = await twoSubjects('a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Anatomía');
    const items = listItems(['Lunes', '08:00 - 10:00 Anatomía']);
    const r = parsed(await upload(a.agent, drawTextImage(items, { width: 800, height: 200 })));
    expect(r.proposals[0]!.subjectMatch.status).toBe('MISSING');
    expect(JSON.stringify(r)).not.toContain(b.subject.id);
    const mine = parsed(await upload(b.agent, drawTextImage(items, { width: 800, height: 200 })));
    expect(mine.proposals[0]!.subjectId).toBe(b.subject.id);
  });

  it('it only proposes: nothing is created or stored, and no file touches the temp folder', async () => {
    const { agent } = await twoSubjects();
    const tmpBefore = new Set(fs.readdirSync(os.tmpdir()));
    await upload(agent, twoClassTable());
    await upload(agent, buildImagePdf(twoClassTable('jpeg')), 'e.pdf', 'application/pdf');
    await upload(agent, Buffer.from('basura'), 'x.png', 'image/png');
    expect(await prisma.scheduleBlock.count()).toBe(0);
    const fresh = fs.readdirSync(os.tmpdir()).filter((f) => !tmpBefore.has(f));
    expect(fresh.filter((f) => /\.(png|jpe?g|pdf|traineddata)|tesseract|planner/i.test(f))).toEqual(
      [],
    );
  });
});

// ───────────────────────── Duplicates and conflicts ─────────────────────────

describe('duplicates and conflicts against the agenda', () => {
  const app = appWith({ pdf, ocr: realOcr });
  const createClass = (agent: request.Agent, subjectId: string, over: object = {}) =>
    agent.post('/api/schedule').send({
      type: 'CLASS',
      subjectId,
      title: 'Redes',
      date: '2026-08-03',
      startTime: '08:00',
      endTime: '10:00',
      recurrence: { frequency: 'WEEKLY', until: periodInput.endDate },
      ...over,
    });

  it('the same class already in the agenda is a duplicate (and not also a conflict with itself)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const existing = (await createClass(agent, subject.id).expect(201)).body.block;
    const r = parsed(await upload(agent, twoClassTable()));
    const redes = r.proposals.find((p) => p.title === 'Redes')!;
    expect(redes.duplicateOf).toEqual({ id: existing.id, title: 'Redes' });
    expect(redes.warnings.map((w) => w.code)).toContain('POSSIBLE_DUPLICATE');
    expect(redes.warnings.find((w) => w.code === 'POSSIBLE_DUPLICATE')!.message).toBe(
      'Esta clase parece estar ya en tu agenda.',
    );
    expect(redes.conflicts).toEqual([]);
  });

  it('an overlapping DIFFERENT class is a conflict, not a duplicate', async () => {
    const { agent, subject, period } = await setupUser(app, 'a@example.com', 'Redes');
    const bases = (
      await agent.post('/api/subjects').send({ periodId: period.id, name: 'Bases de Datos' })
    ).body.subject;
    const other = (
      await createClass(agent, bases.id, {
        title: 'Bases de Datos',
        startTime: '09:00',
        endTime: '11:00',
      }).expect(201)
    ).body.block;
    const r = parsed(await upload(agent, twoClassTable()));
    const redes = r.proposals.find((p) => p.title === 'Redes')!;
    expect(redes.subjectId).toBe(subject.id);
    expect(redes.duplicateOf).toBeNull();
    expect(redes.conflicts).toHaveLength(1);
    expect(redes.conflicts[0]).toMatchObject({ blockId: other.id, title: 'Bases de Datos' });
    expect(redes.status).toBe('READY'); // a warning, never a block
  });

  it('ownership: another user’s identical class never counts', async () => {
    const a = await setupUser(app, 'a@example.com', 'Redes');
    const b = await setupUser(app, 'b@example.com', 'Redes');
    await createClass(b.agent, b.subject.id).expect(201);
    const r = parsed(await upload(a.agent, twoClassTable()));
    const redes = r.proposals.find((p) => p.title === 'Redes')!;
    expect(redes.duplicateOf).toBeNull();
    expect(redes.conflicts).toEqual([]);
  });

  it('a one-off block of the same hour is not "the same weekly class"', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    await createClass(agent, subject.id, { recurrence: null }).expect(201);
    const redes = parsed(await upload(agent, twoClassTable())).proposals.find(
      (p) => p.title === 'Redes',
    )!;
    expect(redes.duplicateOf).toBeNull();
  });
});

// ───────────────────────── Confirming goes through the Schedule API ─────────────────────────

describe('importing the proposals', () => {
  const app = appWith({ pdf, ocr: realOcr });
  const toBody = (p: ScheduleImportResult['proposals'][number], over: object = {}) => ({
    type: p.type,
    subjectId: p.subjectId,
    title: p.title,
    date: p.date,
    startTime: p.startTime,
    endTime: p.endTime,
    recurrence: p.recurrence,
    ...over,
  });

  it('creates weekly CLASS blocks through POST /api/schedule, visible in the agenda', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    await agent.post('/api/subjects').send({ periodId: period.id, name: 'Bases de Datos' });
    const r = parsed(await upload(agent, twoClassTable()));
    for (const p of r.proposals) {
      const res = await agent.post('/api/schedule').send(toBody(p));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.block).toMatchObject({
        type: 'CLASS',
        title: p.title,
        recurrence: { frequency: 'WEEKLY', weekday: p.weekday },
      });
    }
    expect(await prisma.scheduleBlock.count()).toBe(2);
    const week = await agent.get('/api/schedule?from=2026-08-03&to=2026-08-09');
    expect(week.body.occurrences.map((o: { title: string }) => o.title)).toEqual([
      'Redes',
      'Bases de Datos',
    ]);
    // The second pass now sees both as duplicates.
    const again = parsed(await upload(agent, twoClassTable()));
    expect(again.proposals.every((p) => p.duplicateOf !== null)).toBe(true);
  });

  it('five proposals, three imported: only three blocks exist; an invalid one does not stop the rest', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    for (const name of ['Bases de Datos', 'Anatomía', 'Cálculo', 'Física']) {
      await agent.post('/api/subjects').send({ periodId: period.id, name });
    }
    const items = listItems([
      'Lunes',
      '08:00 - 10:00 Redes',
      '10:00 - 12:00 Bases de Datos',
      'Martes',
      '08:00 - 10:00 Anatomía',
      '10:00 - 12:00 Cálculo',
      '14:00 - 16:00 Física',
    ]);
    const r = parsed(await upload(agent, drawTextImage(items, { width: 800, height: 460 })));
    expect(r.proposals).toHaveLength(5);
    const chosen = [r.proposals[0]!, r.proposals[2]!, r.proposals[4]!];
    const invalid = { ...toBody(r.proposals[1]!), endTime: '09:00' }; // ends before it starts
    expect((await agent.post('/api/schedule').send(invalid)).status).toBe(400);
    for (const p of chosen)
      expect((await agent.post('/api/schedule').send(toBody(p))).status).toBe(201);
    expect(await prisma.scheduleBlock.count()).toBe(3);
  });
});

// ───────────────────────── Post-RC fix: a visual calendar (compact ranges + hour axis) ─────────────────────────

describe('a visual weekly calendar: compact ranges and an hour axis (real OCR)', () => {
  const app = appWith({ pdf, ocr: realOcr });

  async function subjects(email = 'cal@example.com') {
    const u = await setupUser(app, email, 'Proyectos II');
    await u.agent
      .post('/api/subjects')
      .send({ periodId: u.period.id, name: 'Prácticas Empresariales' });
    return u;
  }

  it('reads exactly two classes with their real days and hours; the hour axis is not a class', async () => {
    const { agent } = await subjects();
    const r = parsed(await upload(agent, weeklyCalendarImage()));
    expect(r.proposals.map((p) => [p.weekday, p.startTime, p.endTime, p.title])).toEqual([
      [3, '19:00', '20:30', 'Proyectos II'],
      [6, '14:00', '16:15', 'Prácticas Empresariales'],
    ]);
    // Matched by the existing rule (the label contains the whole subject name); nothing is guessed.
    expect(r.proposals.map((p) => p.subjectMatch.status)).toEqual(['EXACT', 'EXACT']);
    for (const p of r.proposals) {
      expect(p.title).not.toMatch(/\b\d{1,2}\s?pm\b|\d{4}-\d{4}/i); // no axis label or range left in the title
      expect(p.missingFields).toEqual([]);
    }
  });

  it('only proposes: nothing is stored until the student confirms', async () => {
    const { agent } = await subjects();
    parsed(await upload(agent, weeklyCalendarImage()));
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('confirming creates the two weekly classes with the right hours; importing again warns about duplicates', async () => {
    const { agent } = await subjects();
    const r = parsed(await upload(agent, weeklyCalendarImage()));
    for (const p of r.proposals) {
      const res = await agent.post('/api/schedule').send({
        type: p.type,
        subjectId: p.subjectId,
        title: p.title,
        date: p.date,
        startTime: p.startTime,
        endTime: p.endTime,
        recurrence: p.recurrence,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const blocks = await prisma.scheduleBlock.findMany({ orderBy: { startAt: 'asc' } });
    expect(
      blocks.map((b) => [
        b.title,
        toLocalParts(b.startAt, 'America/Bogota').time,
        toLocalParts(b.endAt, 'America/Bogota').time,
      ]),
    ).toEqual([
      ['Proyectos II', '19:00', '20:30'],
      ['Prácticas Empresariales', '14:00', '16:15'],
    ]);
    const again = parsed(await upload(agent, weeklyCalendarImage()));
    expect(again.proposals).toHaveLength(2);
    expect(again.proposals.every((p) => p.duplicateOf !== null)).toBe(true);
  });

  it('a subject whose name is only SIMILAR is never applied: the student chooses', async () => {
    const { agent } = await setupUser(app, 'sim@example.com', 'Proyecto II');
    const r = parsed(await upload(agent, weeklyCalendarImage()));
    expect(r.proposals[0]).toMatchObject({ weekday: 3, startTime: '19:00', endTime: '20:30' });
    expect(r.proposals[0]!.subjectId).toBeNull();
    expect(r.proposals[0]!.status).toBe('REVIEW');
  });
});

// ───────────────────────── Limits: time, concurrency, rate ─────────────────────────

describe('limits', () => {
  /** An OCR engine that waits until the test lets it finish. */
  const hanging = () => {
    const abort = vi.fn(async () => undefined);
    let calls = 0;
    let open: (w: ExtractedWord[]) => void = () => undefined;
    let gate = new Promise<ExtractedWord[]>((resolve) => (open = resolve));
    const ocr: OcrProvider = {
      recognize: () => {
        calls++;
        return gate;
      },
      abort,
      close: async () => undefined,
    };
    return {
      ocr,
      abort,
      calls: () => calls,
      finish: () => {
        open([]);
        gate = new Promise<ExtractedWord[]>((resolve) => (open = resolve));
      },
    };
  };

  it('stops a request that takes too long (504) and stops the engine', async () => {
    const h = hanging();
    const app = appWith({ pdf, ocr: h.ocr }, { timeoutMs: 150 });
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await upload(agent, twoClassTable());
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('IMPORT_TIMEOUT');
    expect(h.abort).toHaveBeenCalled();
    // The user is not stuck: a new request is accepted afterwards.
    const next = await upload(agent, Buffer.from('x'), 'a.png');
    expect(next.status).toBe(415);
  });

  it('one import at a time per user; released when it finishes', async () => {
    const h = hanging();
    const app = appWith({ pdf, ocr: h.ocr }, { timeoutMs: 8000 });
    const a = await setupUser(app, 'a@example.com');
    const first = upload(a.agent, twoClassTable()).then((r) => r); // superagent sends on .then
    await vi.waitFor(() => expect(h.calls()).toBe(1));
    const second = await upload(a.agent, twoClassTable());
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('IMPORT_IN_PROGRESS');
    h.finish();
    expect((await first).status).toBe(200);
    const third = upload(a.agent, twoClassTable()).then((r) => r);
    await vi.waitFor(() => expect(h.calls()).toBe(2));
    h.finish();
    expect((await third).status).toBe(200);
  });

  it('is rate limited (429) after the allowed number of imports', async () => {
    const app = appWith(
      {
        pdf,
        ocr: {
          recognize: async () => [],
          abort: async () => undefined,
          close: async () => undefined,
        },
      },
      { limit: 2 },
    );
    const { agent } = await setupUser(app, 'a@example.com');
    expect((await upload(agent, twoClassTable())).status).toBe(200);
    expect((await upload(agent, twoClassTable())).status).toBe(200);
    const res = await upload(agent, twoClassTable());
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('logging and privacy', () => {
  it('logs type, size, duration and outcome, never the text read or academic data', async () => {
    const events: unknown[] = [];
    const app = appWith({ pdf, ocr: realOcr }, { log: (e) => events.push(e) });
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    await upload(agent, twoClassTable());
    await upload(agent, Buffer.from('basura'), 'x.png', 'image/png');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: 'schedule_import',
      type: 'IMAGE',
      result: 'OK',
      method: 'OCR',
      proposals: 2,
    });
    expect(events[1]).toMatchObject({
      type: 'REJECTED',
      result: 'ERROR',
      code: 'UNSUPPORTED_FILE',
    });
    const logged = JSON.stringify(events);
    expect(logged).not.toMatch(/Redes|Bases|08:00|lunes/i);
    expect(logged).toMatch(/"bytes":\d+/);
    expect(logged).toMatch(/"ms":\d+/);
  });
});

describe('performance (this machine, for the record)', () => {
  it('image, text PDF and scanned PDF', async () => {
    const app = appWith({ pdf, ocr: realOcr });
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const timings: Record<string, number> = {};
    for (const [label, buf, name, type] of [
      ['image', twoClassTable(), 'a.png', 'image/png'],
      [
        'pdf-text',
        buildTextPdf(listItems(['Lunes', '08:00 - 10:00 Redes'])),
        'a.pdf',
        'application/pdf',
      ],
      ['pdf-scanned', scannedTwoClassPdf(), 'b.pdf', 'application/pdf'],
    ] as const) {
      const t0 = Date.now();
      expect((await upload(agent, buf, name, type)).status).toBe(200);
      timings[label] = Date.now() - t0;
    }
    console.info('schedule import timings (ms):', JSON.stringify(timings));
    expect(timings['pdf-text']!).toBeLessThan(5000);
    expect(timings['image']!).toBeLessThan(20_000);
  });
});
