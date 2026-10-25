import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/nudge-widget.js", "utf8");

// The script is plain JavaScript for the Scriptable app. These tests pull out its small pure parts
// (between the <NAME> markers) and run them, the same way the Joker widget is tested.
function section(name: string): string {
  const m = new RegExp(`// <${name}>\\n([\\s\\S]*?)// </${name}>`).exec(script);
  if (!m) throw new Error(`no ${name} section`);
  return m[1];
}

const parse = new Function(`${section("PARSE")}; return { parseParam, TYPES };`)() as { parseParam: (s: unknown) => string; TYPES: string[] };
const rot = new Function(`${section("ROTATE")}; return { pickRotation, ROTATION };`)() as {
  pickRotation: (last: string, has: Record<string, boolean>) => string;
  ROTATION: string[];
};

describe("the widget script", () => {
  it("never ships with a token in it, and leaves the address for the app to fill in", () => {
    expect(script).toMatch(/const TOKEN = "";/);
    expect(script).not.toMatch(/ndw_[A-Za-z0-9_-]{20,}/);
    expect(script).toContain('const NUDGE_URL = "__NUDGE_URL__"');
  });

  it("is valid JavaScript", () => {
    // Top-level await is how Scriptable runs a script, so check it as a module.
    expect(() => new Function(script.replace(/^await main\(\);$/m, "").replace(/\bconst\b/g, "var"))).not.toThrow();
  });

  it("reads the Parameter: every widget word, any case, extras ignored, next by default", () => {
    for (const t of ["next", "today", "school", "grades", "week", "habits", "rotate"]) expect(parse.parseParam(t)).toBe(t);
    expect(parse.parseParam("  GRADES ")).toBe("grades");
    expect(parse.parseParam("week|big")).toBe("week");
    expect(parse.parseParam("")).toBe("next");
    expect(parse.parseParam(null)).toBe("next");
    expect(parse.parseParam("nonsense")).toBe("next");
  });

  it("every Parameter in the Settings list is one the script understands", () => {
    const en = readFileSync("src/lib/i18n/en-p8.ts", "utf8");
    const listed = [...en.matchAll(/"widgets\.param\.(\w+)"/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...parse.TYPES].sort());
  });

  it("rotate goes next, school, grades, habits, then round again", () => {
    expect(rot.ROTATION).toEqual(["next", "school", "grades", "habits"]);
    const all = { next: true, school: true, grades: true, habits: true };
    let card = "habits";
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      card = rot.pickRotation(card, all);
      seen.push(card);
    }
    expect(seen).toEqual(["next", "school", "grades", "habits", "next", "school"]);
  });

  it("rotate skips a card with nothing to show, and falls back to next when nothing has data", () => {
    expect(rot.pickRotation("next", { next: true, school: false, grades: true, habits: true })).toBe("grades");
    expect(rot.pickRotation("grades", { next: true, school: true, grades: true, habits: false })).toBe("next");
    expect(rot.pickRotation("school", { next: false, school: false, grades: false, habits: false })).toBe("next");
    expect(rot.pickRotation("never-heard-of-it", { next: false, school: true, grades: false, habits: false })).toBe("school");
  });
});
