import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('has a title, a line, the next step, and a picture that is only decoration', () => {
    const out = renderToStaticMarkup(
      <EmptyState title="Aún no tienes actividades." action={<a href="/x">Agregar</a>}>
        Agrega tareas y entregas.
      </EmptyState>,
    );
    expect(out).toContain('Aún no tienes actividades.');
    expect(out).toContain('Agrega tareas y entregas.');
    expect(out).toContain('<a href="/x">Agregar</a>');
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(out).toContain('animate-pop'); // the picture settles once
    expect(out).toContain('border-dashed');
  });

  it('the title is a paragraph unless the screen asks for a heading (the outline does not move)', () => {
    expect(renderToStaticMarkup(<EmptyState title="Vacío" />)).toMatch(
      /<p class="[^"]*">Vacío<\/p>/,
    );
    const heading = renderToStaticMarkup(<EmptyState title="Vacío" titleAs="h2" />);
    expect(heading).toMatch(/<h2 class="[^"]*">Vacío<\/h2>/);
  });

  it('leaves out the line and the action when there are none', () => {
    const out = renderToStaticMarkup(<EmptyState title="Vacío" />);
    expect(out.match(/<p /g)).toHaveLength(1);
  });
});
