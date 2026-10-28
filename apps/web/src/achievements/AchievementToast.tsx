import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CompanionSprite } from '../companion/PixelCompanion';
import { PIXELS, PixelIcon } from '../components/ui/icons';
import { achievementFor, withinWindow } from './achievementModel';
import { onAchievement } from './achievementBus';

const SHOWN_MS = 4800;

/** Little squares that burst from the card once: [dx, dy, rotation, color, delay]. Decoration (and gone with "reduce motion"). */
const CONFETTI: [string, string, string, string, string][] = [
  ['-150px', '-30px', '-200deg', 'bg-warning', '0ms'],
  ['-110px', '58px', '160deg', 'bg-accent', '40ms'],
  ['-70px', '-62px', '240deg', 'bg-danger', '20ms'],
  ['-30px', '70px', '-120deg', 'bg-info', '70ms'],
  ['10px', '-72px', '180deg', 'bg-accent', '10ms'],
  ['50px', '66px', '-220deg', 'bg-warning', '50ms'],
  ['90px', '-58px', '140deg', 'bg-info', '30ms'],
  ['130px', '48px', '-160deg', 'bg-danger', '60ms'],
  ['160px', '-20px', '210deg', 'bg-accent', '0ms'],
  ['-170px', '30px', '120deg', 'bg-info', '80ms'],
  ['-20px', '-80px', '-180deg', 'bg-warning', '45ms'],
  ['120px', '78px', '200deg', 'bg-accent', '15ms'],
];

/**
 * The card itself: the companion celebrating, a gold trophy, "Logro desbloqueado" and what was done. All pictures are
 * decoration; the words are the message (and a polite status announces them).
 */
export function AchievementCard({ label, title }: { label: string; title: string }) {
  return (
    <div
      role="status"
      className="relative w-full max-w-sm overflow-visible motion-safe:animate-achievement"
    >
      <p className="sr-only">
        Logro desbloqueado: {label}. {title}
      </p>
      <div aria-hidden="true" className="relative">
        {CONFETTI.map(([dx, dy, rot, color, delay], i) => (
          <span
            key={i}
            style={{ '--dx': dx, '--dy': dy, '--rot': rot, animationDelay: delay } as CSSProperties}
            className={`pointer-events-none absolute top-1/2 left-1/2 hidden size-2 ${color} motion-safe:block motion-safe:animate-confetti`}
          />
        ))}
        <div className="relative flex items-center gap-3 overflow-hidden rounded-hero border border-warning-line/60 bg-(image:--gradient-hero) py-3 pr-4 pl-2 text-white shadow-hero ring-1 ring-white/10 ring-inset">
          <span className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:22px_22px]" />
          <CompanionSprite state="CALM" pose="joy" className="relative size-16 shrink-0" />
          <div className="relative min-w-0 flex-1">
            <p className="text-xs font-bold tracking-[0.14em] text-amber-300 uppercase">
              Logro desbloqueado
            </p>
            <p className="text-lg leading-tight font-semibold break-words">{label}</p>
            <p className="truncate text-sm text-white/80">{title}</p>
          </div>
          <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#fcd34d,#f59e0b_55%,#ea580c)] text-amber-950 shadow-[3px_3px_0_0_rgb(0_0_0/0.25),inset_0_2px_0_rgb(255_255_255/0.4)]">
            <PixelIcon rows={PIXELS.trophy} className="size-7" />
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.6),transparent)] motion-safe:animate-gloss" />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Where an achievement appears: under the top bar, centred, for a few seconds, whatever screen the student is on. It does not
 * block anything (it never takes a tap), keeps nothing, and a second one replaces the first. The label looks only at how many
 * activities were finished in the last minutes in this tab.
 */
export function AchievementToast() {
  const [current, setCurrent] = useState<{ id: number; label: string; title: string } | null>(null);
  const times = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const stop = onAchievement(({ title }) => {
      times.current = withinWindow(times.current, Date.now());
      setCurrent({ id: Date.now(), label: achievementFor(times.current.length), title });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCurrent(null), SHOWN_MS);
    });
    return () => {
      stop();
      clearTimeout(timer.current);
    };
  }, []);

  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-50 flex justify-center px-4">
      <AchievementCard key={current.id} label={current.label} title={current.title} />
    </div>
  );
}
