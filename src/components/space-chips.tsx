import Link from "next/link";
import type { Space } from "@/lib/types";

// The filter row at the top of Today / Upcoming (Full mode).
export function SpaceChips({
  spaces,
  current,
  base,
  allLabel,
  personalLabel,
  label,
}: {
  spaces: Space[];
  current: string | null;
  base: string;
  allLabel: string;
  personalLabel: string;
  label?: string;
}) {
  if (spaces.length < 2) return null;
  const chip = (on: boolean) =>
    `inline-flex min-h-[44px] flex-none items-center rounded-full border px-4 text-sm font-semibold ${
      on ? "border-accent bg-accent-soft text-ink" : "border-line bg-white text-ink"
    }`;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={label ?? allLabel}>
      <Link href={base} className={chip(!current)} aria-current={!current ? "true" : undefined}>
        {allLabel}
      </Link>
      {spaces.map((s) => (
        <Link
          key={s.id}
          href={`${base}${base.includes("?") ? "&" : "?"}space=${s.id}`}
          className={chip(current === s.id)}
          aria-current={current === s.id ? "true" : undefined}
        >
          <span aria-hidden className="mr-1">
            {s.emoji}
          </span>
          {s.is_default && s.name === "Personal" ? personalLabel : s.name}
        </Link>
      ))}
    </div>
  );
}
