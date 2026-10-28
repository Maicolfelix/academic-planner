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
