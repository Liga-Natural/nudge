// Shown at once while a screen's data is on its way: a greeting-sized bar and a few card-shaped rows.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-9 w-56" />
        <div className="skeleton h-4 w-44" />
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[68px] w-full" />
        ))}
      </div>
    </main>
  );
}
