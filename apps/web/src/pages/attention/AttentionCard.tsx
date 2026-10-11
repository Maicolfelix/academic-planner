import { QueryError } from '../../components/QueryError';
import { RADAR_LABELS, formatDue, radarExplanation, type RadarStatus } from '@planner/core';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useAttention } from '../../attention/useAttention';
import { Card } from '../../components/ui/Card';
import { PriorityBadge, StatusBadge } from '../activities/badges';
import { RadarDot } from '../radar/RadarDot';

/** Calm, neutral wording: it orients, the student decides. No alarm, no blame, no orders. */
const INTRO: Record<RadarStatus, string> = {
  OVERDUE: 'Tienes actividades vencidas. Esta es la que actualmente requiere mayor atención.',
  IMMEDIATE: 'Próxima entrega.',
  UPCOMING: 'Próxima entrega.',
  PLANNABLE: 'Próxima entrega.',
  UNDER_CONTROL: 'Todo está bajo control. Si quieres avanzar, podrías continuar con:',
};

/** A faint light of the state's own hue in a corner of the hero: danger, info, warning or success, never loud. */
const HALO: Record<RadarStatus, string> = {
  OVERDUE: '[--halo:rgb(253_162_155/0.42)]',
  IMMEDIATE: '[--halo:rgb(253_162_155/0.42)]',
  UPCOMING: '[--halo:rgb(132_202_255/0.36)]',
  PLANNABLE: '[--halo:rgb(254_200_75/0.32)]',
  UNDER_CONTROL: '[--halo:rgb(117_224_167/0.36)]',
};

/** Only the two states that ask for action get the one-time ripple on their mark. */
const NEEDS_ACTION: RadarStatus[] = ['OVERDUE', 'IMMEDIATE'];

/** The hero reflects the state: pressing ones keep the deep indigo, planning and under-control ones drift toward teal. */
const SURFACE = (status: RadarStatus) =>
  NEEDS_ACTION.includes(status) || status === 'UPCOMING'
    ? 'bg-(image:--gradient-hero)'
    : 'bg-(image:--gradient-hero-calm)';

// Entrance: the card settles, then its parts follow a few milliseconds apart. One-shot; nothing loops.
const STAGE = [
  '[animation-delay:60ms]',
  '[animation-delay:110ms]',
  '[animation-delay:150ms]',
  '[animation-delay:190ms]',
  '[animation-delay:260ms]',
] as const;

type Item = NonNullable<ReturnType<typeof useAttention>['data']>['recommendation'] & object;

/**
 * "¿Qué hago ahora?": the next activities by deadline (at most five, the API's `upcoming`), one hero each, in a strip
 * that snaps: swipe on a phone, dots anywhere. The internal score is never shown. With a single activity it is just
 * the hero (no dots). Falls back to the engine's recommendation when only forgotten overdue ones remain.
 */
export function AttentionCard({ timeZone, now }: { timeZone: string; now: Date }) {
  const attention = useAttention();
  const data = attention.data;
  const items: Item[] = data?.upcoming.length
    ? data.upcoming
    : data?.recommendation
      ? [data.recommendation]
      : [];

  return (
    <section aria-labelledby="attention-title" className="flex flex-col gap-2">
      <h2 id="attention-title" className="text-section-title">
        ¿Qué hago ahora?
      </h2>

      {attention.isPending && <p role="status">Buscando qué actividad requiere atención…</p>}

      <QueryError query={attention} title="No se pudo cargar la sugerencia" />

      {data && items.length === 0 && (
        <Card variant="dashed" className="p-4">
          No tienes actividades pendientes en este momento.
        </Card>
      )}

      {items.length > 0 && <HeroCarousel items={items} timeZone={timeZone} now={now} />}
    </section>
  );
}

/** A slide counts as the one on screen when this much of it is inside the strip. */
const VISIBLE_RATIO = 0.6;

/** The scroll position that centres `slide` in `strip`, from where the slide really is (its width, gaps and padding included). */
function scrollTargetOf(strip: HTMLElement, slide: HTMLElement): number {
  const centred = slide.offsetLeft - (strip.clientWidth - slide.offsetWidth) / 2;
  return Math.min(Math.max(0, centred), Math.max(0, strip.scrollWidth - strip.clientWidth));
}

