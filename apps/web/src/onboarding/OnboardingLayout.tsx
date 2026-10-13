import type { PrimaryUse } from '@planner/core';
import { forwardRef, type ReactNode } from 'react';
import { BrandMark } from '../components/ui/icons';
import { progressSteps, STEP_LABEL } from './onboardingModel';

export type ProgressStep = keyof typeof STEP_LABEL;

/**
 * The frame of the onboarding: the ambient light of the app, the brand, a quiet progress (small marks for the steps that
 * exist for THIS student and the name of the current one; never "1 of 7"), the heading and the step. One `h1` per screen; it
 * takes the focus when the step changes so a screen reader announces where the student is.
 */
export const OnboardingLayout = forwardRef<
  HTMLHeadingElement,
  {
    step: ProgressStep;
    primaryUse: PrimaryUse | null;
    title: string;
    intro?: string;
    children: ReactNode;
    footer?: ReactNode;
  }
>(function OnboardingLayout({ step, primaryUse, title, intro, children, footer }, headingRef) {
  const steps = progressSteps(primaryUse);
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
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 px-4 py-6 sm:py-12">
        <header className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandMark />
            Academic Planner
          </span>
          <ol aria-label="Pasos" className="flex items-center gap-1.5 text-xs font-medium">
            {steps.map((s) =>
              s === step ? (
                <li
                  key={s}
                  aria-current="step"
                  className="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-accent-ink"
                >
                  {STEP_LABEL[s]}
                </li>
              ) : (
                <li key={s}>
                  <span className="sr-only">{STEP_LABEL[s]}</span>
                  <span aria-hidden="true" className="block size-2 rounded-full bg-border-strong" />
                </li>
              ),
            )}
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
