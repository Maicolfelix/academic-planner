import path from 'node:path';
import { createRequire } from 'node:module';
import {
  SCHEDULE_IMPORT_MAX_PAGES,
  SCHEDULE_IMPORT_MESSAGES,
  type ExtractedPage,
  type ExtractedWord,
} from '@planner/core';
import { createWorker, type Worker } from 'tesseract.js';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { AppError } from '../errors/AppError.js';

/**
 * The external libraries live behind these two small interfaces, so the pipeline (and its tests) never depends
 * on an OCR engine or a PDF library, and either can be replaced.
 */
export interface PdfProvider {
  /** The text layer of each page. A page without one comes back with no words. Throws past the page limit. */
  readText(data: Buffer): Promise<ExtractedPage[]>;
  /** One page drawn as a PNG, for OCR. */
  renderPage(data: Buffer, page: number): Promise<Buffer>;
}

export interface OcrProvider {
  /** The words of an image with their position and confidence. */
  recognize(image: Buffer): Promise<ExtractedWord[]>;
  /** Stops any recognition in progress (used when the time limit is reached). */
  abort(): Promise<void>;
  close(): Promise<void>;
}

// ───────────────────────── PDF ─────────────────────────

/** Native text, with each word placed from the position of the text run it belongs to. */
export function createPdfProvider(): PdfProvider {
  // pdf.js takes ownership of the bytes it is given: always hand it a copy.
  const open = (data: Buffer) => getDocumentProxy(new Uint8Array(data));
  return {
    async readText(data) {
      const doc = await open(data);
      try {
        if (doc.numPages > SCHEDULE_IMPORT_MAX_PAGES) {
          throw new AppError(413, 'TOO_MANY_PAGES', SCHEDULE_IMPORT_MESSAGES.TOO_MANY_PAGES);
        }
        const pages: ExtractedPage[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const [, , , top] = page.view as [number, number, number, number];
          const content = await page.getTextContent();
          const words: ExtractedWord[] = [];
          for (const item of content.items) {
            if (!('str' in item) || item.str.trim() === '') continue;
            const [, , , , tx, ty] = item.transform as number[];
            const height = item.height || Math.abs((item.transform as number[])[3]!) || 10;
            const perChar = item.str.length > 0 ? item.width / item.str.length : 0;
            // pdf.js reports a run of text; its words are placed proportionally along it.
            for (const match of item.str.matchAll(/\S+/g)) {
              words.push({
                text: match[0],
                x: tx! + match.index * perChar,
                y: top - ty! - height,
                width: match[0].length * perChar,
                height,
              });
            }
          }
          pages.push({ page: n, words });
        }
        return pages;
      } finally {
        await doc.cleanup();
      }
    },

    async renderPage(data, page) {
      const png = await renderPageAsImage(new Uint8Array(data), page, {
        canvasImport: () => import('@napi-rs/canvas'),
        scale: 2,
      });
      return Buffer.from(png);
    },
  };
}

// ───────────────────────── OCR ─────────────────────────

const require = createRequire(import.meta.url);

/** Spanish language data shipped with the app (npm package): nothing is downloaded at run time. */
const spanishData = () =>
  path.join(path.dirname(require.resolve('@tesseract.js-data/spa/package.json')), '4.0.0_best_int');

const IDLE_MS = 30_000;

/**
 * Tesseract (WebAssembly) running in a worker thread of this very process: images never leave the machine.
 * One recognition at a time (it is memory hungry); the worker is created on first use and released after a
 * quiet period so an idle server holds no OCR memory.
 */
export function createOcrProvider(): OcrProvider {
  let worker: Promise<Worker> | null = null;
  let idle: NodeJS.Timeout | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const start = () =>
    (worker ??= createWorker('spa', 1, {
      langPath: spanishData(),
      gzip: true,
      cacheMethod: 'none', // never write language data (or anything) to disk
    }));

  const release = async () => {
    clearTimeout(idle);
    const current = worker;
    worker = null;
    await (await current?.catch(() => undefined))?.terminate();
  };

  return {
    recognize(image) {
      const run = async () => {
        clearTimeout(idle);
        const w = await start();
        try {
          const { data } = await w.recognize(image, {}, { blocks: true });
          const words: ExtractedWord[] = [];
          for (const block of data.blocks ?? []) {
            for (const paragraph of block.paragraphs) {
              for (const line of paragraph.lines) {
                for (const word of line.words) {
                  if (word.text.trim() === '') continue;
                  words.push({
                    text: word.text,
                    x: word.bbox.x0,
                    y: word.bbox.y0,
                    width: word.bbox.x1 - word.bbox.x0,
                    height: word.bbox.y1 - word.bbox.y0,
                    confidence: word.confidence,
                  });
                }
              }
            }
          }
          return words;
        } finally {
          idle = setTimeout(() => void release(), IDLE_MS);
          idle.unref();
        }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
    abort: release,
    close: release,
  };
}
