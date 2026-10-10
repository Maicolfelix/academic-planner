import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, postActivity, prisma, resetDb, setupUser } from '../../test/helpers.js';
import { drawTextImage } from '../../test/scheduleImportFixtures.js';
import type { OcrProvider, PdfProvider } from '../scheduleImport/providers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const never = <T>(name: string) =>
  vi.fn(async (): Promise<T> => {
    throw new Error(`${name} must not run`);
  });
/** Extraction engines that fail the test if they are ever asked to work. */
const lazyEngines = () => {
  const ocr = {
    recognize: never('ocr'),
    abort: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } satisfies OcrProvider;
  const pdf = { readText: never('pdf'), renderPage: never('render') } satisfies PdfProvider;
  return { ocr, pdf };
};

describe('odd query strings have one defined behaviour', () => {
  it('repeated parameters are refused; operator-looking keys are inert (they are just unknown keys)', async () => {
    const app = buildApp();
    const { agent, subject } = await setupUser(app, 'q@example.com');
    await postActivity(agent, subject.id, { title: 'Hola' });
    const all = (await agent.get('/api/activities')).body;

    expect((await agent.get('/api/activities?status=PENDING&status=COMPLETED')).status).toBe(400);
    expect(
      (await agent.get('/api/schedule?from=2026-10-01&from=2026-10-02&to=2026-10-05')).status,
    ).toBe(400);
    for (const q of [
      'status[$ne]=PENDING',
      'priority[a]=HIGH',
      'foo=bar',
      'status[]=PENDING',
      '__proto__[x]=1',
      'constructor[prototype][x]=1',
    ]) {
      const res = await agent.get(`/api/activities?${q}`);
      expect(res.status, q).toBe(200);
      expect(res.body, q).toEqual(all); // ignored: it filtered nothing, injected nothing
    }
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // no prototype pollution
    expect((await agent.get('/api/activities?radar=BOGUS')).status).toBe(400);
  });
});

describe('text input of any shape is stored and returned as it was typed (React escapes it on screen)', () => {
  it('markup, quotes, accents and emoji survive untouched and are never sanitised away', async () => {
    const app = buildApp();
    const { agent, subject, period } = await setupUser(app, 'x@example.com');
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg/onload=alert(1)>',
      'Robert\'); DROP TABLE "Activity";--',
      'Ángel ñandú ¿qué? 🎓 日本語',
      '{{7*7}} ${7*7} %s %n',
    ];
    for (const text of payloads) {
      const a = await postActivity(agent, subject.id, { title: text, description: text });
      expect(a.status, text).toBe(201);
      expect(a.body.activity.title).toBe(text);
      expect(a.body.activity.description).toBe(text);
      const s = await agent
        .post('/api/subjects')
        .send({ periodId: period.id, name: text.slice(0, 90) + Math.random() });
      expect([201, 400]).toContain(s.status);
    }
    const list = (await agent.get('/api/activities')).body.activities as { title: string }[];
    for (const text of payloads) expect(list.some((x) => x.title === text)).toBe(true);
    expect(await prisma.activity.count()).toBe(payloads.length); // the SQL-looking one dropped nothing
  });
});

describe('parsers do not stall or crash on hostile text', () => {
  const nasty = (n: number) => [
    'a'.repeat(n),
    ' '.repeat(n),
    '1/'.repeat(n / 2),
    'parcial '.repeat(n / 8),
    '. '.repeat(n / 2),
    'a. m. '.repeat(n / 6),
    '10:'.repeat(n / 3),
    'lunes '.repeat(n / 6),
    '(('.repeat(n / 2),
    'á́'.repeat(n / 2),
    '\u0000\u202e'.repeat(n / 2),
    'de la '.repeat(n / 6),
    '9999999999 '.repeat(n / 11),
    'redes y '.repeat(n / 8),
  ];

  it('Quick Capture (300 characters) and the Inbox (5000) answer fast and never with a 500', async () => {
    const app = buildApp();
    const { agent } = await setupUser(app, 'p@example.com', 'Redes');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let slowest = 0;
    for (const text of nasty(300)) {
      const t0 = Date.now();
      const res = await agent.post('/api/quick-capture/parse').send({ text });
      slowest = Math.max(slowest, Date.now() - t0);
      expect(res.status, JSON.stringify(text.slice(0, 20))).toBeLessThan(500);
    }
    for (const text of nasty(5000)) {
      const t0 = Date.now();
      const res = await agent.post('/api/academic-inbox/parse').send({ text });
      slowest = Math.max(slowest, Date.now() - t0);
      expect(res.status, JSON.stringify(text.slice(0, 20))).toBeLessThan(500);
    }
    // The shared engine, both ways of reading: days, hours, ranges and positions are not a way to make it work hard.
    for (const [mode, size] of [
      ['QUICK', 300],
      ['INBOX', 5000],
    ] as const) {
      const engine = [
        'lunes y '.repeat(size / 8),
        'lunes a '.repeat(size / 8),
        'a las 8 y '.repeat(size / 10),
        'los dos primeros a las 7 '.repeat(size / 25),
        'todos los martes '.repeat(size / 17),
        'lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5 pm '.repeat(
          size / 100,
        ),
        'reunión '.repeat(size / 8),
        'parcial martes y '.repeat(size / 17),
      ];
      for (const text of [...nasty(size), ...engine]) {
        const t0 = Date.now();
        const res = await agent.post('/api/capture/parse').send({ text, mode });
        slowest = Math.max(slowest, Date.now() - t0);
        expect(res.status, JSON.stringify(text.slice(0, 20))).toBeLessThan(500);
      }
    }
    expect(slowest).toBeLessThan(1500);
    expect(errors).not.toHaveBeenCalled();
  });

  it('text over the limits is a clear answer, not work', async () => {
    const app = buildApp();
    const { agent } = await setupUser(app, 'l@example.com', 'Redes');
    expect(
      (await agent.post('/api/quick-capture/parse').send({ text: 'x'.repeat(301) })).body.capture
        .status,
    ).toBe('TOO_LONG');
    expect(
      (await agent.post('/api/academic-inbox/parse').send({ text: 'x'.repeat(5001) })).body.inbox
        .status,
    ).toBe('TOO_LONG');
    expect(
      (await agent.post('/api/quick-capture/parse').send({ text: 'x'.repeat(2001) })).status,
    ).toBe(400);
    expect(
      (await agent.post('/api/academic-inbox/parse').send({ text: 'x'.repeat(20_001) })).status,
    ).toBe(400);
  });
});

