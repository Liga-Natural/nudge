/** The Nudge mark: the gradient tile with the white ring and dot (same drawing as the app icon and launch images). */
export function NudgeMark({ size = 40, className = "", id = "nm" }: { size?: number; className?: string; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8c28" />
          <stop offset="1" stopColor="#e5484d" />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <rect x="0" y="0" width="100" height="58" />
        </clipPath>
      </defs>
      <rect width="100" height="100" rx="28" fill={`url(#${id}-g)`} />
      <circle cx="50" cy="50" r="21.5" fill="none" stroke="#fff" strokeWidth="9" clipPath={`url(#${id}-c)`} />
      <circle cx="50" cy="70" r="8.8" fill="#fff" />
    </svg>
  );
}
