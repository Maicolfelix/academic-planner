import type { ExtractedDocument, ExtractedPage, ExtractionMethod } from '@planner/core';
import type { OcrProvider, PdfProvider } from './providers.js';
import type { ValidatedFile } from './fileValidation.js';

export interface ExtractionDeps {
  pdf: PdfProvider;
  ocr: OcrProvider;
}

/** A PDF page with fewer words than this has no usable text layer (a scan, a drawing): it goes to OCR. */
export const MIN_PDF_TEXT_WORDS = 8;

const usableWords = (page: ExtractedPage) =>
  page.words.filter((w) => /[\p{L}\d]/u.test(w.text)).length;

export interface Extraction {
  type: 'IMAGE' | 'PDF';
  doc: ExtractedDocument;
  method: 'PDF_TEXT' | 'OCR' | 'MIXED';
}

/**
 * Step "extraction": WHAT TEXT AND WHERE DO I SEE? Nothing here knows what a schedule is.
 *  - image -> OCR;
 *  - PDF   -> the native text layer first (precise and fast), OCR only for the pages that have none.
 * Pages are processed one after another, never in parallel (OCR memory).
 */
export async function extractContent(
  file: ValidatedFile,
  deps: ExtractionDeps,
): Promise<Extraction> {
  if (file.kind !== 'pdf') {
    const words = await deps.ocr.recognize(file.buffer);
    return { type: 'IMAGE', doc: { pages: [{ page: 1, method: 'OCR', words }] }, method: 'OCR' };
  }

  const pages: ExtractedDocument['pages'] = [];
  for (const page of await deps.pdf.readText(file.buffer)) {
    if (usableWords(page) >= MIN_PDF_TEXT_WORDS) {
      pages.push({ ...page, method: 'PDF_TEXT' });
      continue;
    }
    const image = await deps.pdf.renderPage(file.buffer, page.page);
    pages.push({ page: page.page, method: 'OCR', words: await deps.ocr.recognize(image) });
  }
  const methods = new Set<ExtractionMethod>(pages.map((p) => p.method));
  const method = methods.size > 1 ? 'MIXED' : methods.has('OCR') ? 'OCR' : 'PDF_TEXT';
  return { type: 'PDF', doc: { pages }, method };
}
