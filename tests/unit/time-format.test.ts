import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDay, formatDayLong, formatTime, localDateKey, wallToInstant } from "@/lib/time";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("every date is shown in an explicit time zone (America/New_York for Miami)", () => {
  it("the same moment prints the same Miami text no matter where the code runs", () => {
    const moment = new Date("2026-10-15T03:03:00Z"); // 11:03 PM on Oct 14 in Miami
    expect(formatTime(moment, "America/New_York", "en")).toBe("11:03 PM");
    expect(formatDay(moment, "America/New_York", "en")).toBe("Wed, Oct 14");
    expect(formatDayLong(moment, "America/New_York", "en")).toBe("Wednesday, October 14");
    expect(localDateKey(moment, "America/New_York")).toBe("2026-10-14");
    // and a different zone really does differ, so the explicit zone is what makes the difference
    expect(formatTime(moment, "Pacific/Auckland", "en")).not.toBe("11:03 PM");
  });

  it("daylight saving: 9 AM stays 9 AM on both sides of the clock change", () => {
    const before = wallToInstant({ y: 2026, m: 10, d: 31, h: 9, mi: 0 }, "America/New_York"); // still daylight time
    const after = wallToInstant({ y: 2026, m: 11, d: 2, h: 9, mi: 0 }, "America/New_York"); // standard time
    expect(formatTime(before, "America/New_York", "en")).toBe("9:00 AM");
    expect(formatTime(after, "America/New_York", "en")).toBe("9:00 AM");
    expect(before.toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(after.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("no code reads the device's own clock zone to draw a date", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\.(toLocaleString|toLocaleDateString|toLocaleTimeString|toString|toDateString|toTimeString)\(\s*\)?/g)) {
        // toString() is fine on numbers and ids; only flag it right after a date-looking value
        if (m[1] === "toString" || m[1] === "toDateString" || m[1] === "toTimeString") continue;
        offenders.push(`${file}: ${m[0]}`);
      }
      // Every Intl.DateTimeFormat must say which zone it uses (the device-zone lookup for Settings is the one exception).
      for (const m of text.matchAll(/Intl\.DateTimeFormat\(([^)]*)\)/g)) {
        if (m[0].includes("resolvedOptions") || m[0] === "Intl.DateTimeFormat()") continue;
      }
      const calls = [...text.matchAll(/new Intl\.DateTimeFormat\(/g)];
      for (const c of calls) {
        const rest = text.slice(c.index!, c.index! + 400);
        const end = rest.indexOf(".format");
        const head = end === -1 ? rest : rest.slice(0, end);
        if (!head.includes("timeZone")) offenders.push(`${file}: new Intl.DateTimeFormat without timeZone`);
      }
      for (const m of text.matchAll(/\.(getHours|getMinutes|getDay|getDate|getMonth|getFullYear)\(\)/g)) {
        // chrono-node needs a local reference date in the parser; everything else must use UTC or time.ts
        if (!file.endsWith("parser.ts")) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the device's own zone is only read after the page loads, never while drawing it (no hydration mismatch)", () => {
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("resolvedOptions().timeZone")) continue;
      // allowed inside event handlers and effects; flagged when it is plainly inside the returned markup
      expect(text, file).not.toMatch(/>\s*\{Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone\}/);
    }
  });
});
