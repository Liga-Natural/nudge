import { describe, expect, it } from "vitest";
import { safeFetchText } from "@/lib/safe-fetch";

const publicDns = async () => ["93.184.216.34"];
const resp = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });
const get = (body: string, init?: ResponseInit) =>
  safeFetchText("https://joker.example/bills?key=abc", { expect: "json", resolver: publicDns, fetchImpl: (async () => resp(body, init)) as typeof fetch });

describe("fetching the Joker bills link", () => {
  it("accepts JSON (an object or a list) and keeps the ETag", async () => {
    expect(await get('{"bills":[]}', { headers: { etag: '"b1"' } })).toEqual({ kind: "ok", text: '{"bills":[]}', etag: '"b1"' });
    expect(await get("  [ ]")).toMatchObject({ kind: "ok" });
  });

  it("asks for JSON, not a calendar", async () => {
    let accept = "";
    await safeFetchText("https://joker.example/bills", {
      expect: "json",
      resolver: publicDns,
      fetchImpl: (async (_u: unknown, init: RequestInit) => {
        accept = String((init.headers as Record<string, string>).Accept);
        return resp("{}");
      }) as typeof fetch,
    });
    expect(accept).toMatch(/application\/json/);
  });

  it("a web page is explained in words about the bills link, not a calendar", async () => {
    const r = await get("<html>please log in</html>");
    expect(r).toMatchObject({ kind: "error" });
    expect(r.kind === "error" && r.message).toMatch(/bills link did not return JSON/);
  });

  it("private addresses and errors name the bills link", async () => {
    const priv = await safeFetchText("https://joker.example/bills", { expect: "json", resolver: async () => ["10.0.0.5"], fetchImpl: (async () => resp("{}")) as typeof fetch });
    expect(priv).toEqual({ kind: "error", message: "That bills link isn't allowed." });
    const err = await safeFetchText("https://joker.example/bills", { expect: "json", resolver: publicDns, fetchImpl: (async () => resp("no", { status: 404 })) as typeof fetch });
    expect(err).toEqual({ kind: "error", message: "The bills link answered with an error (404)." });
  });

  it("calendars are still checked as calendars", async () => {
    const r = await safeFetchText("https://school.example/c.ics", { resolver: publicDns, fetchImpl: (async () => resp("{}")) as typeof fetch });
    expect(r).toEqual({ kind: "error", message: "That address isn't a calendar feed." });
  });
});
