import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SUBJECT_COLOR_VALUES, type Subject } from '@planner/core';
import { readableInk, withAlpha } from '../../lib/readableInk';
import { SubjectCard, initialsOf } from './SubjectCard';

const subject = (over: Partial<Subject> = {}): Subject =>
  ({
    id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
    name: 'Bases de Datos',
    color: '#3B82F6',
    professor: null,
    description: null,
    ...over,
  }) as Subject;

const html = (s: Subject) =>
  renderToStaticMarkup(<SubjectCard subject={s} onEdit={() => {}} onDelete={() => {}} />);

describe('initialsOf', () => {
  it('takes the first letters of the significant words, or the first two letters of a single word', () => {
    expect(initialsOf('Bases de Datos')).toBe('BD');
    expect(initialsOf('Redes')).toBe('RE');
    expect(initialsOf('Cálculo Diferencial e Integral')).toBe('CD');
    expect(initialsOf('  álgebra lineal ')).toBe('ÁL');
    expect(initialsOf('IA')).toBe('IA');
    expect(initialsOf('7 + 3')).toBe('7');
  });
});

describe('readableInk and withAlpha', () => {
  it('picks the text color that reads best on a subject color, for every color of the palette', () => {
    expect(readableInk('#000000')).toBe('#ffffff');
    expect(readableInk('#ffffff')).toBe('#0b1030');
    expect(readableInk('#FACC15')).toBe('#0b1030'); // a light yellow needs dark ink
    expect(readableInk('#3B82F6')).toBe('#ffffff'); // a saturated blue looks best with white
    expect(readableInk('#1F2670')).toBe('#ffffff');
    expect(readableInk('not a color')).toBe('#ffffff');
  });

  it('gives every color of the subject palette a monogram that reads (the monogram is large bold text: 3:1, and most reach 4.5:1)', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const color of SUBJECT_COLOR_VALUES)
      expect(contrast(color, readableInk(color)), color).toBeGreaterThanOrEqual(3); // WCAG large text
  });

  it('adds an alpha only to #RRGGBB colors', () => {
    expect(withAlpha('#3B82F6', 0.1)).toBe('#3B82F61a');
    expect(withAlpha('#3B82F6', 1)).toBe('#3B82F6ff');
    expect(withAlpha('#3B82F6', 2)).toBe('#3B82F6ff');
    expect(withAlpha('red', 0.5)).toBe('red');
  });
});

describe('SubjectCard', () => {
  it('is a space, not a row: a monogram tile in its color, a wash and an orb, all decoration', () => {
    const out = html(subject());
    expect(out).toMatch(
      /<span aria-hidden="true" data-subject-swatch="true" style="background-color:#3B82F6;color:#ffffff"[^>]*>BD<\/span>/,
    );
    expect(out).toContain('radial-gradient(120% 80% at 0% 0%, #3B82F629'); // 16 %
    expect(out).toMatch(/<span aria-hidden="true"[^>]*pointer-events-none[^>]*-top-12/);
    expect(out).not.toContain('w-2 shrink-0'); // the old slab
  });

  it('shows the name, and the professor and the description only when they exist', () => {
    const bare = html(subject());
    expect(bare).toContain('Bases de Datos</h2>');
    expect(bare).not.toContain('Profesor');
    const full = html(subject({ professor: 'Carlos Pérez', description: 'Modelo relacional.' }));
    expect(full).toContain('Profesor: Carlos Pérez');
    expect(full).toContain('Modelo relacional.');
  });

  it('keeps Editar and Eliminar as real labelled buttons of 44 px, deleting in the danger color', () => {
    const out = html(subject());
    expect(out).toContain('aria-label="Editar Bases de Datos"');
    expect(out).toContain('aria-label="Eliminar Bases de Datos"');
    expect(out.match(/min-h-11/g)).toHaveLength(2);
    expect(out).toContain('text-danger');
  });

  it('has no ambient loop: a subject only responds to a pointer', () => {
    expect(html(subject())).not.toMatch(/animate-|motion-safe/);
    expect(html(subject())).toContain('group-hover:scale-105');
  });
});
