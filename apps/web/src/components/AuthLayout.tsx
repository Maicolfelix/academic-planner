import { useState, type FocusEvent, type ReactNode } from 'react';
import { CompanionSprite } from '../companion/PixelCompanion';
import type { CompanionPose } from '../companion/pixelArt';
import { PixelSky } from './auth/PixelSky';
import { Card } from './ui/Card';

/** What the form is doing, so the companion can act it out. */
export type AuthMood = 'idle' | 'pending' | 'error' | 'success';

/**
 * The frame of the sign-in and sign-up screens: the product's night sky with its companion on one side (above on a phone) and the
 * form on the other. The companion is the face of the app and it LISTENS to the form: it greets you, covers its eyes while a
 * password is typed ("No miro, lo prometo."), worries with an error and rejoices when you get in. All of that is decoration:
 * hidden from assistive technology, never the only place a message lives (errors and notices stay in the form, as text), and
 * with "reduce motion" the picture is still.
 */
export function AuthLayout({
  title,
  intro,
  mood = 'idle',
  children,
}: {
  title: string;
  /** What the companion says when nothing is happening. */
  intro: string;
  mood?: AuthMood;
  children: ReactNode;
}) {
  const [onPassword, setOnPassword] = useState(false);

  const pose: CompanionPose | undefined =
    mood === 'success'
      ? 'joy'
      : mood === 'error'
        ? 'worried'
        : onPassword && mood === 'idle'
          ? 'cover'
          : undefined;
  const line =
    mood === 'success'
      ? '¡Listo! Pasa.'
      : mood === 'error'
        ? 'Tranquilo, lo revisamos juntos.'
        : mood === 'pending'
          ? 'Un momentito…'
          : onPassword
            ? 'No miro, lo prometo.'
            : intro;

  const watchFocus = (e: FocusEvent<HTMLElement>) =>
    setOnPassword(e.target instanceof HTMLInputElement && e.target.type === 'password');

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-background lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative flex min-h-[17rem] flex-col overflow-hidden bg-(image:--gradient-hero) px-6 pt-6 text-white lg:min-h-screen lg:px-12 lg:pt-10">
        <PixelSky />
        <div className="relative z-10 flex flex-col gap-1 lg:gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-7">
              <rect width="24" height="24" rx="6" className="fill-white" />
              <path
                d="m7.5 12.5 3 3 6-7"
                fill="none"
                className="stroke-primary"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Academic Planner
          </p>
          <p className="max-w-md text-xl font-semibold text-balance sm:text-2xl lg:mt-6 lg:text-4xl lg:leading-tight">
            Aquí vive tu semestre.
          </p>
          <p className="hidden max-w-md text-white/85 lg:block">
            Horarios, entregas y notas en un solo lugar, a tu ritmo.
          </p>
        </div>
        <div className="relative z-10 mt-auto flex flex-col items-center pt-2">
          {/* What it says is flavor, not information: the form carries every message. */}
          <p
            aria-hidden="true"
            key={line}
            className="relative mb-3 max-w-[16rem] rounded-2xl motion-safe:animate-companion-bubble bg-surface px-4 py-2 text-center text-sm font-medium text-foreground shadow-floating after:absolute after:top-full after:left-1/2 after:size-3 after:-translate-x-1/2 after:-translate-y-1.5 after:rotate-45 after:bg-surface"
          >
            {line}
          </p>
          <div key={pose ?? 'plain'} className="-mb-1">
            <CompanionSprite
              state="CALM"
              pose={pose}
              walking={mood === 'pending'}
              className="size-28 lg:size-52"
            />
          </div>
        </div>
        {/* the ground it stands on: a pixel path */}
        <div
          aria-hidden="true"
          className="relative z-10 -mx-6 h-6 border-t-2 border-white/30 bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.16)_0_12px,rgb(255_255_255/0.07)_12px_24px)] lg:-mx-12 lg:h-10"
        />
      </section>

      <section
        onFocusCapture={watchFocus}
        onBlurCapture={() => setOnPassword(false)}
        className="relative flex items-center justify-center px-6 py-8 lg:px-12"
      >
        <div className="flex w-full max-w-sm flex-col gap-5">
          <h1 className="text-display animate-settle break-words">{title}</h1>
          <Card
            variant="solid"
            className="flex animate-settle flex-col gap-4 p-5 shadow-floating [animation-delay:60ms]"
          >
            {children}
          </Card>
        </div>
      </section>
    </main>
  );
}
