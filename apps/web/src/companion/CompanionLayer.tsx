import { useQueryClient } from '@tanstack/react-query';
import { toLocalParts, type Dashboard } from '@planner/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useMe } from '../auth/useAuth';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
import { onCompanion } from './companionBus';
import { useCompanionHidden, writeCompanionHidden } from './companionPrefs';
import { CompanionSprite } from './PixelCompanion';
import { companionFromDashboard, deriveCompanionState } from './companionState';
import { completedLine, greetingLine, nextStop, touchLine, walkSeconds } from './roam';

/**
 * The roaming companion (C2): the same character as the Home card, living on a lane just above the bottom bar (or in the bottom
 * corner on a wide screen). It says hello once per visit, walks to another spot every so often, notices when an activity is
 * finished and answers when it is touched. It is a quiet presence, never a task:
 *  - it never covers a control by design: only the character itself catches taps, and it leaves while the student types or a
 *    dialog is open, and while the Home (which has its own card) is on screen;
 *  - with "reduce motion" it stays where it is (it never walks) and everything it says is text;
 *  - the student can hide it ("Ocultar") and bring it back from the Home; that choice is a per-device convenience.
 * It keeps no data: the moment comes from what the Home already loaded, and the clock from the student's own time zone.
 */
const SPRITE = 56; // px: a comfortable touch target
const GREETED = 'planner.companion.greeted';
const BUBBLE_MS = 5000;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CompanionLayer() {
  const { pathname } = useLocation();
  const hidden = useCompanionHidden();
  const user = useMe().data;
  const queryClient = useQueryClient();
  const lane = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [laneWidth, setLaneWidth] = useState(0);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [walking, setWalking] = useState(false);
  const [duration, setDuration] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [round, setRound] = useState(0); // restarts the hop and the wave
  const [taps, setTaps] = useState(0);
  const [typing, setTyping] = useState(false);
  const [dialog, setDialog] = useState(false);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const xRef = useRef(0);

  const onHome = pathname.startsWith('/dashboard');
  const shown = !hidden && !onHome && !typing && !dialog;

  const say = useCallback((text: string) => {
    setBubble(text);
    setRound((r) => r + 1);
    clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), BUBBLE_MS);
  }, []);

  // The moment comes from what the Home already loaded: no request of its own.
  const dashboard = queryClient.getQueryData<Dashboard>(DASHBOARD_KEY);
  const moment = dashboard ? companionFromDashboard(dashboard) : null;

  // The lane starts at the right end, where a thumb is not.
  useEffect(() => {
    const width = lane.current?.clientWidth ?? 0;
    setLaneWidth(width);
    const start = Math.max(0, width - SPRITE);
    xRef.current = start;
    setX(start);
  }, [shown]);

  // Typing or a dialog: it steps out of the way.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.matches('input, textarea, select, [contenteditable="true"]');
    const onIn = (e: FocusEvent) => {
      if (!isField(e.target)) return;
      clearTimeout(timer);
      setTyping(true);
    };
    const onOut = (e: FocusEvent) => {
      if (!isField(e.target)) return;
      timer = setTimeout(() => setTyping(false), 800);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    let frame = 0;
    const look = () => {
      frame = 0;
      setDialog(document.querySelector('[role="dialog"], dialog[open]') !== null);
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(look);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    look();
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      observer.disconnect();
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Says hello once per visit (per tab session), in the student's own time of day.
  useEffect(() => {
    if (!shown || !user) return;
    try {
      if (sessionStorage.getItem(GREETED)) return;
    } catch {
      /* no storage: it may greet again, which is harmless */
    }
    // A beat after the page settles, so the greeting does not compete with it.
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(GREETED, '1');
      } catch {
        /* see above */
      }
      say(greetingLine(Number(toLocalParts(new Date(), user.timezone).time.slice(0, 2))));
    }, 700);
    return () => clearTimeout(timer);
  }, [shown, user, say]);

  // Notices a finished activity.
  useEffect(
    () =>
      onCompanion((event) => {
        if (event === 'completed' && shown) say(completedLine(taps));
      }),
    [shown, taps, say],
  );

  // Walks to another spot every so often (never with reduced motion).
  useEffect(() => {
    if (!shown || reducedMotion()) return;
    let walkTimer: ReturnType<typeof setTimeout> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      walkTimer = setTimeout(
        () => {
          const max = Math.max(0, (lane.current?.clientWidth ?? 0) - SPRITE);
          const target = nextStop(xRef.current, max, Math.random());
          const seconds = walkSeconds(target - xRef.current);
          setFacing(target >= xRef.current ? 1 : -1);
          setDuration(seconds);
          setWalking(true);
          setX(target);
          xRef.current = target;
          stopTimer = setTimeout(() => {
            setWalking(false);
            schedule();
          }, seconds * 1000);
        },
        14000 + Math.random() * 14000,
      );
    };
    schedule();
    return () => {
      clearTimeout(walkTimer);
      clearTimeout(stopTimer);
    };
  }, [shown]);

  useEffect(() => () => clearTimeout(bubbleTimer.current), []);

  if (!shown) return null;

  const state = moment ? deriveCompanionState(moment) : 'CALM';
  const nearRight = x > laneWidth / 2;

  return (
    <div
      ref={lane}
      data-companion-layer
      className="pointer-events-none fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 h-14 lg:inset-x-6 lg:bottom-4"
    >
      <div
        className="absolute bottom-0 left-0 motion-safe:transition-transform motion-safe:ease-linear"
        style={{
          transform: `translateX(${x}px)`,
          transitionDuration: walking ? `${duration}s` : '0s',
        }}
      >
        {bubble && (
          <div
            role="status"
            className={`pointer-events-auto absolute bottom-full mb-1 w-max max-w-[min(15rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-card motion-safe:animate-companion-bubble ${
              nearRight ? 'right-0' : 'left-0'
            }`}
          >
            <p className="break-words">{bubble}</p>
            <button
              type="button"
              onClick={() => {
                writeCompanionHidden(true);
                setBubble(null);
              }}
              className="mt-1 min-h-11 rounded-md px-1 text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Ocultar compañero
            </button>
          </div>
        )}
        <button
          type="button"
          aria-label="Tu compañero. Tócalo para saludar"
          onClick={() => {
            setTaps((n) => n + 1);
            say(touchLine(taps, moment?.overdueCount ?? 0));
          }}
          className="pointer-events-auto grid size-14 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <div key={round} className={facing === -1 ? '-scale-x-100' : ''}>
            <CompanionSprite state={state} walking={walking} className="size-12" />
          </div>
        </button>
      </div>
    </div>
  );
}
