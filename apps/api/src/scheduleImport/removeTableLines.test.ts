import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  drawTextImage,
  twoClassBorderedTable,
  twoClassTable,
} from '../../test/scheduleImportFixtures.js';
import { removeTableLines } from './removeTableLines.js';

const pixelsOf = async (png: Buffer) => {
  const img = await loadImage(png);
  const g = createCanvas(img.width, img.height).getContext('2d');
  g.drawImage(img, 0, 0);
  return {
    width: img.width,
    height: img.height,
    at: (x: number, y: number) => g.getImageData(x, y, 1, 1).data,
  };
};

/** How many dark pixels fall in a rectangle. */
const inkIn = async (png: Buffer, x: number, y: number, w: number, h: number) => {
  const img = await loadImage(png);
  const g = createCanvas(img.width, img.height).getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(x, y, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i]! < 100) n++;
  return n;
};

describe('removeTableLines', () => {
  it('an image without ruling comes back untouched: the very same buffer', async () => {
    const plain = twoClassTable();
    expect(await removeTableLines(plain)).toBe(plain);
  });

  it('erases the long thin black lines and keeps the words', async () => {
    const ruled = twoClassBorderedTable(3);
    const before = await pixelsOf(ruled);
    expect(before.at(300, 9)[0]).toBeLessThan(50); // a horizontal line is there (y 8..10)
    expect(before.at(11, 100)[0]).toBeLessThan(50); // and a vertical one (x 10..12)

    const out = await removeTableLines(ruled);
    expect(out).not.toBe(ruled);
    const after = await pixelsOf(out);
    expect(after.at(300, 9)[0]).toBe(255);
    expect(after.at(300, 76)[0]).toBe(255);
    expect(after.at(11, 100)[0]).toBe(255);
    expect(after.at(406, 200)[0]).toBe(255);
    // The word "Redes" (x 200.., baseline 130) keeps its strokes.
    expect(await inkIn(out, 195, 105, 90, 32)).toBeGreaterThan(80);
    // And the plain text image has about the same ink in that spot.
    expect(await inkIn(twoClassTable(), 195, 105, 90, 32)).toBeGreaterThan(80);
  });

  it('erases the ruling at the usual thicknesses (1 to 6 px)', async () => {
    for (const thickness of [1, 2, 4, 6]) {
      const out = await removeTableLines(twoClassBorderedTable(thickness));
      const after = await pixelsOf(out);
      expect(after.at(300, 8)[0], `thickness ${thickness}`).toBe(255);
      expect(after.at(10, 100)[0], `thickness ${thickness}`).toBe(255);
    }
  });

  it('keeps a filled block: a dark header bar is not a line', async () => {
    const canvas = createCanvas(600, 300);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 600, 300);
    g.fillStyle = '#1e3a8a';
    g.fillRect(20, 20, 560, 60); // 60 px tall: a block, far thicker than any ruling
    g.fillStyle = '#000000';
    g.fillRect(20, 150, 560, 3); // a real line
    const png = canvas.toBuffer('image/png');
    const out = await removeTableLines(png);
    const after = await pixelsOf(out);
    expect(after.at(300, 50)[0]).toBeLessThan(80); // the bar is still dark
    expect(after.at(300, 151)[0]).toBe(255); // the line is gone
  });

  it('a line is not mistaken for text: letters crossing it keep their strokes', async () => {
    const png = drawTextImage([{ text: 'HHH', x: 100, y: 120 }], { width: 600, height: 300 });
    const out = await removeTableLines(png);
    expect(await inkIn(out, 95, 90, 100, 40)).toBeGreaterThan(100);
  });

  it('data that is not an image comes back as it came', async () => {
    const junk = Buffer.from('this is not a picture');
    expect(await removeTableLines(junk)).toBe(junk);
  });

  it('a tiny image is left alone', async () => {
    const canvas = createCanvas(50, 50);
    const g = canvas.getContext('2d');
    g.fillRect(0, 20, 50, 2);
    const png = canvas.toBuffer('image/png');
    expect(await removeTableLines(png)).toBe(png);
  });
});
