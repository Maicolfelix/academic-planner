import { SCHEDULE_IMPORT_MAX_BYTES, SCHEDULE_IMPORT_MESSAGES } from '@planner/core';
import { AppError } from '../errors/AppError.js';

export type FileKind = 'png' | 'jpeg' | 'pdf';

export interface UploadedFile {
  buffer: Buffer;
  /** What the browser claimed. Never trusted on its own. */
  originalname?: string;
  mimetype?: string;
}

export interface ValidatedFile {
  kind: FileKind;
  buffer: Buffer;
}

/** A decoded image this large can exhaust memory (decompression bomb) whatever its size in bytes. */
export const MAX_IMAGE_PIXELS = 25_000_000;

const unsupported = () =>
  new AppError(415, 'UNSUPPORTED_FILE', SCHEDULE_IMPORT_MESSAGES.UNSUPPORTED);

/** What the bytes say the file is: the signature, not the name nor the declared type. */
export function sniffKind(buf: Buffer): FileKind | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // The signature may be preceded by a few bytes of junk in real PDFs, but always within the first 1 KiB.
  if (buf.subarray(0, 1024).includes('%PDF-')) return 'pdf';
  return null;
}

const EXTENSIONS: Record<FileKind, string[]> = {
  png: ['png'],
  jpeg: ['jpg', 'jpeg'],
  pdf: ['pdf'],
};
const MIME_TYPES: Record<FileKind, string[]> = {
  png: ['image/png'],
  jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  pdf: ['application/pdf'],
};

/** Width and height from the header only (nothing is decoded). null when it can not be read. */
export function imageSize(
  buf: Buffer,
  kind: 'png' | 'jpeg',
): { width: number; height: number } | null {
  if (kind === 'png') {
    return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
  }
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * Accepts a PNG, a JPEG or a PDF and nothing else. The decision is made on the CONTENT; the file name and
 * the declared type may only agree with it, never override it (a text file renamed ".png" is rejected, and so
 * is a PDF that claims to be an image). The file name is never used for anything else.
 */
export function validateFile(file: UploadedFile): ValidatedFile {
  if (file.buffer.length === 0) throw unsupported();
  if (file.buffer.length > SCHEDULE_IMPORT_MAX_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', SCHEDULE_IMPORT_MESSAGES.TOO_LARGE);
  }
  const kind = sniffKind(file.buffer);
  if (!kind) throw unsupported();

  const extension = file.originalname?.split('.').pop()?.toLowerCase();
  if (extension && file.originalname!.includes('.') && !EXTENSIONS[kind].includes(extension))
    throw unsupported();
  const mime = file.mimetype?.toLowerCase();
  if (mime && mime !== 'application/octet-stream' && !MIME_TYPES[kind].includes(mime))
    throw unsupported();

  if (kind !== 'pdf') {
    const size = imageSize(file.buffer, kind);
    if (!size || size.width < 1 || size.height < 1) throw unsupported();
    if (size.width * size.height > MAX_IMAGE_PIXELS) {
      throw new AppError(
        413,
        'IMAGE_TOO_LARGE',
        'La imagen tiene una resolución demasiado grande.',
      );
    }
  }
  return { kind, buffer: file.buffer };
}
