// __NUDGE_FAKE_STORE__ — pretend database for automated browser tests. See fake-mode.ts.
// Only builds made with NUDGE_E2E=1 contain this file's code; scripts/check-secrets.mjs fails any
// normal build that does.
import { cookies } from "next/headers";

type Row = Record<string, unknown>;
type Store = { tables: Record<string, Row[]>; userId: string; needsSql?: boolean };

const FAKE_USER = "00000000-0000-4000-8000-000000000001";
const TABLES = ["profiles", "spaces", "items", "occurrences", "reminders", "item_events", "reminder_sends", "push_subscriptions", "courses", "calendar_feeds", "item_payments", "updates"];

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
      return { data: null, error: { message: `unknown function ${name}`, code: "PGRST202" } };
    },
  };
}