describe('the schedule import survives hostile files', () => {
  it('random bytes under every plausible name and type never reach an engine and never a 500', async () => {
    const engines = lazyEngines();
    const app = buildApp({ scheduleImport: { extraction: engines, limit: 1000 } });
    const { agent } = await setupUser(app, 'f@example.com');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < 25; i++) {
      const bytes = randomBytes(1 + Math.floor(Math.random() * 4000));
      for (const [name, type] of [
        ['a.png', 'image/png'],
        ['a.pdf', 'application/pdf'],
        ['a.jpg', 'image/jpeg'],
        ['../../etc/passwd', 'text/plain'],
        ['a'.repeat(300) + '.png', 'image/png'],
      ] as const) {
        const res = await agent
          .post('/api/schedule-import/parse')
          .attach('file', bytes, { filename: name, contentType: type });
        expect(res.status, name).toBeLessThan(500);
        expect(res.status, name).not.toBe(200);
      }
    }
    expect(engines.ocr.recognize).not.toHaveBeenCalled();
    expect(engines.pdf.readText).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('a file over 10 MB is cut off while it uploads (413) and never reaches an engine', async () => {
    const engines = lazyEngines();
    const app = buildApp({ scheduleImport: { extraction: engines } });
    const { agent } = await setupUser(app, 'big@example.com');
    const big = Buffer.concat([drawTextImage([]), Buffer.alloc(10 * 1024 * 1024)]);
    const res = await agent
      .post('/api/schedule-import/parse')
      .attach('file', big, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(engines.ocr.recognize).not.toHaveBeenCalled();
  });

  it('a tiny PNG that claims to be gigantic (decompression bomb) is refused from its header, before any decoding', async () => {
    const engines = lazyEngines();
    const app = buildApp({ scheduleImport: { extraction: engines } });
    const { agent } = await setupUser(app, 'b@example.com');
    const bomb = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bomb);
    bomb.writeUInt32BE(13, 8);
    bomb.write('IHDR', 12);
    bomb.writeUInt32BE(60_000, 16);
    bomb.writeUInt32BE(60_000, 20);
    const res = await agent
      .post('/api/schedule-import/parse')
      .attach('file', bomb, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(engines.ocr.recognize).not.toHaveBeenCalled();
  });

  it('a rejected file releases the user: the next valid upload is accepted, not "already processing"', async () => {
    const ocr: OcrProvider = {
      recognize: vi.fn(async () => []),
      abort: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const app = buildApp({
      scheduleImport: { extraction: { ocr, pdf: lazyEngines().pdf }, limit: 1000 },
    });
    const { agent } = await setupUser(app, 'r@example.com');
    for (const junk of [Buffer.from('basura'), randomBytes(100), Buffer.alloc(0)]) {
      expect(
        (
          await agent
            .post('/api/schedule-import/parse')
            .attach('file', junk, { filename: 'x.png', contentType: 'image/png' })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    }
    const ok = await agent
      .post('/api/schedule-import/parse')
      .attach('file', drawTextImage([]), { filename: 'ok.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('NOTHING_FOUND');
  });

  it('an engine that blows up is a clean 500 for that request, the user is released and the server lives on', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const ocr: OcrProvider = {
      recognize: vi.fn(async () => {
        if (calls++ === 0) throw new Error('C:\\secret\\path engine crashed');
        return [];
      }),
      abort: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const app = buildApp({
      scheduleImport: { extraction: { ocr, pdf: lazyEngines().pdf }, limit: 1000 },
    });
    const { agent } = await setupUser(app, 'e@example.com');
    const png = drawTextImage([]);
    const failed = await agent
      .post('/api/schedule-import/parse')
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toMatch(/secret|crashed|C:/);
    expect(quiet).toHaveBeenCalled();
    const next = await agent
      .post('/api/schedule-import/parse')
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' });
    expect(next.status).toBe(200);
  });

  it('two simultaneous imports of one user: exactly one runs, the other is refused, and the lock is released after', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const ocr: OcrProvider = {
      recognize: vi.fn(async () => {
        await gate;
        return [];
      }),
      abort: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const app = buildApp({
      scheduleImport: {
        extraction: { ocr, pdf: lazyEngines().pdf },
        limit: 1000,
        timeoutMs: 10_000,
      },
    });
    const { agent } = await setupUser(app, 'c@example.com');
    const png = drawTextImage([]);
    const send = () =>
      agent
        .post('/api/schedule-import/parse')
        .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
        .then((r) => r);
    const first = send();
    await vi.waitFor(() => expect(ocr.recognize).toHaveBeenCalledTimes(1));
    const second = await send();
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
    expect((await send()).status).toBe(200);
  });
});

describe('the server keeps answering after all of the above', () => {
  it('health is still green', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
