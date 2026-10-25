// __NUDGE_FAKE_STORE__ — pretend database for automated browser tests. See fake-mode.ts.
// Only builds made with NUDGE_E2E=1 contain this file's code; scripts/check-secrets.mjs fails any
// normal build that does.
import { cookies } from "next/headers";

type Row = Record<string, unknown>;
type Store = { tables: Record<string, Row[]>; userId: string; needsSql?: boolean };

const FAKE_USER = "00000000-0000-4000-8000-000000000001";
const TABLES = ["profiles", "spaces", "items", "occurrences", "reminders", "item_events", "reminder_sends", "push_subscriptions", "courses", "calendar_feeds", "item_payments", "updates", "delivery_attempts", "item_checklist", "assignments", "grades", "api_tokens"];

function freshStore(): Store {
  return { tables: Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])), userId: FAKE_USER };
}

const g = globalThis as unknown as { __NUDGE_FAKE_STORE__?: Store };
export const store = (): Store => (g.__NUDGE_FAKE_STORE__ ??= freshStore());
export const resetStore = () => {
  g.__NUDGE_FAKE_STORE__ = freshStore();
};

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const DEFAULTS: Record<string, () => Row> = {
  profiles: () => ({
    timezone: "America/New_York",
    language: "en",
    mode: "full",
    track_types: [],
    nudge_style: "on_time",
    morning_enabled: true,
    morning_time: "08:00:00",
    quiet_start: "22:00:00",
    quiet_end: "07:00:00",
    urgent_override: true,
    type_switches: {},
    features: {},
    prefs: {},
    onboarded: false,
  }),
  spaces: () => ({ id: uuid(), emoji: "📁", is_default: false, notifications_enabled: true, sort_order: 0, created_at: now() }),
  items: () => ({ id: uuid(), status: "open", all_day: false, priority: 0, currency: "USD", source: "manual", notes: null, amount_cents: null, rrule: null, created_at: now(), updated_at: now() }),
  occurrences: () => ({ id: uuid(), status: "open", snoozed_until: null, snooze_count: 0, done_at: null, created_at: now() }),
  reminders: () => ({ id: uuid(), offset_minutes: null, days_before: null, at_time: null, created_at: now() }),
  item_events: () => ({ id: uuid(), detail: null, created_at: now() }),
  reminder_sends: () => ({ id: uuid(), created_at: now() }),
  push_subscriptions: () => ({ id: uuid(), created_at: now() }),
  courses: () => ({ id: uuid(), color: "#e4edff", created_at: now() }),
  calendar_feeds: () => ({ id: uuid(), enabled: true, last_synced_at: null, last_error: null, item_count: 0, created_at: now() }),
  item_payments: () => ({ id: uuid(), created_at: now() }),
  updates: () => ({ id: uuid(), body: null, item_id: null, created_at: now(), read_at: null }),
  delivery_attempts: () => ({ id: uuid(), error: null, http_status: null, created_at: now() }),
  item_checklist: () => ({ id: uuid(), done: false, sort_order: 0, created_at: now() }),
  assignments: () => ({ id: uuid(), created_at: now() }),
  grades: () => ({ id: uuid(), source: "manual", posted_at: now(), comment: null, created_at: now() }),
  api_tokens: () => ({ id: uuid(), last_used_at: null, expires_at: null, revoked_at: null, created_at: now() }),
};

