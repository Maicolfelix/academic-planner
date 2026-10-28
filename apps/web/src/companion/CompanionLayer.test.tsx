import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { CompanionLayer } from './CompanionLayer';
import { CompanionRestore } from './CompanionRestore';

vi.mock('../auth/useAuth', () => ({
  useMe: () => ({ data: { id: 'u', name: 'Ana', timezone: 'America/Bogota' } }),
}));

const html = (path: string) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <StaticRouter location={path}>
        <CompanionLayer />
      </StaticRouter>
    </QueryClientProvider>,
  );

// Behaviour over time (greeting, walking, typing, hiding, the finished-activity signal) is checked in the browser:
// e2e/companion-roams.spec.ts. Here: the structure that must always hold.
describe('CompanionLayer (structure)', () => {
  it('is one labelled button; only the character catches taps, the lane never does', () => {
    const out = html('/activities');
    expect(out).toContain('data-companion-layer');
    expect(out.match(/<button\b/g)).toHaveLength(1); // the bubble (and its button) only exist after it speaks
    expect(out).toMatch(/aria-label="Tu compañero\. Tócalo para saludar"/);
    expect(out).toMatch(
      /<div[^>]*data-companion-layer[^>]*pointer-events-none|pointer-events-none[^"]*"[^>]*data-companion-layer/,
    );
    expect(out).toMatch(/<button[^>]*pointer-events-auto/);
    expect(out).toContain('size-14'); // 56 px: a comfortable touch target
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('is absent on the Home, which has its own card', () => {
    expect(html('/dashboard')).not.toContain('data-companion-layer');
  });

  it('every animation it adds is motion-safe, written as a full class name', () => {
    const out = html('/activities');
    for (const c of [...out.matchAll(/[\w:-]*animate-[\w-]+/g)].map((m) => m[0]))
      expect(c).toMatch(/^motion-safe:animate-companion-/);
  });

  it('the way back from "hidden" shows nothing while it is not hidden', () => {
    expect(renderToStaticMarkup(<CompanionRestore />)).toBe('');
  });
});
