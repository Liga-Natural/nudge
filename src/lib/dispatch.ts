import { expandRule } from "./recurrence";
import {
  buildReminderPayload,
  buildSummaryPayload,
  type PushPayload,
  type ReminderRow,
  type SummaryRow,
} from "./push-text";

// The reminder clock. Called once a minute by the database (/api/dispatch) and once a day
// as a catch-up (/api/cron/daily). It never talks to the database except through the
// functions in 0004_reminder_clock.sql, so the same code is tested against a real Postgres.

export type RpcResult = { data: unknown; error: { message: string } | null };
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
export type Subscription = { user_id: string; endpoint: string; p256dh: string; auth: string };
export type SendOutcome = { ok: boolean; gone?: boolean; status?: number; error?: string };
export type Sender = (sub: Subscription, payload: PushPayload) => Promise<SendOutcome>;

export type DispatchOptions = {
  rpc: Rpc;
  send: Sender;
  now: Date;
  /** How far back a reminder may be and still be "due now". The minute clock uses 2. */
  windowMinutes?: number;
  /** Ignore reminders newer than this (the daily catch-up leaves the last 5 minutes to the clock). */
  minAgeMinutes?: number;
  label?: "missed" | null;
  withSummaries?: boolean;
  withTopUp?: boolean;
};

export type DispatchResult = {
  claimed: number;
  sent: number;
  failed: number;
  held: number;
  skipped: number;
  summaries: number;
  topped: number;
  durationMs: number;
};

