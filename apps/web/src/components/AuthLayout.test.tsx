import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompanionSprite } from '../companion/PixelCompanion';
import { POSE_FACES } from '../companion/pixelArt';
import { AuthLayout, type AuthMood } from './AuthLayout';

const html = (mood?: AuthMood) =>
  renderToStaticMarkup(
    <AuthLayout title="Iniciar sesión" intro="Hola otra vez." mood={mood}>
      <form aria-label="demo" />
    </AuthLayout>,
  );

describe('AuthLayout', () => {
  it('has one h1, the brand as text, the form content and a decorative sky and companion', () => {
    const out = html();
    expect(out.match(/<h1\b/g)).toHaveLength(1);
    expect(out).toContain('Academic Planner');
    expect(out).toContain('<form aria-label="demo"');
    // every picture is hidden from assistive technology and nothing here is focusable but the form
    for (const svg of out.match(/<svg\b[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
    expect(out).not.toMatch(/<(a|button|input)\b/);
    expect(out).not.toMatch(/tabindex/i);
  });

  it('the companion says something for each mood, and what it says never carries information the form does not', () => {
    expect(html('idle')).toContain('Hola otra vez.');
    expect(html('pending')).toContain('Un momentito…');
    expect(html('error')).toContain('Tranquilo, lo revisamos juntos.');
    expect(html('success')).toContain('¡Listo! Pasa.');
    // the line is flavor: hidden from assistive technology (errors live in the form's own alert)
    expect(html('error')).toMatch(/<p[^>]*aria-hidden="true"[^>]*>Tranquilo/);
  });

  it('every animation is motion-safe and written as a full class name', () => {
    const out = html();
    for (const c of [...out.matchAll(/[\w:[\]-]*animate-[\w-]+/g)].map((m) => m[0])) {
      expect(c).toMatch(/^(motion-safe:animate-companion-[a-z]+|animate-settle)$/);
    }
  });
});

describe('companion poses', () => {
  const sprite = (pose?: 'cover' | 'joy' | 'worried') =>
    renderToStaticMarkup(<CompanionSprite state="CALM" pose={pose} />);

  it('each pose looks different from the plain one and from the others', () => {
    const all = [undefined, 'cover', 'joy', 'worried'].map((p) =>
      sprite(p as 'cover' | 'joy' | 'worried' | undefined),
    );
    expect(new Set(all).size).toBe(4);
  });

  it('covering the eyes draws hands and no eyes; the poses stay inside the grid and use only tokens', () => {
    expect(POSE_FACES.cover.eyes).toHaveLength(0);
    for (const face of Object.values(POSE_FACES))
      for (const [x, y, w, h] of [...face.eyes, ...face.rest]) {
        expect(x! + w!).toBeLessThanOrEqual(24);
        expect(y! + h!).toBeLessThanOrEqual(24);
      }
    for (const p of ['cover', 'joy', 'worried'] as const)
      expect(sprite(p)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|<image|url\(/i);
  });

  it('a pose holds its arm still (no greeting wave) and joy raises it', () => {
    expect(sprite()).toContain('motion-safe:animate-companion-wave');
    for (const p of ['cover', 'joy', 'worried'] as const)
      expect(sprite(p)).not.toContain('animate-companion-wave');
    expect(sprite('joy')).toContain('transform="translate(0 -5)"');
  });

  it('an unknown pose falls back to the plain face', () => {
    expect(renderToStaticMarkup(<CompanionSprite state="CALM" pose={'x' as 'cover'} />)).toBe(
      sprite(),
    );
  });
});
