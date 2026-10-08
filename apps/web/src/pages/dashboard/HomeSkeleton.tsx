/**
 * What the Home looks like while its data loads: the shape of what is coming (greeting, hero, counters, a card) as
 * soft blocks that breathe. The ONLY looping animation of the app, and it ends the moment the data arrives; with
 * reduced motion the blocks are still. Assistive technology hears the same short status as before.
 */
export function HomeSkeleton() {
  const block = 'animate-breathe bg-secondary';
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Cargando tu panel…</span>
      <div aria-hidden="true" className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className={`h-9 w-3/4 rounded-control ${block}`} />
          <div className={`h-4 w-1/2 rounded-control ${block}`} />
        </div>
        <div className={`h-60 rounded-hero ${block}`} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-11 rounded-surface ${block}`} />
          ))}
        </div>
        <div className={`h-32 rounded-surface ${block}`} />
      </div>
    </div>
  );
}