export async function call<T>(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await rpc(name, args);
  if (res.error) throw new Error(`${name}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

export async function runDispatch(opts: DispatchOptions): Promise<DispatchResult> {
  const started = Date.now();
  const { rpc, send, now } = opts;
  const iso = now.toISOString();
  const result: DispatchResult = { claimed: 0, sent: 0, failed: 0, held: 0, skipped: 0, summaries: 0, topped: 0, durationMs: 0 };

  if (opts.withTopUp !== false) result.topped = await topUpSeries(rpc, now);

  const claimed = await call<ReminderRow[]>(rpc, "dispatch_claim", {
    p_now: iso,
    p_window_minutes: opts.windowMinutes ?? 2,
    p_min_age_minutes: opts.minAgeMinutes ?? 0,
    p_label: opts.label ?? null,
  });
  const reclaimed = await call<ReminderRow[]>(rpc, "dispatch_reclaim", { p_now: iso });
  const rows = [...claimed, ...reclaimed];
  result.claimed = rows.length;
  // Reminders held for quiet hours or switched off never count as "claimed"; say so out loud.
  try {
    const stats = await call<{ held: number; skipped: number }[]>(rpc, "dispatch_tick_stats", { p_now: iso });
    result.held = stats[0]?.held ?? 0;
    result.skipped = stats[0]?.skipped ?? 0;
  } catch {
    // An older database without file 0007.
  }
  // Which occurrence each reminder is for, so a tap on the notification can open it with Done / Snooze.
  const occBySend = new Map<string, string>();
  if (rows.length) {
    try {
      const ids = await call<{ send_id: string; occurrence_id: string }[]>(rpc, "dispatch_occurrence_ids", { p_send_ids: rows.map((r) => r.send_id) });
      for (const i of ids) occBySend.set(i.send_id, i.occurrence_id);
    } catch {
      // Older database: notifications just open the item without the quick buttons.
    }
  }
  for (const r of rows) r.occurrence_id = occBySend.get(r.send_id);

  const summaries = opts.withSummaries === false ? [] : await call<SummaryRow[]>(rpc, "dispatch_summaries", { p_now: iso });

  const userIds = [...new Set([...rows.map((r) => r.user_id), ...summaries.map((s) => s.user_id)])];
  const subs = userIds.length
    ? await call<Subscription[]>(rpc, "dispatch_subscriptions", { p_user_ids: userIds })
    : [];
  const subsByUser = new Map<string, Subscription[]>();
  for (const s of subs) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);

  // Autopay payments only get a gentle heads-up, never "pay now".
  const payItems = [...new Set(rows.filter((r) => r.item_type === "payment").map((r) => r.item_id))];
  const autopay = new Set<string>();
  if (payItems.length) {
    try {
      const flags = await call<{ item_id: string; autopay: boolean }[]>(rpc, "dispatch_item_flags", { p_item_ids: payItems });
      for (const f of flags) if (f.autopay) autopay.add(f.item_id);
    } catch {
      // An older database without the Phase 2 file: fall back to the normal wording.
    }
  }

  const gone = new Set<string>();
  type Delivery = { outcome: "sent" | "failed" | "none"; error: string | null; httpStatus: number | null };
  async function deliver(userId: string, payload: PushPayload): Promise<Delivery> {
    const mine = subsByUser.get(userId) ?? [];
    if (!mine.length) {
      return { outcome: "none", error: "No phone is signed up for notifications. Open Settings and tap Turn on notifications.", httpStatus: null };
    }
    const outcomes = await Promise.all(
      mine.map(async (s) => {
        try {
          const o = await send(s, payload);
          if (o.gone) gone.add(s.endpoint);
          return o;
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "Unknown error" } as SendOutcome;
        }
      }),
    );
    if (outcomes.some((o) => o.ok)) return { outcome: "sent", error: null, httpStatus: null };
    const first = outcomes[0];
    return { outcome: "failed", error: first?.error ?? "The notification could not be sent.", httpStatus: first?.status ?? null };
  }

  // The Delivery log in Settings. Writing to it must never stop a reminder from going out.
  async function logAttempt(a: { userId: string; sendId: string | null; kind: string; title: string; d: Delivery }) {
    try {
      const status = a.d.outcome === "sent" ? "sent" : a.d.outcome === "none" ? "no_phone" : "failed";
      await rpc("dispatch_log_attempt", {
        p_user_id: a.userId,
        p_send_id: a.sendId,
        p_kind: a.kind,
        p_title: a.title,
        p_status: status,
        p_error: a.d.error,
        p_http_status: a.d.httpStatus,
      });
    } catch {
      // An older database without file 0007: the reminder still goes out.
    }
  }

  // One push per person per minute, however many reminders fell due together.
  const byUser = new Map<string, ReminderRow[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  await Promise.all(
    [...byUser.entries()].map(async ([userId, userRows]) => {
      const d = await deliver(userId, buildReminderPayload(userRows, now, { autopay }));
      for (const r of userRows) {
        const status = d.outcome === "sent" ? "sent" : d.outcome === "none" ? "skipped" : "failed";
        await call(rpc, "dispatch_finish", { p_send_id: r.send_id, p_status: status });
        await logAttempt({ userId, sendId: r.send_id, kind: r.label === "missed" ? "catchup" : "reminder", title: r.title, d });
        if (status === "sent") result.sent++;
        else if (status === "failed") result.failed++;
      }
    }),
  );

  for (const s of summaries) {
    const d = await deliver(s.user_id, buildSummaryPayload(s));
    await logAttempt({ userId: s.user_id, sendId: null, kind: "summary", title: "Morning summary", d });
    if (d.outcome === "sent") result.summaries++;
  }

  for (const endpoint of gone) await call(rpc, "dispatch_remove_subscription", { p_endpoint: endpoint });

  result.durationMs = Date.now() - started;
  await call(rpc, "dispatch_log_write", {
    p_now: iso,
    p_claimed: result.claimed,
    p_sent: result.sent,
    p_failed: result.failed,
    p_held: result.held,
    p_summaries: result.summaries,
    p_duration_ms: result.durationMs,
    p_note: opts.label ?? null,
  });
  return result;
}

type SeriesRow = { item_id: string; start_at: string; timezone: string; rrule: string; last_due: string | null };

/** Keeps the next 30 days of every repeating item ready in the database. */
export async function topUpSeries(rpc: Rpc, now: Date): Promise<number> {
  const horizon = new Date(now.getTime() + 30 * 86400000);
  const rows = await call<SeriesRow[]>(rpc, "dispatch_series_needing_topup", {
    p_horizon: horizon.toISOString(),
    p_limit: 200,
  });
  let added = 0;
  for (const row of rows) {
    const last = row.last_due ? new Date(row.last_due) : null;
    const dues = expandRule({
      rule: row.rrule,
      start: new Date(row.start_at),
      tz: row.timezone,
      from: last ? new Date(last.getTime() + 1000) : undefined,
      to: horizon,
      limit: 60,
    });
    if (!dues.length) continue;
    await call(rpc, "dispatch_add_occurrences", { p_item_id: row.item_id, p_dues: dues.map((d) => d.toISOString()) });
    added += dues.length;
  }
  return added;
}
