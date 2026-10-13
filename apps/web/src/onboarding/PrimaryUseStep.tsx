import type { PrimaryUse } from '@planner/core';
import { Button } from '../components/ui/Button';
import { INTERACTIVE_TILE } from '../components/ui/interactive';
import {
  BookIcon,
  CalendarIcon,
  CheckIcon,
  CheckSquareIcon,
  SparkIcon,
  UserIcon,
} from '../components/ui/icons';
import { USE_OPTIONS, type UseIcon } from './onboardingModel';

const ICONS: Record<UseIcon, () => React.ReactNode> = {
  book: () => <BookIcon />,
  check: () => <CheckSquareIcon />,
  user: () => <UserIcon className="size-6" />,
  spark: () => <SparkIcon className="size-6" />,
  calendar: () => <CalendarIcon />,
};

interface Props {
  /** What the student tapped (kept visible if saving fails, so nothing seems lost). */
  selected: PrimaryUse | null;
  /** What the server already has: with an answer, "skip" only goes on (it never un-answers). */
  current?: PrimaryUse | null;
  /** A request is in flight: the options wait. */
  pending: boolean;
  /** Said when saving failed. */
  error?: string;
  onPick: (value: PrimaryUse) => void;
  onSkip: () => void;
}

/**
 * STEP 1, one question: what the student uses the app for. Large real buttons (one tap chooses and saves; a button, not a
 * radio, so moving with the keyboard never saves a choice by accident). The chosen one says so in words, not only in color
 * (`aria-pressed` and a check mark). Skipping is always there and never blocks anything.
 */
export function PrimaryUseStep({
  selected,
  current = null,
  pending,
  error,
  onPick,
  onSkip,
}: Props) {
  return (
    <>
      <div role="group" aria-labelledby="onboarding-use-title" className="flex flex-col gap-3">
        {USE_OPTIONS.map((o) => {
          const on = selected === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={pending}
              onClick={() => onPick(o.value)}
              className={`flex min-h-16 w-full items-center gap-3 rounded-surface border p-4 text-left shadow-card disabled:opacity-70 ${INTERACTIVE_TILE} ${
                on ? 'border-accent bg-accent-soft' : 'border-border bg-surface'
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-11 shrink-0 place-items-center rounded-control ${
                  on ? 'bg-accent text-primary-foreground' : 'bg-secondary text-primary'
                }`}
              >
                {ICONS[o.icon]()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-sm text-muted-foreground">{o.description}</span>
              </span>
              {on && (
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-accent-ink">
                  <CheckIcon />
                  {pending ? 'Guardando…' : 'Elegida'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
        >
          {error} Toca una opción para intentarlo de nuevo.
        </p>
      )}

      <div>
        <Button variant="ghost" onClick={onSkip} disabled={pending}>
          {current === null ? 'Omitir por ahora' : 'Seguir sin cambiar'}
        </Button>
      </div>
    </>
  );
}
