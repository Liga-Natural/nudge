// Loading placeholders in the exact shape of each screen, shown at once while the data arrives.
// Every one carries aria-busy="true": the opening animation waits for that to disappear.

export function SkelPage({ children, label = "Loading…" }: { children: React.ReactNode; label?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </main>
  );
}

export const SkelTitle = () => (
  <div className="flex flex-col gap-2">
    <div className="skeleton h-9 w-60" />
  </div>
);

export const SkelRow = () => (
  <div className="card flex items-center gap-3 p-3">
    <div className="skeleton h-11 w-11 flex-none !rounded-full" />
    <div className="skeleton h-10 w-10 flex-none !rounded-2xl" />
    <div className="flex flex-1 flex-col gap-2">
      <div className="skeleton h-4 w-3/4" />
      <div className="skeleton h-3 w-1/3" />
    </div>
    <div className="skeleton h-9 w-9 flex-none !rounded-full" />
  </div>
);

export const SkelRows = ({ n = 3 }: { n?: number }) => (
  <div className="flex flex-col gap-2">
    {Array.from({ length: n }, (_, i) => (
      <SkelRow key={i} />
    ))}
  </div>
);

export const SkelCard = ({ h = "h-28" }: { h?: string }) => <div className={`skeleton w-full !rounded-[22px] ${h}`} />;

/** Today: greeting, the hero card (ring + next up + strip), a section and a few rows. */
export function SkelToday() {
  return (
    <SkelPage>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-9 w-56" />
          <div className="skeleton h-4 w-44" />
        </div>
        <div className="skeleton h-11 w-11 !rounded-[14px]" />
      </div>
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-4">
          <div className="skeleton h-28 w-28 flex-none !rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-5 w-full" />
            <div className="skeleton h-4 w-24" />
          </div>
        </div>
        <div className="flex gap-3 overflow-hidden">
          <div className="skeleton h-[92px] w-[46%] flex-none !rounded-[22px]" />
          <div className="skeleton h-[92px] w-[46%] flex-none !rounded-[22px]" />
          <div className="skeleton h-[92px] w-[46%] flex-none !rounded-[22px]" />
        </div>
      </div>
      <div className="skeleton h-6 w-20" />
      <SkelRows n={3} />
    </SkelPage>
  );
}

export function SkelList({ chips = false, cards = false }: { chips?: boolean; cards?: boolean }) {
  return (
    <SkelPage>
      <SkelTitle />
      {chips && (
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-11 w-24 flex-none !rounded-full" />
          ))}
        </div>
      )}
      {cards ? (
        <div className="flex flex-col gap-3">
          <SkelCard />
          <SkelCard />
          <SkelCard />
        </div>
      ) : (
        <>
          <div className="skeleton h-6 w-28" />
          <SkelRows n={4} />
        </>
      )}
    </SkelPage>
  );
}

export function SkelUpcoming() {
  return (
    <SkelPage>
      <SkelTitle />
      <div className="skeleton h-11 w-full !rounded-full" />
      <div className="flex gap-2 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-[78px] w-14 flex-none !rounded-2xl" />
        ))}
      </div>
      <div className="skeleton h-5 w-28" />
      <SkelRows n={3} />
    </SkelPage>
  );
}

export function SkelSettings() {
  return (
    <SkelPage>
      <SkelTitle />
      <SkelCard h="h-24" />
      <SkelCard h="h-32" />
      <SkelCard h="h-40" />
      <SkelCard h="h-32" />
    </SkelPage>
  );
}

export function SkelForm() {
  return (
    <SkelPage>
      <SkelTitle />
      <div className="skeleton h-4 w-64" />
      <div className="skeleton h-[120px] w-full !rounded-2xl" />
      <div className="skeleton h-[54px] w-full !rounded-full" />
    </SkelPage>
  );
}

export function SkelItem() {
  return (
    <SkelPage>
      <div className="skeleton h-11 w-24 !rounded-full" />
      <div className="card flex flex-col gap-3 p-5">
        <div className="flex items-center gap-3">
          <div className="skeleton h-12 w-12 !rounded-2xl" />
          <div className="skeleton h-7 w-48" />
        </div>
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-4 w-56" />
      </div>
      <div className="skeleton h-[54px] w-full !rounded-full" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-11 !rounded-full" />
        <div className="skeleton h-11 !rounded-full" />
      </div>
    </SkelPage>
  );
}

export function SkelPayments() {
  return (
    <SkelPage>
      <SkelTitle />
      <div className="card grid grid-cols-2 gap-3 p-4">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-8 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-8 w-24" />
        </div>
      </div>
      <div className="skeleton h-6 w-32" />
      <SkelRows n={3} />
    </SkelPage>
  );
}
