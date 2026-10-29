import { createCanvas, loadImage } from '@napi-rs/canvas';

/** A pixel darker than this (0 black ... 255 white) is ink. */
const INK = 140;
/** Past this many pixels the picture is left alone: the work grows with the area and a table never needs more. */
const MAX_PIXELS = 40_000_000;

/**
 * The ruling of a table (thick black lines between rows and columns) makes the OCR engine read the grid as a picture and
 * return nothing, or noise, instead of the words inside the cells. This paints those lines white before the OCR sees the
 * image. It is deliberately conservative:
 *  - only lines that are LONG (a few percent of the width or height at least) and THIN (a few pixels) are removed, so a
 *    filled block (a dark header, a coloured cell) and the strokes of the letters are kept;
 *  - an image without such lines comes back untouched (the very same buffer), so everything that worked keeps working;
 *  - any failure returns the original image: this is a help for the OCR, never a reason to fail the import.
 */
export async function removeTableLines(image: Buffer): Promise<Buffer> {
  try {
    const picture = await loadImage(image);
    const { width, height } = picture;
    if (width * height > MAX_PIXELS || width < 100 || height < 100) return image;

    const canvas = createCanvas(width, height);
    const g = canvas.getContext('2d');
    g.drawImage(picture, 0, 0);
    const frame = g.getImageData(0, 0, width, height);
    const px = frame.data;

    const ink = new Uint8Array(width * height);
    for (let i = 0; i < ink.length; i++) {
      const o = i * 4;
      const alpha = px[o + 3]!;
      // A transparent pixel is paper.
      const lum = alpha < 128 ? 255 : (px[o]! * 299 + px[o + 1]! * 587 + px[o + 2]! * 114) / 1000;
      ink[i] = lum < INK ? 1 : 0;
    }

    const thin = Math.max(8, Math.round(Math.min(width, height) * 0.012));
    const longAcross = Math.max(60, Math.round(width * 0.08));
    const longDown = Math.max(60, Math.round(height * 0.08));
    const line = new Uint8Array(width * height);

    // Horizontal: a long run of ink in a row, whose pixels have a thin ink extent above and below.
    for (let y = 0; y < height; y++) {
      let x = 0;
      while (x < width) {
        if (!ink[y * width + x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < width && ink[y * width + x]) x++;
        if (x - start < longAcross) continue;
        for (let k = start; k < x; k++) {
          let up = 0;
          while (up <= thin && y - up - 1 >= 0 && ink[(y - up - 1) * width + k]) up++;
          let down = 0;
          while (down <= thin && y + down + 1 < height && ink[(y + down + 1) * width + k]) down++;
          if (up + down + 1 <= thin) line[y * width + k] = 1;
        }
      }
    }
    // Vertical: the same, by columns.
    for (let x = 0; x < width; x++) {
      let y = 0;
      while (y < height) {
        if (!ink[y * width + x]) {
          y++;
          continue;
        }
        const start = y;
        while (y < height && ink[y * width + x]) y++;
        if (y - start < longDown) continue;
        for (let k = start; k < y; k++) {
          let left = 0;
          while (left <= thin && x - left - 1 >= 0 && ink[k * width + x - left - 1]) left++;
          let right = 0;
          while (right <= thin && x + right + 1 < width && ink[k * width + x + right + 1]) right++;
          if (left + right + 1 <= thin) line[k * width + x] = 1;
        }
      }
    }

    let found = 0;
    for (let i = 0; i < line.length; i++) found += line[i]!;
    if (found === 0) return image;

    // Paint the lines white, and the soft edge around them (anti-aliasing) so no grey ghost of the line is left.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!line[y * width + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const o = (ny * width + nx) * 4;
            // Only what is still dark-ish: white paper and coloured cells (light) are not touched by the soft edge.
            const lum = (px[o]! * 299 + px[o + 1]! * 587 + px[o + 2]! * 114) / 1000;
            if (dx === 0 && dy === 0) {
              px[o] = px[o + 1] = px[o + 2] = 255;
              px[o + 3] = 255;
            } else if (lum < 200 && !ink[ny * width + nx]) {
              px[o] = px[o + 1] = px[o + 2] = 255;
            }
          }
        }
      }
    }
    g.putImageData(frame, 0, 0);
    return canvas.toBuffer('image/png');
  } catch {
    return image;
  }
}
