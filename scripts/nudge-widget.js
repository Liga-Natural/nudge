// Nudge widgets for Scriptable (free app: https://scriptable.app). One script draws all of them.
//
// SET UP (the full steps are in docs/WIDGETS.md)
//   1. In Nudge: Settings > Home Screen widgets > Create widget token. Copy it.
//   2. Paste it between the quotes on the TOKEN line below. (Nudge's "Copy script" button
//      already fills in NUDGE_URL for you.)
//   3. Long-press the Home Screen > + > Scriptable > pick a size > Edit Widget:
//        Script = this script, When Interacting = Open URL.
//   4. In "Parameter" type the widget you want:
//        next      Next up, with a countdown and the class emoji
//        today     today's list (next 4) with done / late marks
//        school    next 3 homework, and a red "Missing (n)" badge
//        grades    each class's current-quarter letter in a small grid
//        week      7-day strip with a count per day (best as Large)
//        habits    today's habits with streaks
//        rotate    a different card each refresh: next, school, grades, habits
//   SMART STACK: add Small widgets with the Parameters  next  today  school  grades, stack them,
//      long-press the stack > Edit Stack > turn on Smart Rotate.
//   5. Lock Screen: long-press it > Customize > add a Scriptable widget. Inline shows the next thing,
//      the circle shows today's progress, the rectangle shows the next 2 items.
//
// The token can only READ a small summary. Revoke it any time in Nudge (Settings > Home Screen widgets).
// Light and dark follow your iPhone. If Nudge can't be reached the last saved data is shown.

const NUDGE_URL = "__NUDGE_URL__"; // for example https://nudge.example.com
const TOKEN = ""; // looks like ndw_...

// ---------------------------------------------------------------------------------------------

// [light, dark] - the same colours as the app
const P = {
  bg: ["#faf8f5", "#15120f"],
  card: ["#ffffff", "#211d1a"],
  ink: ["#1c1917", "#f4efe9"],
  muted: ["#6b6560", "#a8a098"],
  line: ["#e7e2db", "#38332e"],
  accent: ["#e8590c", "#ff9a5c"],
  coral: ["#e5484d", "#ff7a7f"],
  soft: ["#fff1e6", "#3a2314"],
  late: ["#b42318", "#ff8f85"],
  lateBg: ["#fdecec", "#3a1b1b"],
  ok: ["#2f8f5b", "#4caf7d"],
};
const col = (pair) => {
  if (pair && typeof pair === "object" && !Array.isArray(pair)) return pair;
  if (typeof pair === "string") return new Color(pair);
  return Color.dynamic(new Color(pair[0]), new Color(pair[1]));
};

// <PARSE>
var TYPES = ["next", "today", "school", "grades", "week", "habits", "rotate"];
function parseParam(rawIn) {
  var raw = (rawIn == null ? "" : String(rawIn)).split("|");
  for (var i = 0; i < raw.length; i++) {
    var low = raw[i].trim().toLowerCase();
    if (TYPES.indexOf(low) >= 0) return low;
  }
  return "next";
}
// </PARSE>

// <ROTATE>
var ROTATION = ["next", "school", "grades", "habits"];
// Which card comes after `last`, skipping cards that have nothing to show. `has` says which have something.
function pickRotation(last, has) {
  var from = ROTATION.indexOf(last);
  for (var step = 1; step <= ROTATION.length; step++) {
    var card = ROTATION[(from + step + ROTATION.length) % ROTATION.length];
    if (has[card]) return card;
  }
  return "next";
}
// </ROTATE>

const PAGE = { next: "/", today: "/", school: "/school", grades: "/grades", week: "/upcoming", habits: "/habits" };

// ---- loading -----------------------------------------------------------------------------------
const fm = FileManager.local();
const cachePath = () => fm.joinPath(fm.documentsDirectory(), "nudge-widget.json");

async function load() {
  let saved = null;
  try {
    if (fm.fileExists(cachePath())) saved = JSON.parse(fm.readString(cachePath()));
  } catch {
    saved = null; // a damaged cache file is ignored
  }
  if (!TOKEN) return { saved, error: "Add your widget token to the script." };
  if (NUDGE_URL.indexOf("__") === 0) return { saved, error: "Set NUDGE_URL in the script." };
  try {
    const req = new Request(NUDGE_URL + "/api/widget");
    req.headers = { Authorization: "Bearer " + TOKEN, Accept: "application/json" };
    req.timeoutInterval = 12;
    const json = await req.loadJSON();
    const status = req.response ? req.response.statusCode : 0;
    if (status === 200 && json && json.v === 1) {
      const entry = { savedAt: new Date().toISOString(), data: json };
      fm.writeString(cachePath(), JSON.stringify(entry));
      return { data: json, savedAt: entry.savedAt, saved: entry };
    }
    if (status === 401) return { saved, error: "This token was revoked or is wrong." };
    if (status === 429) return { saved, error: "Too many refreshes. Try again soon." };
    throw new Error("HTTP " + status);
  } catch {
    return { saved, error: "Can't reach Nudge." };
  }
}

