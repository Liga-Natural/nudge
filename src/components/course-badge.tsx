/** A class's coloured square with its emoji in it (replaces the blank white squares). Decorative: the name sits beside it. */
export function CourseBadge({ emoji, color, size = 40 }: { emoji: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center rounded-2xl border border-line leading-none"
      style={{ background: color, width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {emoji}
    </span>
  );
}
