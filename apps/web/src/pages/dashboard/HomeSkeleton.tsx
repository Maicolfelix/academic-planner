/**
 * What the Home looks like while its data loads: the shape of what is coming (greeting, hero, counters, a card), in two
 * columns from 1024 px like the real thing, as soft blocks that breathe. The ONLY looping animation tied to data
 * loading, and it ends the moment the data arrives; with reduced motion the blocks are still. Assistive technology
 * hears the same short status as before.
 */
export function HomeSkeleton() {
  const block = 'animate-breathe bg-secondary';
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Cargando tu panel…</span>
      <div aria-hidden="true" className="flex flex-col gap-5 lg:gap-7">
        <div className="flex flex-col gap-2">
          <div className={`h-9 w-3/4 rounded-control lg:h-12 lg:w-1/2 ${block}`} />
          <div className={`h-4 w-1/2 rounded-control lg:w-1/3 ${block}`} />
        </div>
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(19rem,25rem)] lg:gap-x-8">
          <div className={`h-60 rounded-hero lg:h-80 ${block}`} />
          <div className="flex flex-col gap-5">
            <div className={`h-40 rounded-surface ${block}`} />
            <div className={`h-32 rounded-surface ${block}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