// ---- formatting --------------------------------------------------------------------------------
function fmt(date, pattern) {
  const f = new DateFormatter();
  f.dateFormat = pattern;
  return f.string(date);
}
const clock = (iso) => fmt(new Date(iso), "h:mm a");
function dueText(item) {
  const d = new Date(item.dueAt);
  const now = new Date();
  const dayKey = (x) => x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate();
  const tomorrow = new Date(now.getTime() + 86400000);
  const day = dayKey(d) === dayKey(now) ? "" : dayKey(d) === dayKey(tomorrow) ? "Tomorrow" : fmt(d, "EEE");
  const time = item.allDay ? "" : clock(item.dueAt);
  return (day && time ? day + " " : day) + time || "Today";
}
function countdown(iso) {
  const mins = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 60000));
  if (mins < 1) return "now";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return d + "d " + h + "h";
  if (h > 0) return h + "h " + (m ? m + "m" : "");
  return m + "m";
}
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---- drawing helpers ---------------------------------------------------------------------------
function text(parent, s, size, color, o) {
  o = o || {};
  const t = parent.addText(String(s));
  t.font = o.bold ? Font.boldSystemFont(size) : o.medium ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = col(color);
  t.lineLimit = o.lines || 1;
  t.minimumScaleFactor = o.scale || 0.7;
  return t;
}
function header(w, label, emoji, right, rightColor) {
  const r = w.addStack();
  r.centerAlignContent();
  text(r, (emoji ? emoji + " " : "") + label.toUpperCase(), 11, P.accent, { bold: true });
  r.addSpacer();
  if (right) text(r, right, 11, rightColor || P.muted, { bold: true });
  w.addSpacer(6);
}
function footer(w, info) {
  w.addSpacer();
  const note = (info.offline ? "offline · " : "") + "updated " + clock(info.at);
  text(w, note, 9, P.muted, { scale: 0.6 });
}
function ring(pct, size, thick, bgColor) {
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const c = size / 2;
  const steps = 60;
  const dot = (angle, color, w) => {
    const x = c + (c - thick / 2) * Math.sin(angle);
    const y = c - (c - thick / 2) * Math.cos(angle);
    dc.setFillColor(color);
    dc.fillEllipse(new Rect(x - w / 2, y - w / 2, w, w));
  };
  for (let i = 0; i < steps; i++) dot((i / steps) * 2 * Math.PI, bgColor, thick);
  const n = Math.max(0, Math.min(1, pct)) * steps;
  for (let i = 0; i < n; i++) dot((i / steps) * 2 * Math.PI, col(P.accent), thick);
  return dc.getImage();
}
function itemRow(parent, it, size, withTime) {
  const r = parent.addStack();
  r.centerAlignContent();
  r.spacing = 6;
  const mark = it.done ? "✓" : it.late ? "!" : it.emoji;
  const m = text(r, mark, size, it.done ? P.ok : it.late ? P.late : P.ink, { bold: it.done || it.late });
  m.minimumScaleFactor = 1;
  const t = text(r, it.title, size, it.done ? P.muted : P.ink, { medium: true });
  if (it.done) t.textColor = col(P.muted);
  r.addSpacer();
  if (withTime) text(r, it.done ? "done" : dueText(it), size - 2, it.late ? P.late : P.muted, { medium: true, scale: 0.6 });
  return r;
}
function empty(w, emoji, line) {
  w.addSpacer();
  const t = w.addText(emoji);
  t.font = Font.systemFont(28);
  text(w, line, 13, P.muted, { lines: 2 });
  w.addSpacer();
}

// ---- the cards ---------------------------------------------------------------------------------
function cardNext(w, d, fam, info) {
  const n = d.next;
  header(w, "Next up", "", d.progress.total ? d.progress.done + "/" + d.progress.total : "");
  if (!n) return empty(w, "🌤️", "Nothing coming up. Enjoy it!");
  const big = fam === "small";
  const top = w.addStack();
  top.centerAlignContent();
  top.spacing = 8;
  const em = top.addText(n.emoji);
  em.font = Font.systemFont(big ? 26 : 34);
  const col2 = top.addStack();
  col2.layoutVertically();
  text(col2, n.title, big ? 14 : 17, P.ink, { bold: true, lines: 2 });
  if (n.course) text(col2, n.course.replace(/^p\d+\s*/i, ""), 11, P.muted);
  w.addSpacer(6);
  text(w, "in " + countdown(n.dueAt), big ? 20 : 26, P.accent, { bold: true });
  text(w, dueText(n), 12, P.muted, { medium: true });
  if (fam === "large") {
    w.addSpacer(10);
    for (const it of d.today.items.filter((x) => x.dueAt !== n.dueAt || x.title !== n.title).slice(0, 4)) itemRow(w, it, 13, true);
  }
  footer(w, info);
}

