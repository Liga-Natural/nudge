"use client";

/** The pill every chip row uses: a 44px-tall toggle that lights up in the accent colour. */
export function Chip({
  on,
  onClick,
  children,
  color,
  label,
  className = "",
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** A class chip carries the class colour. */
  color?: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      style={color ? { background: color, color: "#1c1917" } : undefined}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 px-4 text-sm font-semibold ${color ? "" : "text-ink"} ${
        on ? "border-accent" + (color ? "" : " bg-accent-soft") : "border-line" + (color ? "" : " bg-card")
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function ChipRow({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      {label && <legend className="mb-1.5 text-sm font-semibold text-muted">{label}</legend>}
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}
