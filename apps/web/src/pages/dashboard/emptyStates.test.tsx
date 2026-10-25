import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { NoActivities, NoSubjects } from './EmptyStates';

const html = (node: ReactElement) =>
  renderToStaticMarkup(<StaticRouter location="/dashboard">{node}</StaticRouter>);

const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const routeExists = (to: string) => app.includes(`path="${to.split('?')[0]}"`);
const hrefs = (out: string) => [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
const actions = (out: string) => [...out.matchAll(/<(?:a|button)[ >]/g)].length;

describe('first use: no subjects', () => {
  const out = html(<NoSubjects />);

  it('starts from what the student already has: timetable and a message first, by hand last and quiet', () => {
    expect(out).toContain('Empieza con lo que ya tienes.');
    const order = [
      'Importar mi horario',
      'Interpretar un mensaje',
      'Añadir asignatura manualmente',
    ].map((label) => out.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // the first is the one primary button; the manual one is the quiet (ghost) one
    expect(out.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(out.indexOf('bg-primary text-primary-foreground')).toBeLessThan(
      out.indexOf('Interpretar un mensaje'),
    );
  });

  it('names the Inbox for what it is: it does not promise the Home capture box it does not open', () => {
    expect(out).toContain('href="/inbox"');
    expect(out).not.toContain('Captura rápida');
  });

  it('offers at most three ways, all to routes that exist', () => {
    expect(actions(out)).toBe(3);
    expect(hrefs(out)).toEqual(['/calendar/import', '/inbox', '/subjects?action=create']);
    for (const to of hrefs(out)) expect(routeExists(to), to).toBe(true);
  });

  it('is a title, one sentence and the actions (no extra panel)', () => {
    expect(out.match(/<h2 /g)).toHaveLength(1);
    expect(out.match(/<p /g)?.length).toBe(1);
  });
});

describe('first use: subjects but no activities', () => {
  const out = html(<NoActivities />);

  it('has its own title (the first one is for an account with nothing yet)', () => {
    expect(out).toContain('Registra lo que tienes pendiente.');
    expect(out).not.toContain('Empieza con lo que ya tienes.');
  });

  it('offers capture, a calendar file and the manual way, in that order', () => {
    const order = [
      'Captura rápida',
      'Importar calendario .ics',
      'Añadir actividad manualmente',
    ].map((label) => out.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(actions(out)).toBe(3);
  });

  it('does not offer the timetable import again, and every link goes to a real route', () => {
    expect(out).not.toContain('Importar mi horario');
    expect(hrefs(out)).toEqual(['/calendar/import-ics', '/activities?action=create']);
    for (const to of hrefs(out)) expect(routeExists(to), to).toBe(true);
  });

  it('capture is a button (it focuses the box on this very page), not a link to nowhere', () => {
    expect(out).toMatch(/<button type="button"[^>]*>Captura rápida<\/button>/);
  });
});
