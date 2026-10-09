import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormField } from './FormField';
import { Modal } from './Modal';
import { SelectField } from './SelectField';
import { Disclosure, FieldError, FormActions, FormError } from './ui/form';

const field = (props: Partial<Parameters<typeof FormField>[0]> = {}) =>
  renderToStaticMarkup(<FormField id="f" label="Título" value="" onChange={() => {}} {...props} />);

describe('FormField', () => {
  it('is a native control tied to its label, tall enough to tap, with the tonal look and an accent focus', () => {
    const out = field();
    expect(out).toContain('<label for="f"');
    expect(out).toMatch(/<input[^>]*id="f"[^>]*type="text"/);
    expect(out).toContain('min-h-11');
    expect(out).toContain('focus-visible:outline-accent');
    expect(out).toContain('focus-visible:shadow-[0_0_0_4px_rgb(13_148_136/0.15)]'); // the soft glow
    expect(out).toContain('border-border-strong'); // a border that still reads (3:1)
    expect(out).not.toMatch(/slate-|red-\d|outline-black/);
  });

  it('keeps the native types: a date and a time stay real pickers, a long text a real textarea', () => {
    expect(field({ type: 'date' })).toContain('type="date"');
    expect(field({ type: 'time' })).toContain('type="time"');
    expect(field({ multiline: true })).toMatch(/<textarea[^>]*rows="3"/);
  });

  it('says an error in words with an icon, links it, and marks the field invalid (not only a color)', () => {
    const out = field({ error: 'Ingresa un título.' });
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="f-error"');
    expect(out).toMatch(
      /<p id="f-error"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*<span>Ingresa un título\.<\/span><\/p>/,
    );
    expect(out).toContain('border-danger');
  });

  it('shows a hint until there is an error, and only links the one that is on screen', () => {
    const hinted = field({ hint: 'Sin hora, vence al terminar el día.' });
    expect(hinted).toContain('id="f-hint"');
    expect(hinted).toContain('aria-describedby="f-hint"');
    const both = field({ hint: 'Una pista', error: 'Un error' });
    expect(both).not.toContain('f-hint');
    expect(both).toContain('aria-describedby="f-error"');
  });

  it('can be required or disabled for assistive technology and for the hand', () => {
    expect(field({ required: true })).toContain('aria-required="true"');
    expect(field({ disabled: true })).toMatch(/<input[^>]*disabled/);
    expect(field()).not.toContain('aria-required');
  });
});

const select = (props: Partial<Parameters<typeof SelectField>[0]> = {}) =>
  renderToStaticMarkup(
    <SelectField
      id="s"
      label="Asignatura"
      value=""
      onChange={() => {}}
      options={[
        { value: 'a', label: 'Redes' },
        { value: 'b', label: 'Bases' },
      ]}
      {...props}
    />,
  );

describe('SelectField', () => {
  it('is a native select (the picker of every phone) whose arrow is ours: a chevron that is decoration', () => {
    const out = select();
    expect(out).toMatch(/<select[^>]*id="s"/);
    expect(out).toContain('appearance-none');
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"[^>]*pointer-events-none/);
    expect(out).toContain('min-h-11');
    expect(out).toContain('<option value="a"');
  });

  it('reads an unchosen placeholder as such, and a chosen value in the normal ink', () => {
    // (the control also carries `placeholder:text-muted-foreground`: look for the plain class)
    const plain = /<select[^>]*class="(?:[^"]* )?text-muted-foreground/;
    expect(select({ placeholder: 'Elige…', value: '' })).toMatch(plain);
    expect(select({ placeholder: 'Elige…', value: 'a' })).not.toMatch(plain);
  });

  it('says its error in words with an icon and links it', () => {
    const out = select({ error: 'Elige una asignatura.' });
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="s-error"');
    expect(out).toContain('Elige una asignatura.');
    expect(out).toContain('border-danger');
  });
});

describe('form pieces', () => {
  it('FieldError and FormError carry an icon AND the words; the form one is announced at once', () => {
    const fe = renderToStaticMarkup(<FieldError id="x-error">Mal</FieldError>);
    expect(fe).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(fe).toContain('<span>Mal</span>');
    const fm = renderToStaticMarkup(<FormError>No se pudo guardar.</FormError>);
    expect(fm).toContain('role="alert"');
    expect(fm).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(fm).toContain('No se pudo guardar.');
  });

  it('Disclosure is a native details/summary: a 44 px row, a chevron that turns, content that rises in, closed unless told', () => {
    const closed = renderToStaticMarkup(<Disclosure summary="Más opciones">x</Disclosure>);
    expect(closed).toMatch(/^<details class="group /);
    expect(closed).not.toMatch(/<details[^>]*\sopen/);
    expect(closed).toMatch(/<summary[^>]*min-h-11[^>]*>/);
    expect(closed).toContain('[&amp;::-webkit-details-marker]:hidden');
    expect(closed).toContain('group-open:rotate-180');
    expect(closed).toContain('group-open:animate-rise');
    expect(
      renderToStaticMarkup(
        <Disclosure summary="m" open>
          x
        </Disclosure>,
      ),
    ).toMatch(/<details[^>]*\sopen=""/);
  });

  it('FormActions keeps the order of its buttons, puts a destructive shortcut apart on the left and has no loop', () => {
    const out = renderToStaticMarkup(
      <FormActions start={<button>Eliminar</button>}>
        <button>Cancelar</button>
        <button>Guardar</button>
      </FormActions>,
    );
    expect(out.indexOf('Eliminar')).toBeLessThan(out.indexOf('Cancelar'));
    expect(out.indexOf('Cancelar')).toBeLessThan(out.indexOf('Guardar'));
    expect(out).toContain('mr-auto');
    expect(out).not.toMatch(/animate-(halo|breathe|scan|drift|node|orbit)/);
  });
});

describe('Modal', () => {
  const out = renderToStaticMarkup(
    <Modal title="Agregar actividad" onClose={() => {}}>
      <p>cuerpo</p>
    </Modal>,
  );

  it('is a native dialog named by its title, with its content', () => {
    expect(out).toMatch(/^<dialog aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(out)![1];
    expect(out).toContain(`<h2 id="${id}"`);
    expect(out).toContain('<p>cuerpo</p>');
  });

  it('wears Pulso Ambiental: an entrance, an indigo veil, a thin accent edge as decoration, and no blur', () => {
    expect(out).toContain('animate-dialog');
    expect(out).toContain('backdrop:bg-[rgb(20_26_60/0.5)]');
    expect(out).toMatch(/<span aria-hidden="true"[^>]*pointer-events-none[^>]*h-\[3px\]/);
    expect(out).not.toMatch(/blur/);
    expect(out).not.toMatch(/slate-|amber-/);
  });

  it('stays centered with a margin on every side and scrolls inside when a form is taller than the screen', () => {
    expect(out).toContain('m-auto');
    // never `relative`/`absolute`/`static` on the dialog itself: its native `position: fixed` is what keeps it on screen
    expect(/^<dialog[^>]*class="([^"]*)"/.exec(out)![1]!.split(' ')).not.toEqual(
      expect.arrayContaining(['relative']),
    );
    expect(out).toContain('max-h-[calc(100dvh-2rem)]');
    expect(out).toContain('overflow-y-auto');
    expect(out).toContain('w-[min(31rem,calc(100vw-2rem))]');
  });
});
