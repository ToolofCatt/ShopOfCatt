export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8" aria-busy="true">
      <div className="flex items-baseline justify-between">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-neutral-100" />
        <div className="h-4 w-24 animate-pulse rounded bg-neutral-100" />
      </div>

      <div className="mt-4 h-11 w-full animate-pulse rounded-lg bg-neutral-100" />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="h-10 w-full animate-pulse rounded-lg bg-neutral-100 sm:max-w-xs" />
        <div className="flex gap-2">
          <div className="h-9 w-20 animate-pulse rounded-full bg-neutral-100" />
          <div className="h-9 w-24 animate-pulse rounded-full bg-neutral-100" />
          <div className="h-9 w-24 animate-pulse rounded-full bg-neutral-100" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="aspect-[4/3] animate-pulse rounded-lg bg-neutral-100" />
            <div className="mt-3 h-3 w-16 animate-pulse rounded bg-neutral-100" />
            <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-neutral-100" />
            <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-neutral-100" />
            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
              <div className="h-5 w-20 animate-pulse rounded bg-neutral-100" />
              <div className="h-5 w-14 animate-pulse rounded-full bg-neutral-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
