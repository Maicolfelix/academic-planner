/*
 * The look of a form control, in one place (FormField and SelectField read it). The controls stay NATIVE (input, select,
 * textarea, date and time pickers): only their dress changes. A tonal fill (the page's soft indigo, not a white slab with a
 * hard black border), a border that still reads at 3:1, and a focus that is an accent outline plus a soft glow
 * (never a thin black rule). Errors keep the word (see FieldError) and also the danger border and fill.
 */

export const FIELD_LABEL = 'text-sm font-medium text-foreground';

const CONTROL =
  'min-h-11 w-full min-w-0 max-w-full rounded-control border px-3 py-2 text-base text-foreground transition-[border-color,box-shadow,background-color] duration-(--duration-fast) ease-standard placeholder:text-muted-foreground focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-secondary disabled:opacity-60';

const OK =
  'border-border-strong bg-background/70 hover:bg-background focus-visible:outline-accent focus-visible:shadow-[0_0_0_4px_rgb(13_148_136/0.15)]';

const INVALID =
  'border-danger bg-danger-soft/40 focus-visible:outline-danger focus-visible:shadow-[0_0_0_4px_rgb(180_35_24/0.15)]';

/** The classes of an input, a textarea or a select. */
export const fieldControl = (invalid: boolean) => `${CONTROL} ${invalid ? INVALID : OK}`;