/**
 * ONE source of truth: `activeId`, the INTENT (which activity the student is looking at, by id so it survives a reorder).
 * The scroll position is only its projection:
 *  - a dot, a key or a data change calls `goTo`, which sets the intent and scrolls the strip there. Each call replaces the
 *    previous one (`pending` holds the latest only), so a late event of an older navigation can never overwrite it;
 *  - a swipe is the one thing that moves the strip without `goTo`: when a slide becomes the one on screen while the student
 *    has the strip in hand (touch, pointer or wheel since the last `goTo`), it becomes the intent. If the strip moves with
 *    nobody holding it (the browser finishing an old fling), the intent stands and the strip is put back.
 * "Which slide is on screen" comes from an IntersectionObserver (where the slides really are), never from dividing
 * `scrollLeft` by a width the CSS may not match. If the active activity disappears (completed, deleted) the first one is
 * shown; a resize puts the strip back on the active one.
 */
function HeroCarousel({ items, timeZone, now }: { items: Item[]; timeZone: string; now: Date }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const pending = useRef<{ index: number } | null>(null);
  /** The student has their finger/wheel on the strip since the last `goTo`: a slide that settles is theirs to choose. */
  const held = useRef(false);
  const latest = useRef({ items, active: 0 });
  const active = Math.max(
    0,
    items.findIndex((i) => i.activity.id === activeId),
  );
  const order = items.map((i) => i.activity.id).join();

  useEffect(() => {
    latest.current = { items, active };
  });

  const slides = () =>
    strip.current ? [...strip.current.querySelectorAll<HTMLElement>('[data-slide]')] : [];

  /** Scroll the strip to slide `index`. Does nothing if it is already there (so nothing is left "on its way"). */
  const scrollToSlide = (index: number, behavior: ScrollBehavior) => {
    const el = strip.current;
    const slide = slides()[index];
    if (!el || !slide) return;
    const left = scrollTargetOf(el, slide);
    if (Math.abs(el.scrollLeft - left) <= 1) {
      pending.current = null;
      return;
    }
    pending.current = behavior === 'smooth' ? { index } : null;
    el.scrollTo({ left, behavior });
  };

  const goTo = (wanted: number) => {
    const index = Math.min(Math.max(0, wanted), items.length - 1);
    held.current = false;
    setActiveId(items[index]!.activity.id);
    scrollToSlide(
      index,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    );
  };

  // The data changed under the strip (finished, deleted, a nearer one, a moved deadline): show the active one again.
  useEffect(() => {
    scrollToSlide(latest.current.active, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of order/length realigns
  }, [order]);

  // The width changed (rotation, resize, even in the middle of an animation): same activity, new position.
  useEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      scrollToSlide(latest.current.active, 'auto');
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollToSlide only reads refs
  }, []);

  // Which slide is on screen: the one most inside the strip, once it is mostly inside.
  useEffect(() => {
    const el = strip.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const targets = slides();
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(e.target, e.intersectionRatio);
        let best = -1;
        let bestRatio = 0;
        targets.forEach((t, i) => {
          const r = ratios.get(t) ?? 0;
          if (r > bestRatio) {
            best = i;
            bestRatio = r;
          }
        });
        if (best < 0 || bestRatio < VISIBLE_RATIO) return;
        const wanted = pending.current;
        if (wanted !== null) {
          if (wanted.index === best) pending.current = null; // arrived
          return; // on its way: the intent is already set, whatever passes by on the road
        }
        const { items: current, active: now } = latest.current;
        const seen = current[best]?.activity.id;
        if (seen === undefined || best === now) return;
        // A swipe settled on another slide: theirs. If nobody touched the strip, the browser moved it by itself (a fling
        // that was still snapping when a dot was pressed): the intent stands and the strip goes back to it.
        if (held.current) setActiveId(seen);
        else scrollToSlide(now, 'auto');
      },
      { root: el, threshold: [0, 0.25, 0.5, VISIBLE_RATIO, 0.75, 1] },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollToSlide only reads refs; only a new order re-observes
  }, [order]);

  const onDotKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(active + 1, last)
        : e.key === 'ArrowLeft'
          ? Math.max(active - 1, 0)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    goTo(next);
    e.currentTarget.querySelectorAll('button')[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={strip}
        // The student takes the strip in hand: whatever navigation was on its way is theirs now.
        onPointerDown={() => {
          pending.current = null;
          held.current = true;
        }}
        onWheel={() => {
          pending.current = null;
          held.current = true;
        }}
        role="group"
        aria-roledescription="carrusel"
        aria-label="Próximas actividades"
        className="relative -mx-1 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <div
            key={item.activity.id}
            data-slide=""
            role="group"
            aria-roledescription="actividad"
            aria-label={`${i + 1} de ${items.length}`}
            inert={i !== active}
            className="w-full shrink-0 snap-center snap-always px-0.5"
          >
            <Suggestion item={item} timeZone={timeZone} now={now} />
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <div
          role="group"
          aria-label="Elegir actividad"
          onKeyDown={onDotKey}
          className="flex justify-center"
        >
          {items.map((item, i) => (
            <button
              key={item.activity.id}
              type="button"
              aria-label={`Ver actividad ${i + 1} de ${items.length}`}
              aria-current={i === active}
              onClick={() => goTo(i)}
              className="group inline-flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary"
            >
              <span
                aria-hidden="true"
                className={`block rounded-full transition-[width,background-color] duration-(--duration-fast) ease-standard ${
                  i === active
                    ? 'h-2 w-6 bg-primary'
                    : 'size-2 bg-primary/30 group-hover:bg-primary/60'
                }`}
              />
            </button>
          ))}
        </div>
      )}
      <p role="status" className="sr-only">
        {items.length > 1
          ? `Actividad ${active + 1} de ${items.length}: ${items[active]?.activity.title}`
          : ''}
      </p>
    </div>
  );
}

