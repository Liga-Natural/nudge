// A colour and an emoji for every class, picked from the subject's name ("Italian" -> 🇮🇹) and editable.
// The colour lives on the class itself; the emoji is a small per-person setting (no database change).

export type Look = { emoji: string; color: string };

const DEFAULT_COLOR = "#e4edff";
const DEFAULT_EMOJI = "🎓";
const FALLBACK_COLORS = ["#e4edff", "#e2f5e8", "#ffefd6", "#f1e7ff", "#ffe6ec", "#dff3f3", "#fff1e6", "#e6f4d9"];

/** Colours offered when editing a class (all light enough for dark text). */
export const COURSE_COLORS = ["#e4edff", "#e2f5e8", "#ffefd6", "#f1e7ff", "#ffe6ec", "#dff3f3", "#fff1e6", "#e6f4d9", "#ffe3f1", "#e3e8ff"];
export const COURSE_EMOJIS = ["🇮🇹", "🧪", "📖", "➗", "🎬", "💼", "🌍", "🎨", "🎵", "⚽", "🇪🇸", "💻", "📐", "🔬", "✏️", "📚", "🧮", "🗣️", "🏛️", "🧠", "🎭", "🍎", "🌱", "🎓"];

const RULES: { re: RegExp; emoji: string; color: string }[] = [
  { re: /\b(ital\w*)\b/, emoji: "🇮🇹", color: "#e2f5e8" },
  { re: /\b(spanish|espanol)\b/, emoji: "🇪🇸", color: "#ffefd6" },
  { re: /\b(scien\w*|cienc\w*|biolog\w*|chem\w*|physic\w*|fisic\w*|earth)\b/, emoji: "🧪", color: "#dff3f3" },
  { re: /\b(language arts|ela|english|ingles|reading|lectura|writing|literature|literatura)\b/, emoji: "📖", color: "#ffefd6" },
  { re: /\b(algebra|math\w*|geometr\w*|calcul\w*|mate\w*|trig\w*|statistic\w*)\b/, emoji: "➗", color: "#e4edff" },
  { re: /\ba\/v\b|\b(av|audio|video|media|film|broadcast\w*)\b/, emoji: "🎬", color: "#f1e7ff" },
  { re: /\b(career|cte|business|entrepreneur\w*|econom\w*|finance)\b/, emoji: "💼", color: "#ffe6ec" },
  { re: /\b(history|historia|social studies|geograph\w*|civics|world|government)\b/, emoji: "🌍", color: "#fff1e6" },
  { re: /\b(art|arts|arte|drawing|painting)\b/, emoji: "🎨", color: "#ffe3f1" },
  { re: /\b(music|musica|band|chorus|orchestra|choir)\b/, emoji: "🎵", color: "#e3e8ff" },
  { re: /\b(pe|p\.e\.|physical|health|gym|sports)\b/, emoji: "⚽", color: "#e6f4d9" },
  { re: /\b(computer\w*|coding|programming|stem|robot\w*|tech\w*)\b/, emoji: "💻", color: "#e3e8ff" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The emoji and colour a class gets from its name alone. */
export function autoLook(name: string): Look {
  const n = norm(name);
  const hit = RULES.find((r) => r.re.test(n));
  if (hit) return { emoji: hit.emoji, color: hit.color };
  return { emoji: DEFAULT_EMOJI, color: FALLBACK_COLORS[hash(n) % FALLBACK_COLORS.length] };
}

const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);

/** True for the blank-looking colours a class gets when nobody chose one (near white, or the old default blue). */
export function isPlaceholderColor(c: string): boolean {
  if (c.toLowerCase() === DEFAULT_COLOR) return true;
  const n = parseInt(c.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.97;
}

/** What to draw for a class: its own colour if it has a real one, else the subject's; its emoji if set, else the subject's. */
export function courseLook(course: { id: string; name: string; color?: string | null }, emojiPrefs?: Record<string, string> | null): Look {
  const auto = autoLook(course.name);
  const color = isHex(course.color) && !isPlaceholderColor(course.color) ? course.color : auto.color;
  const own = emojiPrefs?.[course.id];
  return { emoji: own && own.trim() ? own : auto.emoji, color };
}

/** Courses with their resolved colour and emoji filled in, ready for any screen. */
export function withLooks<T extends { id: string; name: string; color?: string | null }>(courses: T[], emojiPrefs?: Record<string, string> | null): (T & Look)[] {
  return courses.map((c) => ({ ...c, ...courseLook(c, emojiPrefs) }));
}
