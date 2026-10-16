"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { updateProfile } from "@/app/actions";
import { AccentTitle } from "@/components/accent-title";
import { NotificationsPanel } from "@/components/notifications-panel";
import { APP_NAME } from "@/lib/config";
import { makeT, type Key, type Lang } from "@/lib/i18n";

type Step = "welcome" | "track" | "nudge" | "times" | "quiet" | "notif" | "mode" | "ring" | "done";
const FLOW: Step[] = ["track", "nudge", "times", "quiet", "notif", "mode"];

// Quiet hours are a choice of their own, so nobody finds out about them by accident.
type QuietChoice = "night" | "late" | "custom" | "off";
const QUIET: { id: QuietChoice; emoji: string; label: Key; from: string; to: string }[] = [
  { id: "night", emoji: "🌙", label: "onb.quiet.night", from: "22:00", to: "07:00" },
  { id: "late", emoji: "🛌", label: "onb.quiet.late", from: "23:00", to: "08:00" },
  { id: "custom", emoji: "🎛️", label: "onb.quiet.custom", from: "22:00", to: "07:00" },
  { id: "off", emoji: "🔔", label: "onb.quiet.off", from: "00:00", to: "00:00" },
];

type TrackId = "homework" | "payments" | "packages" | "tasks" | "work" | "habits" | "birthdays" | "renewals";
const TRACK: { id: TrackId; emoji: string; label: Key }[] = [
  { id: "homework", emoji: "📚", label: "onb.track.homework" },
  { id: "payments", emoji: "💳", label: "onb.track.payments" },
  { id: "packages", emoji: "📦", label: "onb.track.packages" },
  { id: "tasks", emoji: "✅", label: "onb.track.tasks" },
  { id: "work", emoji: "💼", label: "onb.track.work" },
  { id: "habits", emoji: "🌱", label: "onb.track.habits" },
  { id: "birthdays", emoji: "🎂", label: "onb.track.birthdays" },
  { id: "renewals", emoji: "🪪", label: "onb.track.renewals" },
];
// Picking one of these in the first step switches that kind of reminder on (it is off until then).
const TRACK_FEATURES: TrackId[] = ["work", "habits", "birthdays", "renewals"];
const NUDGE: { id: "morning" | "on_time" | "before" | "important"; emoji: string; label: Key }[] = [
  { id: "morning", emoji: "🌅", label: "onb.nudge.morning" },
  { id: "on_time", emoji: "⏰", label: "onb.nudge.on_time" },
  { id: "before", emoji: "🔔", label: "onb.nudge.before" },
  { id: "important", emoji: "🤫", label: "onb.nudge.important" },
];

