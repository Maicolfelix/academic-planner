import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMPANION_COPY, COMPANION_STATES, type CompanionState } from './companionState';
import { PixelCompanion } from './PixelCompanion';
import { BODY_PATHS, FACES, GRID, pathsOfGrid } from './pixelArt';

const html = (state: CompanionState, nextLine?: string | null) =>
  renderToStaticMarkup(<PixelCompanion state={state} nextLine={nextLine} />);

describe('PixelCompanion', () => {
  it.each(COMPANION_STATES)('%s: shows its one line as normal text', (state) => {
    const out = html(state);
    expect(out).toContain(COMPANION_COPY[state]);
    expect(out).toContain(`data-companion="${state}"`);
  });

  it('the picture is decorative: hidden from assistive technology and not focusable', () => {
    for (const state of COMPANION_STATES) {
      const out = html(state);
      expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(out).toMatch(/<svg[^>]*focusable="false"/);
      expect(out).not.toContain('<title');
      expect(out).not.toContain('aria-label');
    }
  });

  it('is not interactive: no button, link, role, tabindex or handler', () => {
    for (const state of COMPANION_STATES) {
      const out = html(state, 'Lo próximo es tu Quiz.');
      expect(out).not.toMatch(/<(button|a|input|select|textarea)\b/);
      expect(out).not.toMatch(/\b(role|tabindex|onclick|href)=/i);
    }
  });

  it('every animation is behind motion-safe: with reduced motion it is a still picture', () => {
    for (const state of COMPANION_STATES) {
      const classes = [...html(state).matchAll(/class="([^"]*)"/g)].flatMap((m) =>
        m[1]!.split(/\s+/),
      );
      const animated = classes.filter((c) => /animate-/.test(c));
      for (const c of animated)
        expect(c, `${state}: ${c}`).toMatch(/^motion-safe:animate-companion-/);
    }
  });

  it('states differ in the face only; REST is still, BUSY and CALM move a little', () => {
    expect(html('REST')).not.toContain('animate-');
    expect(html('FOCUSED')).toContain('motion-safe:animate-companion-blink');
    expect(html('BUSY')).toContain('motion-safe:animate-companion-bustle');
    expect(html('CALM')).toContain('motion-safe:animate-companion-idle');
    const bodies = COMPANION_STATES.map(
      (s) => html(s).match(/<g class="[^"]*"><path[^>]*d="([^"]*)"/)?.[1],
    );
    expect(new Set(bodies).size).toBe(1); // the same body in every state
    expect(new Set(COMPANION_STATES.map((s) => JSON.stringify(FACES[s]))).size).toBe(
      COMPANION_STATES.length,
    );
  });

  it('shows the next item only when given, as text that wraps', () => {
    expect(html('FOCUSED')).not.toContain('Lo próximo');
    const out = html('FOCUSED', 'Lo próximo es tu Quiz de Ciberseguridad.');
    expect(out).toContain('Lo próximo es tu Quiz de Ciberseguridad.');
    expect(out).toContain('break-words');
    expect(out).toContain('min-w-0');
  });

  it('an unknown state falls back to the neutral one instead of breaking the Home', () => {
    const out = html('SAD' as unknown as CompanionState);
    expect(out).toContain('data-companion="CALM"');
    expect(out).toContain(COMPANION_COPY.CALM);
  });

  it('uses only the app tokens (no hard-coded colors) and no external or raster image', () => {
    const out = html('CALM');
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|<image|<img|url\(/i);
    for (const cls of [...out.matchAll(/class="(fill-[a-z-]+)"/g)].map((m) => m[1]!))
      expect([
        'fill-primary',
        'fill-accent',
        'fill-accent-soft',
        'fill-info',
        'fill-surface',
      ]).toContain(cls);
  });
});

describe('pixel art data', () => {
  it('stays inside its grid and merges runs into paths', () => {
    expect(GRID).toBe(24);
    expect(pathsOfGrid(['AA.A', '..AA'])).toEqual({ A: 'M0 0h2v1h-2zM3 0h1v1h-1zM2 1h2v1h-2z' });
    const nums = Object.values(BODY_PATHS).join('').match(/-?\d+/g)!.map(Number);
    expect(Math.max(...nums.filter((n) => n > 0))).toBeLessThanOrEqual(GRID);
  });
});

describe('the stylesheet contract for reduced motion', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

  it('declares the three companion animations and the global reduced-motion rule that ends every animation at once', () => {
    for (const n of ['companion-idle', 'companion-blink', 'companion-bustle'])
      expect(css).toContain(`--animate-${n}:`);
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('animation-duration: 0.01ms !important');
    expect(reduce).toContain('animation-iteration-count: 1 !important');
  });
});
