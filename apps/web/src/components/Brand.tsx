/**
 * The product's mark and name. The mark is the app's own picture: a deep indigo tile, a check drawn in whole squares (the
 * hand of the companion) and two teal pixels that fly off the corner like a spark. The name is set in two weights, a light
 * "Academic" and a heavy "Planner", closed by the two pixels stepping down that mark every section of the app. A literal
 * space sits between the words so the name reads, and is found, as "Academic Planner". The mark hops once when the pointer
 * (or the keyboard focus) reaches the lockup; the pictures are decoration.
 */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width="24" height="24" rx="6" className="fill-primary" />
      <rect width="24" height="12" rx="6" className="fill-white/10" />
      {/* The check, in squares of 2: a short stroke down and a long one up. */}
      <path
        className="fill-primary-foreground"
        d="M4 13h2v2H4zM6 15h2v2H6zM8 17h2v2H8zM10 15h2v2h-2zM12 13h2v2h-2zM14 11h2v2h-2zM16 9h2v2h-2zM18 7h2v2h-2z"
      />
      <path className="fill-accent" d="M13 4h2v2h-2zM17 2h2v2h-2z" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="group/brand flex items-center gap-2.5 py-2">
      <span className="transition-transform duration-(--duration-normal) ease-spring group-hover/brand:-translate-y-0.5 group-hover/brand:-rotate-6">
        <BrandMark />
      </span>
      <span className="flex items-baseline gap-1 text-[1.0625rem] leading-none tracking-tight">
        <span className="font-normal text-muted-foreground">Academic</span>{' '}
        <span className="font-extrabold text-primary">Planner</span>
        <span
          aria-hidden="true"
          className="ml-0.5 size-[5px] self-center bg-accent shadow-[5px_5px_0_0_var(--primary)]"
        />
      </span>
    </span>
  );
}