export function Suggestion({ item, timeZone, now }: { item: Item; timeZone: string; now: Date }) {
  const { activity, radarStatus, reasons } = item;
  return (
    <article
      aria-labelledby={`attention-activity-${activity.id}`}
      className={`${HALO[radarStatus]} ${SURFACE(radarStatus)} relative isolate flex animate-rise flex-col gap-4 overflow-hidden rounded-hero p-5 text-primary-foreground shadow-hero ring-1 ring-white/10 ring-inset lg:p-7`}
    >
      {/* Decoration, all of it hidden from assistive tech and unable to catch a tap, behind the text: an orb of the
          state's own light that drifts very slowly, a soft grid that fades away from it, and a thin ring. The orb is
          stronger when the state asks for action and calmer when it does not. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -top-24 -right-20 -z-10 size-72 rounded-full bg-[radial-gradient(closest-side,var(--halo),transparent)] motion-safe:animate-drift ${
          NEEDS_ACTION.includes(radarStatus) ? '' : 'opacity-70'
        }`}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.09] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:28px_28px] [-webkit-mask-image:radial-gradient(70%_90%_at_88%_12%,black,transparent)] [mask-image:radial-gradient(70%_90%_at_88%_12%,black,transparent)]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -left-12 -z-10 size-48 rounded-full border border-white/10"
      />

      <div className={`flex animate-rise flex-wrap items-center gap-1.5 ${STAGE[0]}`}>
        {/* The state is a word with a mark, never a color on its own. */}
        <span className="mr-1 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium">
          <RadarDot status={radarStatus} beacon={NEEDS_ACTION.includes(radarStatus)} ambient={0} />
          {RADAR_LABELS[radarStatus]}
        </span>
        <PriorityBadge priority={activity.priority} />
        <StatusBadge status={activity.status} />
      </div>

      <div className={`min-w-0 animate-rise ${STAGE[1]}`}>
        <p
          id={`attention-activity-${activity.id}`}
          className="text-2xl leading-tight font-semibold break-words"
        >
          {activity.title}
        </p>
        <p className="mt-0.5 text-primary-foreground/80 break-words">
          {activity.subject?.name ?? 'Sin asignatura'}
        </p>
      </div>

      <p className={`animate-rise text-lg ${STAGE[2]}`}>
        {formatDue(activity, timeZone)}
        <span aria-hidden="true"> · </span>
        <span className="font-semibold">{radarExplanation(activity, now, timeZone)}</span>
      </p>

      <div
        className={`flex animate-rise flex-col gap-2 text-sm text-primary-foreground/85 ${STAGE[3]}`}
      >
        <p>{INTRO[radarStatus]}</p>
        <div>
          <p id={`attention-why-${activity.id}`} className="font-semibold text-primary-foreground">
            ¿Por qué esta?
          </p>
          <ul aria-labelledby={`attention-why-${activity.id}`} className="mt-1 list-disc pl-5">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* A white button on the deep surface; its focus ring is white too, the page's dark ring would vanish here. */}
      <div>
        <Link
          to={`/activities?edit=${activity.id}`}
          aria-label={`Ver actividad: ${activity.title}`}
          className={`group inline-flex min-h-11 animate-rise items-center gap-2 rounded-control bg-white px-4 py-2 text-sm font-semibold text-primary shadow-lift transition-[transform,background-color] duration-(--duration-fast) ease-standard hover:bg-accent-soft focus-visible:outline-white active:scale-[0.97] ${STAGE[4]}`}
        >
          Ver actividad
          <span
            aria-hidden="true"
            className="transition-transform duration-(--duration-fast) ease-spring group-hover:translate-x-0.5 group-active:translate-x-1"
          >
            →
          </span>
        </Link>
      </div>
    </article>
  );
}
