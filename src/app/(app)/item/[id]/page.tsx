import Link from "next/link";
import { getReadyCtx } from "@/lib/context";
import { makeT, type Key } from "@/lib/i18n";
import { toDueLocal, type HwWhere } from "@/lib/item-input";
import { describeReminder } from "@/lib/reminder-labels";
import { describeRule, parseRule } from "@/lib/recurrence";
import { rowToReminder } from "@/lib/reminders";
import { loadSpaces, ITEM_COLUMNS, spaceLabel } from "@/lib/queries";
import { formatDay, formatDayLong, formatMoney, formatTime, instantToWall } from "@/lib/time";
import { computeStreak } from "@/lib/streak";
import { ChecklistView } from "@/components/checklist-view";
import { TYPE_BG, TYPE_EMOJI, enabledItemTypes, type ChecklistRow, type Course, type EventRow, type ItemRow, type OccurrenceRow, type ReminderDbRow } from "@/lib/types";
import { QuickActions } from "@/components/quick-actions";
import { ItemActions } from "./item-actions";
import { EditItem } from "./edit-item";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ occ?: string; quick?: string }> }) {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const lang = profile.language;
  const tz = profile.timezone;
  const { id } = await params;
  const query = await searchParams;

  const notFound = (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-10">
      <p className="card p-6 text-center">{t("item.notFound")}</p>
      <Link href="/" className="btn-primary">
        {t("item.backToToday")}
      </Link>
    </main>
  );
  if (!UUID.test(id)) return notFound;

  const { data: itemData } = await supabase.from("items").select(ITEM_COLUMNS).eq("id", id).single();
  const item = itemData as ItemRow | null;
  if (!item) return notFound;

  const [remRes, occRes, evRes, spaces, courseRes, checkRes, ringRes] = await Promise.all([
    supabase.from("reminders").select("id,item_id,offset_minutes,days_before,at_time").eq("item_id", id),
    supabase.from("occurrences").select("id,item_id,due_at,status,snoozed_until,snooze_count,done_at").eq("item_id", id).order("due_at", { ascending: false }).limit(40),
    supabase.from("item_events").select("id,item_id,kind,detail,created_at").eq("item_id", id).order("created_at", { ascending: false }).limit(30),
    loadSpaces(supabase),
    supabase.from("courses").select("id,name,color").order("created_at"),
    supabase.from("item_checklist").select("id,item_id,text,done,sort_order").eq("item_id", id).order("sort_order"),
    // Separate and forgiving: a database without file 0011 simply has no such column yet.
    supabase.from("items").select("ring_anyway").eq("id", id).single(),
  ]);
  const ringAnyway = (ringRes.data as { ring_anyway?: boolean } | null)?.ring_anyway === true;
  const checklist = (checkRes.data ?? []) as ChecklistRow[];
  const courses = (courseRes.data ?? []) as Course[];
  const reminders = ((remRes.data ?? []) as ReminderDbRow[]).map(rowToReminder);
  const occs = (occRes.data ?? []) as OccurrenceRow[];
  const events = (evRes.data ?? []) as EventRow[];
  const open = occs.filter((o) => o.status === "open").sort((a, b) => a.due_at.localeCompare(b.due_at));
  const current = open[0] ?? occs[0] ?? null;

  const occIds = occs.map((o) => o.id);
  const { data: sendsData } = occIds.length
    ? await supabase.from("reminder_sends").select("id,fire_at,sent_at,status").in("occurrence_id", occIds).eq("status", "sent").order("sent_at", { ascending: false }).limit(15)
    : { data: [] };
  const sends = (sendsData ?? []) as { id: string; sent_at: string | null }[];

  const history = [
    ...events.map((e) => ({ id: e.id, at: e.created_at, text: t(`item.history.${e.kind}` as Key) })),
    ...sends.filter((s) => s.sent_at).map((s) => ({ id: s.id, at: s.sent_at as string, text: `${t("item.history.sent")} ${formatTime(new Date(s.sent_at as string), tz, lang)}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const due = current ? new Date(current.due_at) : item.due_at ? new Date(item.due_at) : null;
  const rule = item.rrule ? parseRule(item.rrule) : null;
  const space = spaces.find((s) => s.id === item.space_id);
  const first = item.due_at ? new Date(item.due_at) : null;
  const initial = {
    title: item.title,
    type: item.type,
    dueLocal: first ? toDueLocal(first, item.all_day, instantToWall(first, tz)) : null,
    allDay: item.all_day,
    amountCents: item.amount_cents,
    rrule: item.rrule,
    spaceId: item.space_id,
    autopay: !!item.autopay,
    courseId: item.course_id,
    notes: item.notes,
    location: item.location ?? null,
    link: item.link ?? null,
    where: (item.hw_where as HwWhere | null) ?? null,
    subtype: (item.subtype as "game_day" | "registration" | "sponsor" | "posting" | null) ?? null,
    checklist: checklist.map((c) => ({ text: c.text, done: c.done })),
    reminders,
    ringAnyway,
  };
  const streak = item.type === "habit" ? computeStreak(occs.map((o) => ({ dueAt: o.due_at, status: o.status })), new Date(), tz) : null;

  const status = current?.status ?? item.status;
  const snoozed = current?.snoozed_until && new Date(current.snoozed_until) > new Date();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-6">
      <Link href="/" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>

      {query.quick === "1" && current && current.status === "open" && UUID.test(query.occ ?? "") && query.occ === current.id && (
        <QuickActions occId={current.id} />
      )}

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="item-title">
        <div className="flex items-start gap-3">
          <span aria-hidden className={`flex h-12 w-12 flex-none items-center justify-center rounded-2xl text-2xl ${TYPE_BG[item.type]}`}>
            {TYPE_EMOJI[item.type]}
          </span>
          <div className="min-w-0">
            <h1 id="item-title" className="text-2xl font-extrabold leading-tight">
              {item.title}
            </h1>
            <p className="text-sm font-semibold text-muted">{t(`type.${item.type}` as Key)}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="font-semibold text-muted">{current && open.length > 1 ? t("item.nextDue") : t("item.due")}</dt>
          <dd>
            {due
              ? item.all_day
                ? formatDayLong(due, tz, lang)
                : `${formatDay(due, tz, lang)} · ${formatTime(due, tz, lang)}`
              : t("item.noDue")}
          </dd>
          {rule && (
            <>
              <dt className="font-semibold text-muted">{t("item.repeats")}</dt>
              <dd>{describeRule(rule, lang)}</dd>
            </>
          )}
          {item.amount_cents != null && (
            <>
              <dt className="font-semibold text-muted">{t("item.amount")}</dt>
              <dd>{formatMoney(item.amount_cents, item.currency, lang)}</dd>
            </>
          )}
          {item.location && (
            <>
              <dt className="font-semibold text-muted">{t("item.location")}</dt>
              <dd>{item.location}</dd>
            </>
          )}
          {item.type === "homework" && item.hw_where && (
            <>
              <dt className="font-semibold text-muted">{t("hw.where")}</dt>
              <dd>{t(("hw.where." + item.hw_where) as Key)}</dd>
            </>
          )}
          {item.type === "homework" && item.link && (
            <>
              <dt className="font-semibold text-muted">{t("hw.link")}</dt>
              <dd>
                <a className="font-semibold text-accent-text underline" href={item.link} target="_blank" rel="noopener noreferrer">
                  {t("hw.open")} ↗
                </a>
              </dd>
            </>
          )}
          {item.type === "work" && item.subtype && (
            <>
              <dt className="font-semibold text-muted">{t("item.kind")}</dt>
              <dd>{t(`work.${item.subtype}` as Key)}</dd>
            </>
          )}
          {streak && (
            <>
              <dt className="font-semibold text-muted">{t("habits.streakLabel")}</dt>
              <dd>
                {t("habits.streak", { n: streak.current })} · {t("habits.best", { n: streak.best })}
              </dd>
            </>
          )}
          {space && (
            <>
              <dt className="font-semibold text-muted">{t("item.space")}</dt>
              <dd>
                {space.emoji} {spaceLabel(space, t("space.personal"))}
              </dd>
            </>
          )}
          <dt className="font-semibold text-muted">{t("item.status.open")}</dt>
          <dd>
            {t(`item.status.${status === "open" ? "open" : status === "skipped" ? "skipped" : "done"}` as Key)}
            {snoozed && current?.snoozed_until ? ` · ${t("today.snoozedUntil", { time: formatTime(new Date(current.snoozed_until), tz, lang) })}` : ""}
            {current && current.snooze_count > 0 ? ` · ${current.snooze_count === 1 ? t("item.snoozedOnce") : t("item.snoozedTimes", { n: current.snooze_count })}` : ""}
          </dd>
        </dl>
        {item.notes && (
          <div>
            <h2 className="text-sm font-semibold text-muted">{t("item.notes")}</h2>
            <p className="whitespace-pre-wrap">{item.notes}</p>
          </div>
        )}
      </section>

      <ItemActions occId={current?.id ?? null} status={status} recurring={!!item.rrule} itemId={item.id} title={item.title} habit={item.type === "habit"} />

      {checklist.length > 0 && <ChecklistView rows={checklist} />}

      <section className="card flex flex-col gap-2 p-5" aria-labelledby="rem-h">
        <h2 id="rem-h" className="text-lg font-bold">
          {t("reminder.title")}
        </h2>
        {reminders.length === 0 ? (
          <p className="text-muted">{t("reminder.none")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {reminders.map((r) => (
              <li key={JSON.stringify(r)} className="rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold">
                {describeReminder(r, t, lang)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <EditItem initial={initial} spaces={spaces} courses={courses} showSpaces={profile.mode === "full"} itemId={item.id} enabledTypes={enabledItemTypes(profile.features)} quiet={{ start: profile.quiet_start, end: profile.quiet_end, urgentOverride: profile.urgent_override }} />

      <section className="card flex flex-col gap-2 p-5" aria-labelledby="hist-h">
        <h2 id="hist-h" className="text-lg font-bold">
          {t("item.history")}
        </h2>
        {history.length === 0 ? (
          <p className="text-muted">{t("item.history.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {history.slice(0, 20).map((h) => (
              <li key={h.id} className="flex justify-between gap-3">
                <span>{h.text}</span>
                <span className="flex-none text-muted">
                  {formatDay(new Date(h.at), tz, lang)} · {formatTime(new Date(h.at), tz, lang)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