export function Onboarding({ startLang }: { startLang: Lang }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(startLang);
  const t = makeT(lang);
  const [step, setStep] = useState<Step>("welcome");
  const [track, setTrack] = useState<string[]>([]);
  const [style, setStyle] = useState<"morning" | "on_time" | "before" | "important">("on_time");
  const [morning, setMorning] = useState("08:00");
  const [quietFrom, setQuietFrom] = useState("22:00");
  const [quietTo, setQuietTo] = useState("07:00");
  const [quietChoice, setQuietChoice] = useState<QuietChoice>("night");
  const [urgent, setUrgent] = useState(true);
  const [mode, setMode] = useState<"simple" | "full">("full");
  const [error, setError] = useState("");

  const index = FLOW.indexOf(step);
  const next = () => setStep(FLOW[index + 1] ?? "ring");
  const back = () => setStep(index <= 0 ? "welcome" : FLOW[index - 1]);

  async function finish() {
    setStep("ring");
    setError("");
    const r = await updateProfile({
      language: lang,
      track_types: track as TrackId[],
      features: Object.fromEntries(TRACK_FEATURES.filter((f) => track.includes(f)).map((f) => [f, true])),
      nudge_style: style,
      morning_enabled: true,
      morning_time: morning,
      quiet_start: quietFrom,
      quiet_end: quietTo,
      urgent_override: urgent,
      mode,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      onboarded: true,
    }, true);
    if (!r.ok) {
      setError(t("common.error"));
      setStep("mode");
    }
  }

  // The "Setting things up…" ring: 2.5 seconds, or skip.
  useEffect(() => {
    if (step !== "ring") return;
    const id = setTimeout(() => setStep("done"), 2500);
    return () => clearTimeout(id);
  }, [step]);

  const tile = (on: boolean, role: "checkbox" | "radio") => ({ role, "aria-checked": on, className: "tile" });

  const pill =
    index >= 0 ? (
      <div className="flex items-center gap-3" role="status">
        <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-accent-text">{t("onb.step", { n: index + 1, total: FLOW.length })}</span>
        <span aria-hidden className="flex gap-1.5">
          {FLOW.map((s, i) => (
            <span key={s} className={`h-2 w-2 rounded-full ${i <= index ? "bg-accent" : "bg-line"}`} />
          ))}
        </span>
      </div>
    ) : null;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-6 px-4 pb-10 pt-8">
      {step === "welcome" && (
        <>
          <div className="flex justify-end gap-2" role="group" aria-label="Language / Idioma">
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                aria-pressed={lang === l}
                className={`min-h-[44px] rounded-full border px-4 text-sm font-semibold ${lang === l ? "border-accent bg-accent-soft" : "border-line bg-white"}`}
                onClick={() => setLang(l)}
              >
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
          <div className="slide-in flex flex-1 flex-col justify-center gap-4">
            <span aria-hidden className="text-6xl">
              🔔
            </span>
            <AccentTitle pre={t("onb.welcome.title.pre")} accent={APP_NAME} />
            <p className="text-lg text-muted">{t("onb.welcome.subtitle")}</p>
          </div>
          <button className="btn-primary" onClick={() => setStep("track")}>
            {t("onb.start")} →
          </button>
        </>
      )}

      {step === "track" && (
        <section className="slide-in flex flex-1 flex-col gap-5" aria-labelledby="ob-h">
          {pill}
          <div id="ob-h">
            <AccentTitle pre={t("onb.track.title.pre")} accent={t("onb.track.title.accent")} post={t("onb.track.title.post")} as="h1" />
            <p className="mt-2 text-muted">{t("onb.track.subtitle")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="ob-h">
            {TRACK.map((o) => {
              const on = track.includes(o.id);
              return (
                <button
                  key={o.id}
                  {...tile(on, "checkbox")}
                  onClick={() => setTrack((cur) => (on ? cur.filter((x) => x !== o.id) : [...cur, o.id]))}
                >
                  <span aria-hidden className="text-4xl">
                    {o.emoji}
                  </span>
                  {t(o.label)}
                  {on && <span aria-hidden className="absolute right-3 top-3 text-accent-text">✓</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <button className="btn-primary" onClick={next}>
              {t("action.next")} →
            </button>
            <button className="btn-quiet" onClick={back}>
              {t("action.back")}
            </button>
          </div>
        </section>
      )}

      {step === "nudge" && (
        <section className="slide-in flex flex-1 flex-col gap-5" aria-labelledby="ob-h">
          {pill}
          <div id="ob-h">
            <AccentTitle pre={t("onb.nudge.title.pre")} accent={t("onb.nudge.title.accent")} post={t("onb.nudge.title.post")} />
            <p className="mt-2 text-muted">{t("onb.nudge.subtitle")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="ob-h">
            {NUDGE.map((o) => (
              <button key={o.id} {...tile(style === o.id, "radio")} onClick={() => setStyle(o.id)}>
                <span aria-hidden className="text-4xl">
                  {o.emoji}
                </span>
                {t(o.label)}
                {style === o.id && <span aria-hidden className="absolute right-3 top-3 text-accent-text">✓</span>}
              </button>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <button className="btn-primary" onClick={next}>
              {t("action.next")} →
            </button>
            <button className="btn-quiet" onClick={back}>
              {t("action.back")}
            </button>
          </div>
        </section>
      )}

      {step === "times" && (
        <section className="slide-in flex flex-1 flex-col gap-5" aria-labelledby="ob-h">
          {pill}
          <div id="ob-h">
            <AccentTitle pre={t("onb.times.title.pre")} accent={t("onb.times.title.accent")} post={t("onb.times.title.post")} />
            <p className="mt-2 text-muted">{t("onb.times.subtitle")}</p>
          </div>
          <div className="card flex flex-col gap-4 p-5">
            <div>
              <label htmlFor="ob-morning" className="mb-1 block text-sm font-semibold text-muted">
                {t("onb.times.morning")}
              </label>
              <input id="ob-morning" type="time" className="field" value={morning} onChange={(e) => e.target.value && setMorning(e.target.value)} />
            </div>
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <button className="btn-primary" onClick={next}>
              {t("action.next")} →
            </button>
            <button className="btn-quiet" onClick={back}>
              {t("action.back")}
            </button>
          </div>
        </section>
      )}

      {step === "quiet" && (
        <section className="slide-in flex flex-1 flex-col gap-5" aria-labelledby="ob-h">
          {pill}
          <div id="ob-h">
            <AccentTitle pre={t("onb.quiet.title.pre")} accent={t("onb.quiet.title.accent")} post={t("onb.quiet.title.post")} />
            <p className="mt-2 text-muted">{t("onb.quiet.subtitle")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="ob-h">
            {QUIET.map((o) => (
              <button
                key={o.id}
                {...tile(quietChoice === o.id, "radio")}
                onClick={() => {
                  setQuietChoice(o.id);
                  setQuietFrom(o.from);
                  setQuietTo(o.to);
                }}
              >
                <span aria-hidden className="text-4xl">
                  {o.emoji}
                </span>
                {t(o.label)}
                {quietChoice === o.id && <span aria-hidden className="absolute right-3 top-3 text-accent-text">✓</span>}
              </button>
            ))}
          </div>
          {quietChoice === "custom" && (
            <div className="card grid grid-cols-2 gap-3 p-5">
              <div>
                <label htmlFor="ob-qf" className="mb-1 block text-sm font-semibold text-muted">
                  {t("onb.times.quietFrom")}
                </label>
                <input id="ob-qf" type="time" className="field" value={quietFrom} onChange={(e) => e.target.value && setQuietFrom(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ob-qt" className="mb-1 block text-sm font-semibold text-muted">
                  {t("onb.times.quietTo")}
                </label>
                <input id="ob-qt" type="time" className="field" value={quietTo} onChange={(e) => e.target.value && setQuietTo(e.target.value)} />
              </div>
            </div>
          )}
          {quietChoice !== "off" && (
            <label className="card flex items-start gap-3 p-4">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[#e8590c]" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
              <span>
                <span className="block font-semibold">{t("settings.quiet.urgent")}</span>
                <span className="text-sm text-muted">{t("settings.quiet.urgent.body")}</span>
              </span>
            </label>
          )}
          <p className="text-sm text-muted">{t("onb.quiet.note")}</p>
          <div className="mt-auto flex flex-col gap-3">
            <button className="btn-primary" onClick={next}>
              {t("action.next")} →
            </button>
            <button className="btn-quiet" onClick={back}>
              {t("action.back")}
            </button>
          </div>
        </section>
      )}

      {step === "notif" && (
        <section className="slide-in flex flex-1 flex-col gap-5" aria-labelledby="ob-h">
          {pill}
          <div id="ob-h">
            <AccentTitle pre={t("onb.notif.title.pre")} accent={t("onb.notif.title.accent")} />
            <p className="mt-2 text-muted">{t("onb.notif.subtitle")}</p>
          </div>
          <div className="card p-5">
            <NotificationsPanel bare showTest={false} />
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <button className="btn-primary" onClick={next}>
              {t("action.next")} →
            </button>
            <button className="btn-quiet" onClick={next}>
              {t("onb.notif.skip")}
            </button>
          </div>
        </section>
      )}

      {step === "mode" && (
        <section className="slide-in flex flex-1 flex-col gap-5" aria-labelledby="ob-h">
          {pill}
          <div id="ob-h">
            <AccentTitle pre={t("onb.mode.title.pre")} accent={t("onb.mode.title.accent")} post={t("onb.mode.title.post")} />
            <p className="mt-2 text-muted">{t("onb.mode.subtitle")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="ob-h">
            {(["simple", "full"] as const).map((m) => (
              <button key={m} {...tile(mode === m, "radio")} onClick={() => setMode(m)}>
                <span aria-hidden className="text-4xl">
                  {m === "simple" ? "🍃" : "🧰"}
                </span>
                {t(`settings.mode.${m}`)}
                <span className="text-xs font-normal text-muted">{t(`settings.mode.${m}.body` as Key)}</span>
                {mode === m && <span aria-hidden className="absolute right-3 top-3 text-accent-text">✓</span>}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm font-semibold text-late-ink">
              {error}
            </p>
          )}
          <div className="mt-auto flex flex-col gap-3">
            <button className="btn-primary" onClick={finish}>
              {t("onb.finish")} →
            </button>
            <button className="btn-quiet" onClick={back}>
              {t("action.back")}
            </button>
          </div>
        </section>
      )}

      {step === "ring" && (
        <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center" aria-live="polite">
          <div className="ring" aria-hidden />
          <p className="text-xl font-bold">{t("onb.setting")}</p>
          <button className="btn-quiet" onClick={() => setStep("done")}>
            {t("onb.skip")}
          </button>
        </section>
      )}

      {step === "done" && (
        <section className="slide-in flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[2rem] font-extrabold">{t("onb.done.title")}</h1>
          <p className="text-lg text-muted">{t("onb.done.body")}</p>
          <button
            className="btn-primary mt-4"
            onClick={() => {
              document.cookie = `nudge-lang=${lang}; path=/; max-age=31536000; samesite=lax`;
              router.push("/");
              router.refresh();
            }}
          >
            {t("onb.done.go")} →
          </button>
        </section>
      )}
    </main>
  );
}
