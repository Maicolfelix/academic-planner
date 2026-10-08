import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title as the page h1', () => {
    const out = renderToStaticMarkup(<PageHeader title="Actividades" />);
    expect(out).toMatch(/^<header/);
    expect(out).toContain('<h1 class="text-page-title">Actividades</h1>');
    expect(out.match(/<h1/g)).toHaveLength(1);
  });

  it('shows the description and the actions only when given', () => {
    const bare = renderToStaticMarkup(<PageHeader title="Mis asignaturas" />);
    expect(bare).not.toContain('<p');
    const full = renderToStaticMarkup(
      <PageHeader
        title="Mis asignaturas"
        description="Segundo semestre 2026"
        actions={<button type="button">Agregar asignatura</button>}
      />,
    );
    expect(full).toContain('Segundo semestre 2026');
    expect(full).toContain('<button type="button">Agregar asignatura</button>');
  });

  it('renders nothing for an action that is false (the "no list yet" case)', () => {
    const out = renderToStaticMarkup(<PageHeader title="Actividades" actions={false} />);
    expect(out).not.toContain('<button');
  });
});
