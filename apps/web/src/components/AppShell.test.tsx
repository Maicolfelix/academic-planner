import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppShell, MAIN_NAV } from './AppShell';

/** The shell as the server would render it at `path`: the structure a screen reader and a keyboard get. */
function shell(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <StaticRouter location={path}>
        <AppShell />
      </StaticRouter>
    </QueryClientProvider>,
  );
}

const nav = (html: string) => /<nav[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
const links = (html: string) =>
  [...nav(html).matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: /href="([^"]*)"/.exec(attrs!)?.[1],
    current: /aria-current="page"/.test(attrs!),
    text: inner!.replaceAll(/<svg[\s\S]*?<\/svg>/g, '').replaceAll(/<[^>]+>/g, ''),
    iconHidden: /<svg[^>]*aria-hidden="true"/.test(inner!),
  }));

describe('main navigation', () => {
  it('is one landmark called "Principal" with the four daily destinations, in order', () => {
    const html = shell('/dashboard');
    expect(html.match(/<nav /g)).toHaveLength(1);
    expect(nav(html)).toContain('aria-label="Principal"');
    expect(links(html).map((l) => [l.text, l.href])).toEqual([
      ['Inicio', '/dashboard'],
      ['Actividades', '/activities'],
      ['Agenda', '/calendar'],
      ['Asignaturas', '/subjects'],
    ]);
    expect(MAIN_NAV.map((i) => i.to)).toEqual([
      '/dashboard',
      '/activities',
      '/calendar',
      '/subjects',
    ]);
  });

  it('is four plain links (no list items: screens count their own cards), each icon decoration next to a text label', () => {
    const html = shell('/dashboard');
    expect(nav(html).match(/<li /g)).toBeNull();
    expect(links(html)).toHaveLength(4);
    for (const link of links(html)) {
      expect(link.iconHidden, link.text).toBe(true);
      expect(link.text.trim().length, link.href).toBeGreaterThan(2);
    }
  });

  it.each([
    ['/dashboard', 'Inicio'],
    ['/activities', 'Actividades'],
    ['/calendar', 'Agenda'],
    ['/calendar/import', 'Agenda'],
    ['/subjects', 'Asignaturas'],
  ])('at %s only "%s" is the current page (aria-current, not just color)', (path, label) => {
    const current = links(shell(path)).filter((l) => l.current);
    expect(current.map((l) => l.text)).toEqual([label]);
  });

  it('on a screen that is not one of the four (Radar) none is marked', () => {
    expect(links(shell('/radar')).filter((l) => l.current)).toEqual([]);
  });

  it('does not list the secondary screens (they are reached from the screen where they make sense)', () => {
    const texts = links(shell('/dashboard')).map((l) => l.text);
    for (const secondary of ['Radar', 'Progreso', 'Bandeja', 'Importar horario']) {
      expect(texts.join('|')).not.toContain(secondary);
    }
  });

  it('shows no reminder badge until there are reminders (nothing is faked)', () => {
    expect(shell('/dashboard')).not.toContain('🔔');
  });
});

describe('shell structure', () => {
  const html = shell('/dashboard');

  it('has one banner, one main, a skip link first, and the sign-out OUTSIDE the navigation', () => {
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.indexOf('Saltar al contenido')).toBeLessThan(html.indexOf('<header'));
    const header = /<header[\s\S]*?<\/header>/.exec(html)![0];
    expect(header).toContain('Cerrar sesión');
    expect(nav(html)).not.toContain('Cerrar sesión');
  });

  it('keeps the phone bar clear of the iPhone home indicator and the content clear of the bar', () => {
    // fixed to the bottom edge on a phone and padded by the bottom safe area
    expect(nav(html)).toContain('class="fixed ');
    expect(nav(html)).toContain('bottom-0');
    expect(nav(html)).toContain('pb-[env(safe-area-inset-bottom)]');
    // …and in the top bar from lg (1024 px) up
    expect(nav(html)).toContain('lg:static');
    // the last element of a page can scroll above the bar
    expect(/<main[^>]*class="[^"]*pb-24/.test(html)).toBe(true);
  });

  it('every destination is a 44 px target at least', () => {
    expect(nav(html)).toContain('min-h-14');
    expect(nav(html)).toContain('lg:min-h-11');
  });

  it('is a reading column everywhere except the weekly grid', () => {
    expect(shell('/activities')).toContain('max-w-3xl');
    expect(shell('/calendar')).toContain('max-w-6xl');
  });
});

describe('sliding indicator of the phone bar', () => {
  const indicator = (path: string) => {
    const out = shell(path);
    const tag = /<span aria-hidden="true" data-nav-indicator="(-?\d+)"[^>]*>/.exec(out);
    return {
      tag: tag?.[0] ?? '',
      index: tag ? Number(tag[1]) : Number.NaN,
      translate: /translateX\((\d+)%\)/.exec(tag?.[0] ?? '')?.[1],
      opacity: /opacity:\s*(\d)/.exec(tag?.[0] ?? '')?.[1],
    };
  };

  it.each([
    ['/dashboard', 0],
    ['/activities', 1],
    ['/calendar', 2],
    ['/calendar/import', 2],
    ['/subjects', 3],
  ])('at %s it sits under destination %i (the same rule as aria-current)', (path, index) => {
    const i = indicator(path);
    expect(i.index).toBe(index);
    expect(i.translate).toBe(String(index * 100));
    expect(i.opacity).toBe('1');
  });

  it('hides on screens that are not one of the four, and is never what tells the place', () => {
    const i = indicator('/radar');
    expect(i.index).toBe(-1);
    expect(i.opacity).toBe('0');
    // it is decoration: aria-hidden, no focus, no taps, only on phone and tablet
    expect(i.tag).toContain('aria-hidden="true"');
    expect(i.tag).toContain('pointer-events-none');
    expect(i.tag).toContain('lg:hidden');
    // the real signal is still on the link
    expect(links(shell('/radar')).filter((l) => l.current)).toEqual([]);
  });

  it('moves with transform and opacity only', () => {
    expect(indicator('/activities').tag).toContain('transition-[transform,opacity]');
  });

  it('the icon capsule exists for every destination and lifts only for the current one', () => {
    const out = nav(shell('/activities'));
    expect(out.match(/rounded-full px-4 py-0.5/g)).toHaveLength(4);
    expect(out.match(/-translate-y-0.5 bg-accent-soft/g)).toHaveLength(1);
  });
});
