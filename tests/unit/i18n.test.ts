import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { translate } from "@/lib/i18n";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("English and Spanish", () => {
  it("have exactly the same keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty words except deliberately empty title endings", () => {
    for (const [k, v] of Object.entries(es)) {
      if (!k.endsWith(".post")) expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it("use the same {placeholders} in both languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(es[k]), k).toEqual(vars(en[k]));
    }
  });

  it("every t(\"key\") used in the code exists", () => {
    const missing: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bt\(\s*["'`]([a-zA-Z0-9_.]+)["'`]/g)) {
        if (!(m[1] in en)) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("fills in placeholders", () => {
    expect(translate("es", "login.codeSent", { email: "a@b.co" })).toContain("a@b.co");
    expect(translate("en", "today.summary.today.many", { n: 3 })).toBe("3 things today");
  });
});
