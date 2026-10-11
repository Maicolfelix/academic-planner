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

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

/**
 * The active slide is state (by id, so it survives a reorder), and the strip follows it: a swipe updates the state, a
 * dot sets it and the strip scrolls to it. If the active activity disappears (completed, deleted) the first one is shown.
 */
function HeroCarousel({ items, timeZone, now }: { items: Item[]; timeZone: string; now: Date }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const smooth = useRef(false); // the next scroll comes from a dot: animate it
  const settling = useRef<number | null>(null); // a programmatic scroll is on its way to this index
  const active = Math.max(
    0,
    items.findIndex((i) => i.activity.id === activeId),
  );
  const order = items.map((i) => i.activity.id).join();

  // Bring the strip to the active slide whenever the state, or the order, says it is elsewhere.
  useEffect(() => {
    const el = strip.current;
    if (!el || el.clientWidth === 0) return;
    if (Math.round(el.scrollLeft / el.clientWidth) === active) return;
    const animate = smooth.current && !prefersReducedMotion();
    smooth.current = false;
    settling.current = animate ? active : null;
    el.scrollTo({ left: active * el.clientWidth, behavior: animate ? 'smooth' : 'auto' });
  }, [active, order]);

  const onScroll = () => {
    const el = strip.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (settling.current !== null) {
      if (index === settling.current) settling.current = null;
      return;
    }
    const id = items[index]?.activity.id;
    if (id && id !== items[active]?.activity.id) setActiveId(id);
  };

  const pick = (index: number) => {
    smooth.current = true;
    setActiveId(items[index]!.activity.id);
  };

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
    pick(next);
    e.currentTarget.querySelectorAll('button')[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={strip}
        onScroll={onScroll}
        onPointerDown={() => (settling.current = null)}
        role="group"
        aria-roledescription="carrusel"
        aria-label="Próximas actividades"
        className="-mx-1 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <div
            key={item.activity.id}
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
              onClick={() => pick(i)}
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