type Filter = (r: Row) => boolean;
const cmp = (a: unknown, b: unknown) => (a === b ? 0 : (a as string | number) < (b as string | number) ? -1 : 1);

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filters: Filter[] = [];
  private sorts: { col: string; asc: boolean }[] = [];
  private max = Infinity;
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private returning = false;
  private one = false;

  constructor(private table: string) {}

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push((r) => cmp(r[c], v) < 0);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push((r) => cmp(r[c], v) <= 0);
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push((r) => cmp(r[c], v) > 0);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push((r) => cmp(r[c], v) >= 0);
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.sorts.push({ col, asc: o?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  abortSignal() {
    return this;
  }
  single() {
    this.one = true;
    return this;
  }

  private run() {
    const rows = store().tables[this.table];
    if (!rows) return { data: null, error: { message: `no table ${this.table}`, code: "PGRST205" } };
    const match = rows.filter((r) => this.filters.every((f) => f(r)));
    let out: Row[] = [];
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const p of list) {
        const row = { ...(DEFAULTS[this.table]?.() ?? { id: uuid() }), ...p };
        if (this.table === "occurrences" && rows.some((r) => r.item_id === row.item_id && r.due_at === row.due_at)) {
          return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
        rows.push(row);
        out.push(row);
      }
    } else if (this.op === "update") {
      for (const r of match) Object.assign(r, this.payload, this.table === "items" ? { updated_at: now() } : {});
      out = match;
    } else if (this.op === "delete") {
      const s = store();
      s.tables[this.table] = rows.filter((r) => !match.includes(r));
      // cascade, like the real foreign keys
      if (this.table === "items") {
        const ids = new Set(match.map((r) => r.id));
        for (const t of ["occurrences", "reminders", "item_events"]) {
          s.tables[t] = s.tables[t].filter((r) => !ids.has(r.item_id));
        }
      }
      out = match;
    } else {
      out = [...match];
      for (const { col, asc } of [...this.sorts].reverse()) out.sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
      out = out.slice(0, this.max);
    }
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    if (this.one) return out.length ? { data: out[0], error: null } : { data: null, error: { message: "no rows", code: "PGRST116" } };
    return { data: out, error: null };
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: { message: string; code?: string } | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export async function createFakeClient() {
  const jar = await cookies();
  const signedIn = () => jar.get("fake-user")?.value === "1";
  const s = store();
  return {
    auth: {
      async getClaims() {
        return { data: signedIn() ? { claims: { sub: s.userId } } : null, error: null };
      },
      async getUser() {
        return { data: { user: signedIn() ? { id: s.userId } : null }, error: null };
      },
      async signInWithOtp() {
        return { data: {}, error: null };
      },
      async verifyOtp({ token }: { token: string }) {
        if (token !== "123456") return { data: {}, error: { message: "bad code" } };
        jar.set("fake-user", "1", { path: "/", httpOnly: true, sameSite: "lax" });
        return { data: {}, error: null };
      },
      async signOut() {
        jar.delete("fake-user");
        return { error: null };
      },
      admin: { async deleteUser() { return { error: null }; } },
    },
    from(table: string) {
      return new Query(table);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (s.needsSql) return { data: null, error: { message: "Could not find the function in the schema cache", code: "PGRST202" } };
      if (name === "ensure_profile") {
        if (!s.tables.profiles.length) {
          s.tables.profiles.push({ user_id: s.userId, ...DEFAULTS.profiles() });
          s.tables.spaces.push({ ...DEFAULTS.spaces(), user_id: s.userId, name: "Personal", emoji: "🏠", is_default: true });
        }
        return { data: s.tables.profiles[0], error: null };
      }
      if (name === "sync_item_occurrences") {
        const itemId = args.p_item_id as string;
        const dues = (args.p_dues as string[]) ?? [];
        s.tables.occurrences = s.tables.occurrences.filter((o) => o.item_id !== itemId || o.status !== "open" || dues.includes(o.due_at as string));
        for (const d of dues) {
          if (!s.tables.occurrences.some((o) => o.item_id === itemId && o.due_at === d)) {
            s.tables.occurrences.push({ ...DEFAULTS.occurrences(), user_id: s.userId, item_id: itemId, due_at: d });
          }
        }
        return { data: null, error: null };
      }
      if (name === "nudge_import") return { data: fakeImport(args as unknown as ImportArgs), error: null };
      return { data: null, error: { message: `unknown function ${name}`, code: "PGRST202" } };
    },
  };
}

// A small stand-in for the database's nudge_import function (0009), for browser tests only.
type ImportArgs = { p_source: string; p_commit: boolean; p_payload: { classes?: Row[]; assignments?: Row[]; grades?: Row[] } };
export function fakeImport(args: ImportArgs) {
  const s = store();
  const { p_source: source, p_commit: commit, p_payload: p } = args;
  const kinds = ["classes", "assignments", "grades"] as const;
  const counts = Object.fromEntries(kinds.map((k) => [k, { new: 0, updated: 0, unchanged: 0 }])) as unknown as Record<(typeof kinds)[number], Record<string, number>>;
  const results: Row[] = [];
  const warnings: string[] = [];
  const courses = s.tables.courses;
  const refs = new Set<string>();
  for (const c of p.classes ?? []) {
    refs.add(String(c.external_id));
    refs.add(String(c.name).toLowerCase());
  }
  const courseFor = (ref: unknown): string | null => {
    if (!ref) return null;
    const r = String(ref);
    const hit = courses.find((c) => c.external_id === r || String(c.name).toLowerCase() === r.toLowerCase());
    if (hit) return hit.id as string;
    return !commit && (refs.has(r) || refs.has(r.toLowerCase())) ? "preview-class" : null;
  };

  for (const c of p.classes ?? []) {
    let row = courses.find((r) => r.source === source && r.external_id === c.external_id);
    let status: string;
    if (!row) {
      row = courses.find((r) => String(r.name).toLowerCase() === String(c.name).toLowerCase() && !r.external_id);
      status = row ? "updated" : "new";
    } else status = row.name !== c.name ? "updated" : "unchanged";
    if (commit && status === "new") courses.push({ ...DEFAULTS.courses(), user_id: s.userId, name: c.name, source, external_id: c.external_id, teacher: c.teacher ?? null, school_year: c.school_year ?? null });
    else if (commit && status === "updated" && row) Object.assign(row, { name: c.name, source, external_id: c.external_id, school_year: c.school_year ?? row.school_year ?? null });
    counts.classes[status]++;
    results.push({ kind: "class", external_id: c.external_id, title: c.name, status });
  }

  for (const a of p.assignments ?? []) {
    const courseId = courseFor(a.class);
    if (a.class && !courseId) warnings.push(`Assignment "${a.title}": class "${a.class}" is not known, so it was added without a class.`);
    const existing = s.tables.items.find((i) => i.source === source && i.external_uid === a.external_id && !i.feed_id);
    let status = "new";
    if (existing) status = existing.locally_edited ? "unchanged" : existing.title !== a.title || existing.due_at !== a.due_at || (a.link && existing.link !== a.link) || (a.done && existing.status === "open") ? "updated" : "unchanged";
    if (commit && status === "new") {
      const id = crypto.randomUUID();
      s.tables.items.push({ ...DEFAULTS.items(), id, user_id: s.userId, type: "homework", title: a.title, notes: a.notes ?? null, due_at: a.due_at, all_day: false, timezone: "America/New_York", status: a.done ? "done" : "open", source, external_uid: a.external_id, course_id: courseId === "preview-class" ? null : courseId, link: a.link ?? null });
      if (a.due_at) {
        s.tables.occurrences.push({ ...DEFAULTS.occurrences(), user_id: s.userId, item_id: id, due_at: a.due_at, status: a.done ? "done" : "open" });
        s.tables.reminders.push({ ...DEFAULTS.reminders(), user_id: s.userId, item_id: id, days_before: 1, at_time: "18:00:00" }, { ...DEFAULTS.reminders(), user_id: s.userId, item_id: id, offset_minutes: 120 });
      }
    } else if (commit && status === "updated" && existing) {
      Object.assign(existing, { title: a.title, due_at: a.due_at, notes: a.notes ?? null, link: a.link ?? existing.link ?? null, status: a.done ? "done" : existing.status });
      s.tables.occurrences = s.tables.occurrences.filter((o) => o.item_id !== existing.id || o.status !== "open");
      if (a.due_at && !a.done) s.tables.occurrences.push({ ...DEFAULTS.occurrences(), user_id: s.userId, item_id: existing.id, due_at: a.due_at });
    }
    counts.assignments[status]++;
    results.push({ kind: "assignment", external_id: a.external_id, title: a.title, status });
  }

  for (const g of p.grades ?? []) {
    const courseId = courseFor(g.class);
    if (!courseId) {
      warnings.push(`Grade "${g.title}": class "${g.class ?? ""}" is not known, so it was skipped.`);
      continue;
    }
    const existing = s.tables.grades.find((r) => r.source === source && r.external_id === g.external_id);
    const status = !existing ? "new" : existing.score !== g.score || existing.out_of !== g.out_of || existing.title !== g.title || (g.letter && existing.letter !== g.letter) || (g.points != null && existing.points !== g.points) || (g.term && existing.term !== g.term) || (g.school_year && existing.school_year !== g.school_year) ? "updated" : "unchanged";
    const percent = Math.round(((g.score as number) / (g.out_of as number)) * 10000) / 100;
    if (commit && status === "new") {
      s.tables.grades.push({ ...DEFAULTS.grades(), user_id: s.userId, course_id: courseId === "preview-class" ? null : courseId, title: g.title, score: g.score, out_of: g.out_of, percent, letter: g.letter ?? null, points: g.points ?? null, term: g.term ?? null, school_year: g.school_year ?? null, posted_at: g.posted_at ?? now(), source, external_id: g.external_id, notified_at: source === "manual" ? now() : null });
    } else if (commit && status === "updated" && existing) Object.assign(existing, { title: g.title, score: g.score, out_of: g.out_of, percent, letter: g.letter ?? existing.letter ?? null, points: g.points ?? existing.points ?? null, term: g.term ?? existing.term ?? null, school_year: g.school_year ?? existing.school_year ?? null });
    counts.grades[status]++;
    results.push({ kind: "grade", external_id: g.external_id, title: g.title, status });
  }
  return { committed: commit, counts, results, warnings };
}
