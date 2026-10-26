// Runs INSIDE the runtime image (cwd /app) to prove the Linux/container build can do what only native code and local data
// can: argon2 hashing, @napi-rs/canvas, tesseract.js with the bundled Spanish data, and the schedule-import route end to end.
//
//   docker cp scripts/fixtures/ocr-sample.png <container>:/tmp/ocr-sample.png
//   docker exec -i -e OCR_FIXTURE=/tmp/ocr-sample.png <container> node --input-type=module - < scripts/container-check.mjs
//
// Module resolution of a script piped through stdin starts at the working directory (/app), so the app's own dependencies load.
// Uses the app's real code (dist/) and one synthetic account over the container's own loopback; prints one line per check.

import { readFileSync } from 'node:fs';

let failed = 0;
const report = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const attempt = async (name, fn) => {
  try {
    const detail = await fn();
    report(name, true, typeof detail === 'string' ? detail : '');
  } catch (err) {
    report(name, false, String(err?.message ?? err).split('\n')[0]);
  }
};

const fixture = process.env.OCR_FIXTURE ?? '/tmp/ocr-sample.png';

await attempt('argon2 (native): hash and verify', async () => {
  const argon2 = (await import('argon2')).default;
  const hash = await argon2.hash('container check', { type: argon2.argon2id });
  if (!(await argon2.verify(hash, 'container check'))) throw new Error('verify returned false');
  if (await argon2.verify(hash, 'another')) throw new Error('verified a wrong password');
  return `argon2id ${hash.slice(0, 12)}…`;
});

await attempt('@napi-rs/canvas (native): draw and encode a PNG', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(40, 20);
  canvas.getContext('2d').fillRect(0, 0, 40, 20);
  const png = canvas.toBuffer('image/png');
  if (png.length < 50 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return `${png.length} bytes`;
});

await attempt('unpdf (PDF text provider) loads', async () => {
  const providers = await import('/app/apps/api/dist/scheduleImport/providers.js');
  if (typeof providers.createPdfProvider !== 'function')
    throw new Error('createPdfProvider missing');
  providers.createPdfProvider();
});

await attempt('tesseract.js + the bundled Spanish data read the sample image', async () => {
  const { createOcrProvider } = await import('/app/apps/api/dist/scheduleImport/providers.js');
  const ocr = createOcrProvider();
  try {
    const words = await ocr.recognize(readFileSync(fixture));
    const text = words
      .map((w) => w.text)
      .join(' ')
      .toUpperCase();
    if (!/LUNES/.test(text) || !/REDES/.test(text))
      throw new Error(`unexpected text: ${text.slice(0, 80)}`);
    return `${words.length} words: ${text.slice(0, 50)}…`;
  } finally {
    await ocr.close();
  }
});

// The route itself: a real session, a real multipart upload, the real OCR. Anything but a handled answer (5xx) is a failure.
await attempt(
  'POST /api/schedule-import/parse answers (OCR, canvas and data paths work behind the route)',
  async () => {
    const port = process.env.API_PORT || process.env.PORT || 3000;
    const base = `http://127.0.0.1:${port}`;
    const origin = (process.env.CORS_ORIGIN ?? '').split(',')[0].trim();
    const tag = Date.now().toString(36);
    const headers = { 'content-type': 'application/json', ...(origin && { origin }) };
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Container Check',
        email: `container-${tag}@smoke.planner.invalid`,
        password: `container-${tag}-correct-horse`,
      }),
    });
    if (reg.status !== 201) throw new Error(`register ${reg.status}`);
    const cookie = reg.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    // The route needs a current period; without one it answers 400 NO_CURRENT_PERIOD BEFORE it reads the image.
    const iso = (d) => d.toISOString().slice(0, 10);
    const now = Date.now();
    const period = await fetch(`${base}/api/periods`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, ...(origin && { origin }) },
      body: JSON.stringify({
        name: 'Container',
        startDate: iso(new Date(now - 30 * 864e5)),
        endDate: iso(new Date(now + 90 * 864e5)),
        isCurrent: true,
      }),
    });
    if (period.status !== 201) throw new Error(`create period ${period.status}`);
    const form = new FormData();
    form.append('file', new Blob([readFileSync(fixture)], { type: 'image/png' }), 'ocr-sample.png');
    const res = await fetch(`${base}/api/schedule-import/parse`, {
      method: 'POST',
      headers: { cookie, ...(origin && { origin }) },
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200)
      throw new Error(`HTTP ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    return `HTTP 200, status ${body.status ?? '?'}, ${body.proposals?.length ?? 0} proposal(s) read by OCR`;
  },
);

console.log(failed === 0 ? '\ncontainer check: all passed' : `\ncontainer check: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
