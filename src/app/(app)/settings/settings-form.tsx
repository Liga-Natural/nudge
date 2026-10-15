"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { createSpace, deleteAccount, deleteSpace, updateProfile, updateSpace, type ProfilePatch } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import { NotificationsPanel } from "@/components/notifications-panel";
import { FEATURE_KEYS } from "@/lib/features";
import { FeedsSection } from "./feeds-section";
import { useT } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { BillsSection, ClassroomSection, HabitPrefs, HomeworkTiming, TokensSection } from "./p3-sections";
import type { Course, FeedRow, Profile, Space, TokenRow } from "@/lib/types";

const STYLES = ["morning", "on_time", "before", "important"] as const;
const TYPES = ["task", "homework", "payment", "event", "renewal"] as const;

const hhmm = (v: string) => v.slice(0, 5);
const noSubscribe = () => () => {};

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

export function SettingsForm({
  profile,
  spaces,
  feeds,
  classroomFeeds,
  billsFeeds,
  courses,
  tokens,
  endpoint,
}: {
  profile: Profile;
  spaces: Space[];
  feeds: FeedRow[];
  classroomFeeds: FeedRow[];
  billsFeeds: FeedRow[];
  courses: Course[];
  tokens: TokenRow[];
  endpoint: string;
}) {
  const t = useT();
  const router = useRouter();
  const [p, setP] = useState(profile);
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const [newSpace, setNewSpace] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState("");
  // "" while the page is drawn on the server and during hydration, then this phone's own zone.
  const deviceTz = useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "",
  );

  function save(patch: ProfilePatch, refresh = false) {
    setP((cur) => ({ ...cur, ...patch }) as Profile);
    setError("");
    start(async () => {
      const r = await updateProfile(patch);
      if (!r.ok) return setError(t("common.error"));
      setSaved(t("settings.saved"));
      if (refresh) router.refresh();
    });
  }

  const chip = (on: boolean) =>
    `min-h-[44px] rounded-full border px-4 text-sm font-semibold ${on ? "border-accent bg-accent-soft" : "border-line bg-white"}`;

  return (
    <div className="flex flex-col gap-5">
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-semibold text-muted">
        {pending ? t("common.loading") : saved}
      </p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-lang">
        <h2 id="s-lang" className="text-lg font-bold">
          {t("settings.language")}
        </h2>
        <div className="flex gap-2">
          {(["en", "es"] as const).map((l) => (
            <button key={l} aria-pressed={p.language === l} className={chip(p.language === l)} onClick={() => save({ language: l }, true)}>
              {t(`settings.language.${l}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-mode">
        <h2 id="s-mode" className="text-lg font-bold">
          {t("settings.mode")}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {(["simple", "full"] as const).map((m) => (
            <button key={m} className="tile !min-h-[96px]" aria-pressed={p.mode === m} onClick={() => save({ mode: m }, true)}>
              <span>{t(`settings.mode.${m}`)}</span>
              <span className="text-xs font-normal text-muted">{t(`settings.mode.${m}.body` as Key)}</span>
            </button>
          ))}
        </div>
      </section>

      <NotificationsPanel />

      <Link href="/settings/delivery" className="card flex min-h-[56px] items-center justify-between gap-3 p-5">
        <span>
          <span className="block text-lg font-bold">{t("delivery.link")}</span>
          <span className="block text-sm text-muted">{t("delivery.link.body")}</span>
        </span>
        <span aria-hidden>→</span>
      </Link>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-style">
        <h2 id="s-style" className="text-lg font-bold">
          {t("settings.style")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <button key={s} aria-pressed={p.nudge_style === s} className={chip(p.nudge_style === s)} onClick={() => save({ nudge_style: s })}>
              {t(`style.${s}`)}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">{t("settings.style.hint")}</p>
      </section>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-morning">
        <h2 id="s-morning" className="text-lg font-bold">
          {t("settings.morning")}
        </h2>
        <Toggle label={t("settings.morning")} on={p.morning_enabled} onChange={(v) => save({ morning_enabled: v })} />
        <div>
          <label htmlFor="morning-time" className="mb-1 block text-sm font-semibold text-muted">
            {t("settings.morning.time")}
          </label>
          <input id="morning-time" type="time" className="field" value={hhmm(p.morning_time)} onChange={(e) => e.target.value && save({ morning_time: e.target.value })} />
        </div>
      </section>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-quiet">
        <h2 id="s-quiet" className="text-lg font-bold">
          {t("settings.quiet")}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="quiet-from" className="mb-1 block text-sm font-semibold text-muted">
              {t("settings.quiet.from")}
            </label>
            <input id="quiet-from" type="time" className="field" value={hhmm(p.quiet_start)} onChange={(e) => e.target.value && save({ quiet_start: e.target.value })} />
          </div>
          <div>
            <label htmlFor="quiet-to" className="mb-1 block text-sm font-semibold text-muted">
              {t("settings.quiet.to")}
            </label>
            <input id="quiet-to" type="time" className="field" value={hhmm(p.quiet_end)} onChange={(e) => e.target.value && save({ quiet_end: e.target.value })} />
          </div>
        </div>
        <Toggle label={t("settings.quiet.urgent")} body={t("settings.quiet.urgent.body")} on={p.urgent_override} onChange={(v) => save({ urgent_override: v })} />
      </section>

      <section className="card flex flex-col gap-1 p-5" aria-labelledby="s-types">
        <h2 id="s-types" className="mb-2 text-lg font-bold">
          {t("settings.types")}
        </h2>
        {TYPES.map((ty) => (
          <Toggle
            key={ty}
            label={t(`type.${ty}`)}
            on={p.type_switches[ty] !== false}
            onChange={(v) => save({ type_switches: { ...p.type_switches, [ty]: v } })}
          />
        ))}
      </section>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-spaces">
        <h2 id="s-spaces" className="text-lg font-bold">
          {t("settings.spaces")}
        </h2>
        <ul className="flex flex-col gap-2">
          {spaces.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                {s.emoji} {s.is_default && s.name === "Personal" ? t("space.personal") : s.name}
              </span>
              <span className="flex items-center gap-2">
                <label className="flex min-h-[44px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#e8590c]"
                    checked={s.notifications_enabled}
                    onChange={(e) => start(async () => { await updateSpace(s.id, { notifications_enabled: e.target.checked }); router.refresh(); })}
                  />
                  {t("space.mute")}
                </label>
                {!s.is_default && (
                  <button
                    className="btn-quiet"
                    aria-label={`${t("space.delete")}: ${s.name}`}
                    onClick={() => start(async () => { await deleteSpace(s.id); router.refresh(); })}
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newSpace.trim()) return;
            start(async () => {
              const r = await createSpace({ name: newSpace });
              if (r.ok) {
                setNewSpace("");
                router.refresh();
              } else setError(t("common.error"));
            });
          }}
        >
          <label htmlFor="new-space" className="sr-only">
            {t("space.name")}
          </label>
          <input id="new-space" className="field" placeholder={t("space.name")} value={newSpace} maxLength={40} onChange={(e) => setNewSpace(e.target.value)} />
          <button className="btn-quiet flex-none" type="submit">
            {t("space.add")}
          </button>
        </form>
      </section>

      <section className="card flex flex-col gap-1 p-5" aria-labelledby="s-feat">
        <h2 id="s-feat" className="mb-1 text-lg font-bold">
          {t("settings.features")}
        </h2>
        <p className="mb-2 text-sm text-muted">{t("settings.features.body")}</p>
        {FEATURE_KEYS.map((k) => (
          <Toggle
            key={k}
            label={t(`feature.${k}` as Key)}
            body={t(`feature.${k}.body` as Key)}
            on={p.features?.[k] === true}
            onChange={(v) => save({ features: { ...(p.features ?? {}), [k]: v } }, true)}
          />
        ))}
      </section>

      {p.features?.feeds === true && <FeedsSection feeds={feeds} />}
      {p.features?.school === true && <HomeworkTiming prefs={p.prefs ?? {}} />}
      {p.features?.school === true && <ClassroomSection feeds={classroomFeeds} courses={courses} />}
      {p.features?.habits === true && <HabitPrefs prefs={p.prefs ?? {}} />}
      {p.features?.inbox === true && <TokensSection tokens={tokens} endpoint={endpoint} />}
      {p.features?.bills === true && <BillsSection feeds={billsFeeds} />}

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-tz">
        <h2 id="s-tz" className="text-lg font-bold">
          {t("settings.timezone")}
        </h2>
        <p className="text-sm">{p.timezone}</p>
        {/* The phone's own zone is only known in the browser, so it appears after the page loads (no server/phone mismatch). */}
        {deviceTz && deviceTz !== p.timezone && (
          <button className="btn-quiet w-full" onClick={() => save({ timezone: deviceTz }, true)}>
            {t("settings.timezone.use", { zone: deviceTz })}
          </button>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-data">
        <h2 id="s-data" className="text-lg font-bold">
          {t("settings.data")}
        </h2>
        <a className="btn-quiet w-full" href="/api/export?format=json" download>
          {t("settings.export")}
        </a>
        <a className="btn-quiet w-full" href="/api/export?format=csv" download>
          {t("settings.exportCsv")}
        </a>
        <div className="flex gap-4 text-sm">
          <Link href="/privacy" className="min-h-[44px] py-3 underline">
            {t("settings.privacy")}
          </Link>
          <Link href="/terms" className="min-h-[44px] py-3 underline">
            {t("settings.terms")}
          </Link>
        </div>
      </section>

      <form action={signOut}>
        <button className="btn-quiet w-full">{t("action.signOut")}</button>
      </form>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-del">
        <h2 id="s-del" className="text-lg font-bold text-late-ink">
          {t("settings.deleteAccount")}
        </h2>
        {!deleteOpen ? (
          <button className="btn-quiet w-full text-late-ink" onClick={() => setDeleteOpen(true)}>
            {t("settings.deleteAccount")}
          </button>
        ) : (
          <>
            <p className="text-sm">{t("settings.deleteAccount.body")}</p>
            <label htmlFor="del-word" className="sr-only">
              {t("settings.deleteAccount.word")}
            </label>
            <input id="del-word" className="field" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} />
            <button
              className="btn-quiet w-full border-late-ink text-late-ink"
              disabled={confirmWord.trim().toUpperCase() !== t("settings.deleteAccount.word") || pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteAccount(confirmWord);
                  if (r.ok) router.push("/login");
                  else setError(r.error === "setup" ? t("setup.title") : t(r.error));
                })
              }
            >
              {t("settings.deleteAccount.confirm")}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
