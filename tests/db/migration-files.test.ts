import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationFiles } from "./harness";

const dir = join(process.cwd(), "supabase", "migrations");

describe("migration files", () => {
  const files = migrationFiles();

  it("are numbered 0001, 0002, ... with no gaps and no repeats", () => {
    files.forEach((f, i) => {
      expect(f, f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
      expect(Number(f.slice(0, 4)), f).toBe(i + 1);
    });
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("have balanced dollar-quoted blocks with named tags (no bare $$ that a paste can mangle)", () => {
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      const tags = [...text.matchAll(/\$([a-z_]*)\$/g)].map((m) => m[0]);
      expect(tags.length % 2, `${f}: odd number of dollar quotes`).toBe(0);
      expect(tags.filter((t) => t === "$$"), `${f}: bare $$`).toEqual([]);
      // every opening tag is closed by the same tag, in order
      const stack: string[] = [];
      for (const tag of tags) {
        if (stack[stack.length - 1] === tag) stack.pop();
        else stack.push(tag);
      }
      expect(stack, `${f}: unclosed block`).toEqual([]);
    }
  });

  it("only ever create tables if they do not exist, so running a file twice is safe", () => {
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(/create table (?!if not exists)([^\s(]+)/gi)) {
        throw new Error(`${f}: create table without "if not exists": ${m[1]}`);
      }
      for (const m of text.matchAll(/create (?:unique )?index (?!if not exists)([^\s(]+)/gi)) {
        throw new Error(`${f}: create index without "if not exists": ${m[1]}`);
      }
    }
  });

  it("every table made from 0007 on turns on row level security in the same file", () => {
    for (const f of files.filter((x) => Number(x.slice(0, 4)) >= 7)) {
      const text = readFileSync(join(dir, f), "utf8");
      const tables = [...text.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]);
      for (const t of tables) {
        const direct = new RegExp(String.raw`alter table public\.${t} enable row level security`, "i");
        const inLoop = new RegExp(String.raw`tables text\[\] := array\[[^\]]*'${t}'`, "i");
        const covered = direct.test(text) || inLoop.test(text);
        expect(covered, `${f}: ${t} has no row level security`).toBe(true);
      }
    }
  });
});
