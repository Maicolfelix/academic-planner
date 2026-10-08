import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { buttonStyles } from './buttonStyles';
import { Card } from './Card';

const html = (node: ReactElement) => renderToStaticMarkup(node);

describe('buttonStyles', () => {
  it('every variant and size keeps the 44 px touch target', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      for (const size of ['md', 'sm'] as const) {
        expect(buttonStyles({ variant, size })).toContain('min-h-11');
      }
    }
  });

  it('is secondary and medium by default, and appends the caller’s classes', () => {
    const classes = buttonStyles({ className: 'text-danger' });
    expect(classes).toContain('border-border-strong');
    expect(classes).toContain('px-4');
    expect(classes.endsWith('text-danger')).toBe(true);
  });

  it('secondary sets no text color, so a caller’s text color cannot fight it', () => {
    expect(buttonStyles({ variant: 'secondary' })).not.toMatch(/(^| )text-(?!sm)/);
  });

  it('the filled variants carry their own readable text color', () => {
    expect(buttonStyles({ variant: 'primary' })).toContain('text-primary-foreground');
    expect(buttonStyles({ variant: 'danger' })).toContain('text-primary-foreground');
  });
});

describe('Button', () => {
  it('is a native button of type "button" unless a submit is asked for', () => {
    expect(html(<Button>Guardar</Button>)).toMatch(/^<button type="button"/);
    expect(html(<Button type="submit">Guardar</Button>)).toMatch(/^<button type="submit"/);
  });

  it('keeps its text as the accessible name and lets aria-label replace it', () => {
    expect(html(<Button>Editar</Button>)).toContain('>Editar</button>');
    const labelled = html(<Button aria-label="Editar Redes">Editar</Button>);
    expect(labelled).toContain('aria-label="Editar Redes"');
  });

  it('renders disabled as the real attribute', () => {
    expect(html(<Button disabled>Guardar</Button>)).toContain('disabled=""');
    expect(html(<Button>Guardar</Button>)).not.toContain('disabled=');
  });
});

describe('Card', () => {
  it('is a div by default and can be a list item or a landmark section', () => {
    expect(html(<Card>x</Card>)).toMatch(/^<div /);
    expect(html(<Card as="li">x</Card>)).toMatch(/^<li /);
    expect(
      html(
        <Card as="section" aria-label="Filtros">
          x
        </Card>,
      ),
    ).toContain('aria-label="Filtros"');
  });

  it('solid has an elevation, dashed (an empty state) has none', () => {
    expect(html(<Card>x</Card>)).toContain('shadow-card');
    const dashed = html(<Card variant="dashed">x</Card>);
    expect(dashed).toContain('border-dashed');
    expect(dashed).not.toContain('shadow-card');
  });

  it('holds whatever it is given and keeps the caller’s layout classes', () => {
    const out = html(
      <Card className="p-4 flex">
        <p>contenido</p>
      </Card>,
    );
    expect(out).toContain('<p>contenido</p>');
    expect(out).toContain('p-4 flex');
  });
});

describe('Badge', () => {
  it('shows its text (color is never the only cue) and passes other props through', () => {
    const out = html(
      <Badge tone="success" title="Estado">
        Finalizada
      </Badge>,
    );
    expect(out).toContain('Finalizada');
    expect(out).toContain('title="Estado"');
    expect(out).toContain('border-success-line');
  });

  it('the critical tone is the solid one', () => {
    const critical = html(<Badge tone="critical">Vencida</Badge>);
    expect(critical).toMatch(/ bg-danger /);
    expect(critical).toContain('text-primary-foreground');
    expect(html(<Badge tone="danger">Alta</Badge>)).toContain('bg-danger-soft');
  });
});

/** The tokens file: values live in `:root`, and the contrast pairs the primitives rely on stay readable. */
describe('design tokens (index.css)', () => {
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  const root = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? '';
  const value = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root)?.[1];

  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it('every theme color points at a variable that exists in :root', () => {
    const mapped = [...css.matchAll(/--color-([a-z-]+):\s*var\(--([a-z-]+)\)/g)];
    expect(mapped.length).toBeGreaterThan(20);
    for (const [, name, target] of mapped) {
      expect(root, `--color-${name} -> --${target}`).toContain(`--${target}:`);
    }
  });

  it.each([
    ['foreground', 'background', 7],
    ['muted-foreground', 'background', 4.5],
    ['primary-foreground', 'primary', 7],
    ['primary-foreground', 'danger', 4.5],
    ['danger-ink', 'danger-soft', 7],
    ['warning-ink', 'warning-soft', 7],
    ['success-ink', 'success-soft', 7],
    ['info-ink', 'info-soft', 7],
    ['foreground', 'surface-elevated', 7],
    ['muted-foreground', 'surface', 7],
    ['border-strong', 'surface', 3], // the outline of a field or an outlined button (WCAG 1.4.11)
    ['accent', 'surface', 3], // the progress fill and the current-place mark
    ['accent', 'secondary', 3], // …and the fill against its own track
    ['accent-ink', 'accent-soft', 4.5],
    ['accent-ink', 'surface', 7],
  ])('%s on %s has contrast of at least %s:1', (fg, bg, min) => {
    const [a, b] = [value(fg), value(bg)];
    expect(a, fg).toBeDefined();
    expect(b, bg).toBeDefined();
    expect(contrast(a!, b!)).toBeGreaterThanOrEqual(min);
  });

  it('the focus ring is visible against the page (3:1, WCAG non-text contrast)', () => {
    expect(contrast(value('foreground')!, value('background')!)).toBeGreaterThanOrEqual(3);
  });

  it('the motion foundation respects prefers-reduced-motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
