import { describe, expect, it } from 'vitest';
import { resolveDeferredDescriptions } from './captureDeferred.js';
import { parseCaptureProposals } from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';

// Monday 5 October 2026, 12:00 in Bogotá.
const ctx: QuickCaptureContext = {
  now: new Date('2026-10-05T17:00:00.000Z'),
  timeZone: 'America/Bogota',
  subjects: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Redes de Computadores' }],
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
};

const MESSAGE =
  'Tengo dos actividades una el martes y la otra actividad el jueves la del martes es sobre redes y la del jueves es práctica con Kali Linux';

describe('announced first, described later', () => {
  it('writes each announced day with what was said about it', () => {
    expect(resolveDeferredDescriptions(MESSAGE)).toBe(
      'actividad de redes el martes. práctica con Kali Linux el jueves.',
    );
  });

  it('also follows "la primera / la segunda"', () => {
    expect(
      resolveDeferredDescriptions(
        'Tengo dos tareas, una para el lunes y otra para el viernes. La primera es un informe y la segunda es el taller de redes.',
      ),
    ).toBe('un informe el lunes. el taller de redes el viernes.');
  });

  it('does nothing unless every announced day is described exactly once', () => {
    expect(resolveDeferredDescriptions('Tengo dos tareas el martes')).toBeNull();
    expect(
      resolveDeferredDescriptions(
        'Tengo dos actividades una el martes y la otra el jueves la del martes es sobre redes',
      ),
    ).toBeNull();
    expect(
      resolveDeferredDescriptions(
        'Tengo dos actividades una el martes y la otra el jueves la del martes es redes y la del martes es kali',
      ),
    ).toBeNull();
  });

  it('turns the message into two proposals on the right days, each with its own words', () => {
    const { proposals } = parseCaptureProposals(MESSAGE, ctx, 'QUICK');
    expect(proposals).toHaveLength(2);
    const [tuesday, thursday] = proposals;
    expect(tuesday!.subject).toMatchObject({ kind: 'EXISTING', name: 'Redes de Computadores' });
    expect(thursday!.title.value).toBe('Práctica con Kali Linux');
    expect(tuesday!.date.value).toBe('2026-10-06');
    expect(thursday!.date.value).toBe('2026-10-08');
  });
});

describe('chatter before the activity is not part of its title', () => {
  it('"tengo que hacer una exposición" is "Exposición"', () => {
    const { proposals } = parseCaptureProposals(
      'tengo que hacer una exposición el viernes y un quiz el lunes',
      ctx,
      'QUICK',
    );
    expect(proposals.map((p) => p.title.value)).toEqual(['Exposición', 'Quiz']);
  });
});

describe('hard messages', () => {
  const rows = (text: string) =>
    parseCaptureProposals(text, ctx, 'QUICK').proposals.map(
      (p) => [p.title.value, p.date.value] as const,
    );

  it('"mañana … y pasado mañana entrega de …" are two activities on two days', () => {
    expect(rows('mañana tengo parcial de redes y pasado mañana entrega de programación')).toEqual([
      ['Parcial', '2026-10-06'],
      ['Entrega de programación', '2026-10-07'],
    ]);
  });

  it('keeps the informe in a list of three', () => {
    expect(
      rows(
        'tengo tres cosas: un taller el lunes, un quiz el miércoles y un informe el viernes',
      ).map((r) => r[0]),
    ).toEqual(['Taller', 'Quiz', 'Informe']);
  });

  it('reads "en dos semanas" and "en 3 días" as dates', () => {
    expect(
      rows('en dos semanas hay exposición de ciberseguridad, en tres semanas el parcial'),
    ).toEqual([
      ['Exposición de ciberseguridad', '2026-10-19'],
      ['Parcial', '2026-10-26'],
    ]);
    expect(rows('quiz de redes en 3 días')[0]![1]).toBe('2026-10-08');
  });

  it('a change of day keeps only the new day', () => {
    expect(rows('el parcial de redes se cambió para el viernes en vez del jueves')).toEqual([
      ['Parcial', '2026-10-09'],
    ]);
  });

  it('a list under "la próxima semana" is of that week', () => {
    expect(rows('para la próxima semana: lunes quiz de redes, martes taller')).toEqual([
      ['Quiz', '2026-10-12'],
      ['Taller', '2026-10-13'],
    ]);
  });

  it('hearsay at the start and "lo entregamos" are not part of the title', () => {
    expect(rows('profe dijo que el taller de bases de datos es el miércoles')[0]![0]).toBe(
      'Taller de bases de datos',
    );
    expect(rows('el informe final lo entregamos el 20 de noviembre')[0]![0]).toBe('Informe final');
  });
});