function cardToday(w, d, fam, info) {
  header(w, "Today", "", d.progress.total ? d.progress.done + "/" + d.progress.total + " done" : "");
  const rows = d.today.items.slice(0, fam === "small" ? 3 : 4);
  if (!rows.length) return empty(w, "🎉", "All clear today.");
  for (const it of rows) {
    itemRow(w, it, fam === "small" ? 12 : 14, fam !== "small");
    w.addSpacer(4);
  }
  footer(w, info);
}

function cardSchool(w, d, fam, info) {
  header(w, "School", "📚", d.school.missing > 0 ? "Missing (" + d.school.missing + ")" : "", P.late);
  if (!d.school.items.length) return empty(w, "🎉", "No homework. Nice!");
  for (const it of d.school.items.slice(0, 3)) {
    itemRow(w, it, fam === "small" ? 12 : 14, fam !== "small");
    if (fam !== "small" && it.course) text(w, "   " + it.course.replace(/^p\d+\s*/i, ""), 10, P.muted);
    w.addSpacer(4);
  }
  footer(w, info);
}

function cardGrades(w, d, fam, info) {
  header(w, "Grades", "📝", d.gradesTerm ? d.gradesTerm.toUpperCase() : "");
  if (!d.grades.length) return empty(w, "📝", "No grades yet.");
  const per = fam === "small" ? 2 : fam === "medium" ? 3 : 4;
  const max = fam === "small" ? 4 : fam === "medium" ? 6 : 12;
  const cells = d.grades.slice(0, max);
  for (let i = 0; i < cells.length; i += per) {
    const r = w.addStack();
    r.spacing = 6;
    for (const g of cells.slice(i, i + per)) {
      const c = r.addStack();
      c.layoutVertically();
      c.centerAlignContent();
      c.setPadding(5, 6, 5, 6);
      c.cornerRadius = 12;
      c.backgroundColor = new Color(g.color);
      const top = c.addStack();
      top.centerAlignContent();
      const e = top.addText(g.emoji);
      e.font = Font.systemFont(12);
      top.addSpacer(3);
      const l = top.addText(g.text);
      l.font = Font.boldSystemFont(fam === "small" ? 18 : 20);
      l.textColor = new Color("#1c1917"); // class colours are light, so the text stays dark
      l.minimumScaleFactor = 0.6;
      const nm = c.addText(short(g.name, fam === "small" ? 9 : 11));
      nm.font = Font.mediumSystemFont(9);
      nm.textColor = new Color("#44403c");
    }
    w.addSpacer(5);
  }
  footer(w, info);
}

function cardWeek(w, d, fam, info) {
  header(w, "Week ahead", "📆", "");
  const max = Math.max(1, ...d.week.map((x) => x.count));
  const strip = w.addStack();
  strip.spacing = 5;
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  for (const day of d.week) {
    const c = strip.addStack();
    c.layoutVertically();
    c.centerAlignContent();
    c.setPadding(6, 0, 6, 0);
    c.cornerRadius = 12;
    c.backgroundColor = col(day.today ? P.soft : P.card);
    c.size = new Size(0, fam === "large" ? 96 : 62);
    const dn = c.addText(names[day.dow]);
    dn.font = Font.boldSystemFont(10);
    dn.textColor = col(P.muted);
    c.addSpacer(3);
    const busy = day.count >= 3 && day.count === max;
    const num = c.addText(String(day.count));
    num.font = Font.boldSystemFont(fam === "large" ? 22 : 17);
    num.textColor = col(busy ? P.coral : P.ink);
    if (fam === "large") {
      c.addSpacer(4);
      const bar = c.addStack();
      bar.size = new Size(8, Math.max(3, Math.round((day.count / max) * 30)));
      bar.cornerRadius = 4;
      bar.backgroundColor = col(busy ? P.coral : P.accent);
    }
  }
  if (fam === "large") {
    w.addSpacer(12);
    for (const it of d.today.items.slice(0, 4)) {
      itemRow(w, it, 13, true);
      w.addSpacer(3);
    }
  }
  footer(w, info);
}

