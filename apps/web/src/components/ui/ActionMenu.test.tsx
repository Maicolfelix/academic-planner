import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionMenu } from './ActionMenu';

describe('ActionMenu (closed)', () => {
  const out = renderToStaticMarkup(
    <ActionMenu
      label="Más acciones: Parcial 1"
      items={[
        { label: 'Añadir al calendario', onSelect: () => {} },
        { label: 'Eliminar', danger: true, onSelect: () => {} },
      ]}
    />,
  );

  it('is one real button that names its card and announces a menu, collapsed', () => {
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-label="Más acciones: Parcial 1"');
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('aria-controls');
  });

  it('puts nothing of its items in the page until it is opened, and its trigger is a 44 px target', () => {
    expect(out).not.toContain('role="menu"');
    expect(out).not.toContain('Eliminar');
    expect(out).toContain('size-11');
  });

  it('draws the three dots as decoration', () => {
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
