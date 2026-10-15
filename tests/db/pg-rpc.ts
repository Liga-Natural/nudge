import type { PGlite } from "@electric-sql/pglite";
import type { Rpc, Sender, Subscription } from "@/lib/dispatch";
import type { PushPayload } from "@/lib/push-text";

// Lets the real dispatcher code talk to a real Postgres (PGlite) the same way it talks to Supabase.
function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  return value;
}

export function pgRpc(db: PGlite): Rpc {
  return async (name, args) => {
    const keys = Object.keys(args);
    const sql = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    try {
      const r = await db.query(sql, keys.map((k) => args[k]));
      const rows = r.rows.map((row) =>
        Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, plain(v)])),
      );
      // A function that returns one plain value (not a table) answers with just that value, like Supabase does.
      const first = rows[0] as Record<string, unknown> | undefined;
      if (rows.length === 1 && first && Object.keys(first).length === 1 && name in first) return { data: first[name], error: null };
      return { data: rows, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  };
}

export type FakePush = { sender: Sender; calls: { endpoint: string; payload: PushPayload }[]; failNext: (n: number) => void };

export function fakePush(): FakePush {
  const calls: FakePush["calls"] = [];
  let failures = 0;
  return {
    calls,
    failNext: (n) => {
      failures = n;
    },
    sender: async (sub: Subscription, payload: PushPayload) => {
      if (failures > 0) {
        failures--;
        return { ok: false };
      }
      calls.push({ endpoint: sub.endpoint, payload });
      return { ok: true };
    },
  };
}