function cardHabits(w, d, fam, info) {
  header(w, "Habits", "🌱", d.habits.length ? d.habits.filter((h) => h.done).length + "/" + d.habits.length : "");
  if (!d.habits.length) return empty(w, "🌱", "No habits today.");
  const r = w.addStack();
  r.spacing = 8;
  for (const h of d.habits.slice(0, fam === "small" ? 3 : 5)) {
    const c = r.addStack();
    c.layoutVertically();
    c.centerAlignContent();
    const circle = c.addStack();
    circle.size = new Size(40, 40);
    circle.cornerRadius = 20;
    circle.centerAlignContent();
    circle.backgroundColor = col(h.done ? P.accent : P.card);
    circle.addSpacer();
    const e = circle.addText(h.done ? "✓" : h.emoji);
    e.font = Font.boldSystemFont(18);
    e.textColor = h.done ? new Color("#ffffff") : col(P.ink);
    circle.addSpacer();
    if (h.streak > 0) {
      const s = c.addText("🔥" + h.streak);
      s.font = Font.boldSystemFont(10);
      s.textColor = col(P.ink);
    }
  }
  footer(w, info);
}

const CARDS = { next: cardNext, today: cardToday, school: cardSchool, grades: cardGrades, week: cardWeek, habits: cardHabits };

// ---- Lock Screen -------------------------------------------------------------------------------
function lockScreen(fam, d) {
  const w = new ListWidget();
  const n = d.next;
  if (fam === "accessoryInline") {
    w.addText(n ? "Next: " + short(n.title, 22) + " " + (n.allDay ? "" : clock(n.dueAt)) : "Nothing next");
  } else if (fam === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const total = d.progress.total || 0;
    const pct = total ? d.progress.done / total : 0;
    const img = w.addImage(ring(pct, 60, 7, new Color("#ffffff", 0.25)));
    img.imageSize = new Size(42, 42);
    img.centerAlignImage();
    const t = w.addText(d.progress.done + "/" + total);
    t.font = Font.boldSystemFont(11);
    t.centerAlignText();
  } else {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText("NEXT UP");
    t.font = Font.boldSystemFont(10);
    const items = [n].concat(d.today.items.filter((x) => n && (x.title !== n.title || x.dueAt !== n.dueAt))).filter(Boolean).slice(0, 2);
    if (!items.length) w.addText("Nothing next");
    for (const it of items) {
      const l = w.addText(short(it.title, 22) + (it.allDay ? "" : " · " + clock(it.dueAt)));
      l.font = Font.mediumSystemFont(12);
      l.lineLimit = 1;
    }
  }
  w.url = NUDGE_URL + "/";
  w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  return w;
}

// ---- main --------------------------------------------------------------------------------------
function messageWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = col(P.bg);
  header(w, "Nudge", "", "");
  w.addSpacer();
  text(w, msg, 13, P.ink, { lines: 4, bold: true });
  w.addSpacer();
  w.url = NUDGE_URL.indexOf("__") === 0 ? "https://nudge.invalid" : NUDGE_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  return w;
}

async function main() {
  const fam = config.widgetFamily || "medium";
  const r = await load();
  const entry = r.saved && r.saved.data ? r.saved : null;
  const data = r.data || (entry && entry.data);
  let w;
  if (!data) {
    w = messageWidget(r.error || "No data yet.");
  } else if (fam.indexOf("accessory") === 0) {
    w = lockScreen(fam, data);
  } else {
    let type = parseParam(args.widgetParameter);
    if (type === "rotate") {
      const rotFile = fm.joinPath(fm.documentsDirectory(), "nudge-widget-rotate.json");
      let last = "habits";
      try {
        if (fm.fileExists(rotFile)) last = JSON.parse(fm.readString(rotFile)).last || last;
      } catch {
        last = "habits";
      }
      type = pickRotation(last, {
        next: !!data.next,
        school: data.school.items.length > 0 || data.school.missing > 0,
        grades: data.grades.length > 0,
        habits: data.habits.length > 0,
      });
      fm.writeString(rotFile, JSON.stringify({ last: type }));
    }
    w = new ListWidget();
    w.backgroundColor = col(P.bg);
    w.setPadding(12, 14, 10, 14);
    const at = r.data ? r.savedAt : entry.savedAt;
    CARDS[type](w, data, fam, { offline: !r.data, at: at });
    if (!r.data && r.error) {
      // Offline or refused: the last saved data is still shown, with the reason under it.
      const note = w.addText(r.error);
      note.font = Font.mediumSystemFont(9);
      note.textColor = col(P.late);
    }
    w.url = NUDGE_URL + (PAGE[type] || "/");
    w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  }
  if (config.runsInWidget) Script.setWidget(w);
  else if (fam.indexOf("accessory") === 0) await w.presentSmall();
  else await w.presentMedium();
  Script.complete();
}

await main();
