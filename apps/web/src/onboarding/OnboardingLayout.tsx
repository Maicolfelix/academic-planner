import { forwardRef, type ReactNode } from 'react';
import { BrandMark } from '../components/ui/icons';

export type ProgressStep = 'USE' | 'PERIOD';

const STEPS: { id: ProgressStep; label: string }[] = [
  { id: 'USE', label: 'Perfil' },
  { id: 'PERIOD', label: 'Periodo' },
];

/**
 * The frame of the onboarding: the ambient light of the app, the brand, a quiet two-word progress (only the steps that
 * exist: it never promises more), the heading and the step. One `h1` per screen; it takes the focus when the step changes
 * so a screen reader announces where the student is.
 */
export const OnboardingLayout = forwardRef<
  HTMLHeadingElement,
  { step: ProgressStep; title: string; intro?: string; children: ReactNode; footer?: ReactNode }
>(function OnboardingLayout({ step, title, intro, children, footer }, headingRef) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem]"
      >
        <span className="ambient-orb ambient-orb-a" />
        <span className="ambient-orb ambient-orb-b" />
        <span className="ambient-orb ambient-orb-c" />
      </div>
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
        <header className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandMark />
            Academic Planner
          </span>
          <ol aria-label="Pasos" className="flex items-center gap-1.5 text-xs font-medium">
            {STEPS.map((s) => (
              <li
                key={s.id}
                aria-current={s.id === step ? 'step' : undefined}
                className={`rounded-full border px-2.5 py-1 ${
                  s.id === step
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-border bg-surface/70 text-muted-foreground'
                }`}
              >
                {s.label}
              </li>
            ))}
          </ol>
        </header>

        <div className="flex flex-col gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
          >
            {title}
          </h1>
          {intro && <p className="text-muted-foreground">{intro}</p>}
        </div>

        {children}

        {footer && <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">{footer}</div>}
      </main>
    </div>
  );
});
