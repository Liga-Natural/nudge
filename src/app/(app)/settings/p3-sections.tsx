"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteFeed, syncFeedNow, updateProfile } from "@/app/actions";
import { createApiToken, createBillsFeed, createClassroomFeed, deleteApiToken, revokeApiToken } from "@/app/actions-p3";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { formatDay, formatTime } from "@/lib/time";
import type { Course, FeedRow, Prefs, TokenRow } from "@/lib/types";

const HOURS = [0, 1, 2, 3, 6, 12, 24];

function Toggle({ label, body, on, onChange }: { label: string; body?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-4">
      <span>
        <span className="block font-semibold">{label}</span>
        {body && <span className="block text-sm text-muted">{body}</span>}
      </span>
      <input type="checkbox" role="switch" className="h-6 w-6 flex-none accent-[#e8590c]" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// ---------------------------------------------------------------- homework reminder timing
export function HomeworkTiming({ prefs }: { prefs: Prefs }) {
  const { t } = useI18n();
  const router = useRouter();
  const [night, setNight] = useState(prefs.hw_night_time ?? "18:00");
  const [hours, setHours] = useState(prefs.hw_hours_before ?? 2);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  function save(patch: Prefs) {
    setMsg("");
    start(async () => {
      const r = await updateProfile({ prefs: patch });
      setMsg(r.ok ? t("settings.saved") : r.error === "setup" ? t("setup.title") : t(r.error));
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-hw">
      <h2 id="s-hw" className="text-lg font-bold">
        {t("hw.title")}
      </h2>
      <p className="text-sm text-muted">{t("hw.body")}</p>
      <Toggle
        label={t("hw.night")}
        on={night !== "off"}
        onChange={(v) => {
          const next = v ? "18:00" : "off";
          setNight(next);
          save({ hw_night_time: next });
        }}
      />
      {night !== "off" && (
        <div>
          <label htmlFor="hw-night" className="mb-1 block text-sm font-semibold text-muted">
            {t("hw.night.time")}
          </label>
          <input
            id="hw-night"
            type="time"
            className="field"
            value={night}
            onChange={(e) => {
              if (!e.target.value) return;
              setNight(e.target.value);
              save({ hw_night_time: e.target.value });
            }}
          />
        </div>
      )}
      <div>
        <label htmlFor="hw-hours" className="mb-1 block text-sm font-semibold text-muted">
          {t("hw.hours")}
        </label>
        <select
          id="hw-hours"
          className="field"
          value={hours}
          onChange={(e) => {
            setHours(Number(e.target.value));
            save({ hw_hours_before: Number(e.target.value) });
          }}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h === 0 ? t("hw.hours.off") : t("hw.hours.n", { n: h })}
            </option>
          ))}
        </select>
      </div>
      <p role="status" className="min-h-5 text-sm font-semibold text-muted">
        {pending ? t("common.loading") : msg}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- habits
export function HabitPrefs({ prefs }: { prefs: Prefs }) {
  const { t } = useI18n();
  const router = useRouter();
  const [on, setOn] = useState(prefs.habit_summary === true);
  const [time, setTime] = useState(prefs.habit_summary_time ?? "20:00");
  const [msg, setMsg] = useState("");
  const [, start] = useTransition();

  function save(patch: Prefs, rollback: () => void) {
    setMsg("");
    start(async () => {
      const r = await updateProfile({ prefs: patch });
      if (!r.ok) {
        rollback();
        setMsg(r.error === "setup" ? t("setup.title") : t(r.error));
      } else {
        setMsg(t("settings.saved"));
        router.refresh();
      }
    });
  }

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-habits">
      <h2 id="s-habits" className="text-lg font-bold">
        {t("habits.settings.title")}
      </h2>
      <Toggle
        label={t("habits.summary")}
        body={t("habits.summary.body")}
        on={on}
        onChange={(v) => {
          setOn(v);
          save({ habit_summary: v }, () => setOn(!v));
        }}
      />
      {on && (
        <div>
          <label htmlFor="habit-time" className="mb-1 block text-sm font-semibold text-muted">
            {t("habits.summary.time")}
          </label>
          <input
            id="habit-time"
            type="time"
            className="field"
            value={time}
            onChange={(e) => {
              if (!e.target.value) return;
              const before = time;
              setTime(e.target.value);
              save({ habit_summary_time: e.target.value }, () => setTime(before));
            }}
          />
        </div>
      )}
      <p role="status" className="min-h-5 text-sm font-semibold text-muted">
        {msg}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- shared list of feeds
function FeedList({ feeds, label }: { feeds: FeedRow[]; label: (f: FeedRow) => string }) {
  const { t, lang, tz } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!feeds.length) return null;
  return (
    <ul className="flex flex-col gap-3">
      {feeds.map((f) => (
        <li key={f.id} className="rounded-2xl border border-line p-3">
          <p className="font-semibold">{label(f)}</p>
          <p className="text-sm text-muted">
            {f.host} · {t("feeds.items", { n: f.item_count })}
          </p>
          <p className="text-sm text-muted">
            {f.last_synced_at
              ? t("feeds.lastChecked", { time: `${formatDay(new Date(f.last_synced_at), tz, lang)} ${formatTime(new Date(f.last_synced_at), tz, lang)}` })
              : t("feeds.never")}
          </p>
          {f.last_error && (
            <p role="status" className="text-sm font-semibold text-late-ink">
              {t("feeds.problem", { message: f.last_error })}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button className="btn-quiet" disabled={pending} onClick={() => start(async () => { await syncFeedNow(f.id); router.refresh(); })}>
              {t("feeds.syncNow")}
            </button>
            <button className="btn-quiet" disabled={pending} aria-label={`${t("feeds.remove")}: ${f.name}`} onClick={() => start(async () => { await deleteFeed(f.id); router.refresh(); })}>
              {t("feeds.remove")}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- Google Classroom calendars
export function ClassroomSection({ feeds, courses }: { feeds: FeedRow[]; courses: Course[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [courseId, setCourseId] = useState<string>(courses[0]?.id ?? "");
  const [className, setClassName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const makingNew = courseId === "";

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-classroom">
      <h2 id="s-classroom" className="text-lg font-bold">
        {t("classroom.title")}
      </h2>
      <p className="text-sm text-muted">{t("classroom.body")}</p>
      <FeedList feeds={feeds} label={(f) => f.name} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          start(async () => {
            const r = await createClassroomFeed({ courseId: makingNew ? null : courseId, className, url });
            if (r.ok) {
              setUrl("");
              setClassName("");
              router.refresh();
            } else setError(r.error === "setup" ? t("setup.title") : t(r.error as Key));
          });
        }}
      >
        <div>
          <label htmlFor="cr-class" className="mb-1 block text-sm font-semibold text-muted">
            {t("classroom.class")}
          </label>
          <select id="cr-class" className="field" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="">{t("classroom.newClass")}</option>
          </select>
        </div>
        {makingNew && (
          <div>
            <label htmlFor="cr-name" className="mb-1 block text-sm font-semibold text-muted">
              {t("school.courseName")}
            </label>
            <input id="cr-name" className="field" value={className} maxLength={60} onChange={(e) => setClassName(e.target.value)} required />
          </div>
        )}
        <div>
          <label htmlFor="cr-url" className="mb-1 block text-sm font-semibold text-muted">
            {t("classroom.url")}
          </label>
          <input id="cr-url" className="field" type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </div>
        <p className="text-sm text-muted">{t("classroom.howTo")}</p>
        {error && (
          <p role="alert" className="text-sm font-semibold text-late-ink">
            {error}
          </p>
        )}
        <button className="btn-quiet w-full" type="submit" disabled={pending}>
          {t("classroom.add")}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- Joker bills
export function BillsSection({ feeds }: { feeds: FeedRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("Joker bills");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-bills">
      <h2 id="s-bills" className="text-lg font-bold">
        {t("bills.title")}
      </h2>
      <p className="text-sm text-muted">{t("bills.body")}</p>
      <FeedList feeds={feeds} label={(f) => f.name} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          start(async () => {
            const r = await createBillsFeed({ name, url });
            if (r.ok) {
              setUrl("");
              router.refresh();
            } else setError(r.error === "setup" ? t("setup.title") : t(r.error as Key));
          });
        }}
      >
        <div>
          <label htmlFor="bills-name" className="mb-1 block text-sm font-semibold text-muted">
            {t("feeds.name")}
          </label>
          <input id="bills-name" className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="bills-url" className="mb-1 block text-sm font-semibold text-muted">
            {t("bills.url")}
          </label>
          <input id="bills-url" className="field" type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-late-ink">
            {error}
          </p>
        )}
        <button className="btn-quiet w-full" type="submit" disabled={pending}>
          {t("bills.add")}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- agent access tokens
export function TokensSection({ tokens, endpoint }: { tokens: TokenRow[]; endpoint: string }) {
  const { t, lang, tz } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [testToken, setTestToken] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  async function runTest(token: string) {
    setTestMsg(null);
    try {
      const res = await fetch("/api/inbox", { headers: { Authorization: `Bearer ${token.trim()}` }, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token_name?: string };
      setTestMsg(res.ok ? { ok: true, text: t("tokens.test.ok", { name: body.token_name ?? "" }) } : { ok: false, text: body.error ?? t("tokens.test.unreachable") });
    } catch {
      setTestMsg({ ok: false, text: t("tokens.test.unreachable") });
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-tokens">
      <h2 id="s-tokens" className="text-lg font-bold">
        {t("tokens.title")}
      </h2>
      <p className="text-sm text-muted">{t("tokens.body")}</p>
      <Link href="/import" className="btn-quiet w-full">
        {t("tokens.openImport")} →
      </Link>
      <p className="break-all text-sm">
        <span className="font-semibold">{t("tokens.address")}:</span> <code>{endpoint}</code>
      </p>

      {tokens.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tokens.map((tk) => (
            <li key={tk.id} className="rounded-2xl border border-line p-3">
              <p className="font-semibold">
                {tk.name} <code className="text-sm text-muted">{tk.token_prefix}…</code>
              </p>
              <p className="text-sm text-muted">
                {tk.revoked_at
                  ? t("tokens.revokedOn", { when: formatDay(new Date(tk.revoked_at), tz, lang) })
                  : tk.last_used_at
                    ? t("tokens.lastUsed", { when: `${formatDay(new Date(tk.last_used_at), tz, lang)} ${formatTime(new Date(tk.last_used_at), tz, lang)}` })
                    : t("tokens.neverUsed")}
              </p>
              <div className="mt-2 flex gap-2">
                {!tk.revoked_at && (
                  <button className="btn-quiet" disabled={pending} aria-label={`${t("tokens.revoke")}: ${tk.name}`} onClick={() => start(async () => { await revokeApiToken(tk.id); router.refresh(); })}>
                    {t("tokens.revoke")}
                  </button>
                )}
                <button className="btn-quiet" disabled={pending} aria-label={`${t("action.delete")}: ${tk.name}`} onClick={() => start(async () => { await deleteApiToken(tk.id); router.refresh(); })}>
                  {t("action.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {fresh && (
        <div role="status" className="rounded-2xl border-2 border-accent bg-accent-soft p-3">
          <p className="font-semibold">{t("tokens.once")}</p>
          <code className="my-2 block break-all rounded-xl bg-white p-2 text-sm" data-testid="new-token">
            {fresh}
          </code>
          <div className="flex gap-2">
            <button
              className="btn-quiet"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fresh);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? t("tokens.copied") : t("tokens.copy")}
            </button>
            <button className="btn-quiet" onClick={() => void runTest(fresh)}>
              {t("tokens.test")}
            </button>
          </div>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setCopied(false);
          setTestMsg(null);
          start(async () => {
            const r = await createApiToken(name);
            if (r.ok) {
              setFresh(r.token);
              setName("");
              router.refresh();
            } else setError(r.error === "setup" ? t("setup.title") : t(r.error));
          });
        }}
      >
        <label htmlFor="token-name" className="sr-only">
          {t("tokens.name")}
        </label>
        <input id="token-name" className="field" placeholder={t("tokens.name")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        <button className="btn-quiet flex-none" type="submit" disabled={pending}>
          {t("tokens.create")}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <label htmlFor="token-test" className="text-sm font-semibold text-muted">
          {t("tokens.test.label")}
        </label>
        <div className="flex gap-2">
          <input id="token-test" className="field" autoComplete="off" value={testToken} onChange={(e) => setTestToken(e.target.value)} placeholder="ndg_…" />
          <button className="btn-quiet flex-none" disabled={!testToken.trim()} onClick={() => void runTest(testToken)}>
            {t("tokens.test")}
          </button>
        </div>
        {testMsg && (
          <p role="status" className={`text-sm font-semibold ${testMsg.ok ? "" : "text-late-ink"}`}>
            {testMsg.ok ? "✓ " : ""}
            {testMsg.text}
          </p>
        )}
      </div>
    </section>
  );
}
