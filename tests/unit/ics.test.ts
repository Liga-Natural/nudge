import { describe, expect, it } from "vitest";
import { parseIcs } from "@/lib/ics";
import { decrypt, encrypt, loadKey } from "@/lib/crypto";
import { checkFeedUrl, isPrivateAddress, safeFetchText } from "@/lib/safe-fetch";
import { instantToWall, wallToInstant } from "@/lib/time";

const NY = "America/New_York";
const NOW = wallToInstant({ y: 2026, m: 10, d: 14, h: 12, mi: 0 }, NY);
const parse = (text: string, defaultType: "task" | "homework" | "payment" | "event" = "homework") =>
  parseIcs(text, { userTz: NY, defaultType, now: NOW });

const wrap = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const vevent = (...lines: string[]) => `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT`;

describe("calendar feed reader", () => {
  it("reads whole-day, UTC, zoned and floating times", () => {
    const events = parse(
      wrap(
        vevent("UID:day", "SUMMARY:Essay due", "DTSTART;VALUE=DATE:20261020"),
        vevent("UID:utc", "SUMMARY:Quiz", "DTSTART:20261021T190000Z"),
        vevent("UID:zoned", "SUMMARY:Lab", "DTSTART;TZID=America/Chicago:20261022T150000"),
        vevent("UID:float", "SUMMARY:Reading", "DTSTART:20261023T090000"),
      ),
    );
    const byUid = Object.fromEntries(events.map((e) => [e.uid, e]));
    expect(byUid.day.all_day).toBe(true);
    expect(instantToWall(new Date(byUid.day.due_at), NY)).toMatchObject({ d: 20, h: 23, mi: 59 });
    expect(byUid.utc.due_at).toBe("2026-10-21T19:00:00.000Z");
    expect(byUid.zoned.due_at).toBe("2026-10-22T20:00:00.000Z"); // 3 PM Chicago (CDT) = 20:00Z
    expect(instantToWall(new Date(byUid.float.due_at), NY)).toMatchObject({ d: 23, h: 9 });
  });

  it("unfolds long lines and unescapes text", () => {
    const [e] = parse(
      wrap(vevent("UID:1", "SUMMARY:Read chapters 3\\, 4 and\r\n  5\\; then rest", "DTSTART;VALUE=DATE:20261020", "DESCRIPTION:Line one\\nLine two")),
    );
    expect(e.title).toBe("Read chapters 3, 4 and 5; then rest");
    expect(e.notes).toBe("Line one\nLine two");
  });

  it("keeps cancelled events (so they can be removed) and skips changed copies of a repeating event", () => {
    const events = parse(
      wrap(
        vevent("UID:x", "SUMMARY:Gone", "DTSTART;VALUE=DATE:20261020", "STATUS:CANCELLED"),
        vevent("UID:series", "SUMMARY:Practice", "DTSTART:20261020T220000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU"),
        vevent("UID:series", "SUMMARY:Practice (moved)", "DTSTART:20261027T230000Z", "RECURRENCE-ID:20261027T220000Z"),
      ),
    );
    expect(events.map((e) => [e.uid, e.cancelled, e.rrule])).toEqual([
      ["x", true, null],
      ["series", false, "FREQ=WEEKLY;BYDAY=TU"],
    ]);
  });

  it("ignores events far in the past or far away, but keeps repeating ones", () => {
    const events = parse(
      wrap(
        vevent("UID:old", "SUMMARY:Old", "DTSTART;VALUE=DATE:20250101"),
        vevent("UID:far", "SUMMARY:Far", "DTSTART;VALUE=DATE:20300101"),
        vevent("UID:recent", "SUMMARY:Yesterday", "DTSTART;VALUE=DATE:20261013"),
        vevent("UID:weekly", "SUMMARY:Weekly", "DTSTART;VALUE=DATE:20250101", "RRULE:FREQ=WEEKLY"),
      ),
    );
    expect(events.map((e) => e.uid).sort()).toEqual(["recent", "weekly"]);
  });

  it("finds dollar amounts (a Joker bills feed becomes payments)", () => {
    const [e] = parse(wrap(vevent("UID:b", "SUMMARY:Phone bill — $45.50", "DTSTART;VALUE=DATE:20261020")), "task");
    expect(e.amount_cents).toBe(4550);
    expect(e.type).toBe("payment");
    expect(e.reminders).toEqual([
      { offset_minutes: null, days_before: 3, at_time: "09:00" },
      { offset_minutes: null, days_before: 0, at_time: "09:00" },
    ]);
  });

  it("drops repeat rules it does not understand, but still keeps the event", () => {
    const [e] = parse(wrap(vevent("UID:odd", "SUMMARY:Odd", "DTSTART;VALUE=DATE:20261020", "RRULE:FREQ=SECONDLY")));
    expect(e.rrule).toBeNull();
  });

  it("copes with junk", () => {
    expect(parse("not a calendar")).toEqual([]);
    expect(parse(wrap(vevent("UID:1", "DTSTART;VALUE=DATE:20261020")))).toEqual([]); // no title
    expect(parse(wrap(vevent("UID:1", "SUMMARY:No date")))).toEqual([]);
  });
});

describe("feed addresses", () => {
  it("accepts https and webcal, rejects everything risky", () => {
    expect(checkFeedUrl("webcal://example.com/cal.ics")).toMatchObject({ ok: true });
    expect(checkFeedUrl("https://example.com/cal.ics")).toMatchObject({ ok: true });
    for (const bad of [
      "http://example.com/cal.ics",
      "https://localhost/cal.ics",
      "https://127.0.0.1/cal.ics",
      "https://[::1]/cal.ics",
      "https://10.0.0.5/cal.ics",
      "https://192.168.1.1/cal.ics",
      "https://169.254.169.254/latest/meta-data",
      "https://user:pass@example.com/cal.ics",
      "https://example.com:8443/cal.ics",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "nonsense",
    ]) {
      expect(checkFeedUrl(bad).ok, bad).toBe(false);
    }
  });

  it("knows which numbers are private", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("safe fetching", () => {
  const ics = wrap(vevent("UID:1", "SUMMARY:x", "DTSTART;VALUE=DATE:20261020"));
  const resp = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });
  const publicDns = async () => ["93.184.216.34"];

  it("fetches a feed", async () => {
    const r = await safeFetchText("webcal://example.com/c.ics", { resolver: publicDns, fetchImpl: (async () => resp(ics, { headers: { etag: '"v1"' } })) as typeof fetch });
    expect(r).toMatchObject({ kind: "ok", etag: '"v1"' });
  });

  it("refuses a name that points at a private address", async () => {
    const r = await safeFetchText("https://sneaky.example.com/c.ics", { resolver: async () => ["10.0.0.9"], fetchImpl: (async () => resp(ics)) as typeof fetch });
    expect(r.kind).toBe("error");
  });

  it("refuses a redirect to a private address", async () => {
    const calls: string[] = [];
    const r = await safeFetchText("https://example.com/c.ics", {
      resolver: publicDns,
      fetchImpl: (async (u: URL) => {
        calls.push(String(u));
        return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } });
      }) as unknown as typeof fetch,
    });
    expect(r.kind).toBe("error");
    expect(calls).toHaveLength(1);
  });

  it("handles 'not modified', errors, huge files, and non-calendars", async () => {
    const f = (r: Response) => ((async () => r) as unknown as typeof fetch);
    expect((await safeFetchText("https://example.com/c.ics", { resolver: publicDns, fetchImpl: f(new Response(null, { status: 304 })) })).kind).toBe("not_modified");
    expect((await safeFetchText("https://example.com/c.ics", { resolver: publicDns, fetchImpl: f(new Response("no", { status: 500 })) })).kind).toBe("error");
    expect((await safeFetchText("https://example.com/c.ics", { resolver: publicDns, maxBytes: 10, fetchImpl: f(resp(ics)) })).kind).toBe("error");
    expect((await safeFetchText("https://example.com/c.ics", { resolver: publicDns, fetchImpl: f(resp("<html>hello</html>")) })).kind).toBe("error");
  });
});

describe("encrypting saved addresses", () => {
  const key = loadKey("a".repeat(64));
  it("round trips and is different each time", () => {
    const a = encrypt("https://example.com/secret-feed.ics?token=abc", key);
    const b = encrypt("https://example.com/secret-feed.ics?token=abc", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret-feed");
    expect(decrypt(a, key)).toBe("https://example.com/secret-feed.ics?token=abc");
  });
  it("fails loudly with the wrong key or a damaged value", () => {
    const token = encrypt("hello", key);
    expect(() => decrypt(token, loadKey("b".repeat(64)))).toThrow();
    expect(() => decrypt(token.slice(0, -4) + "AAAA", key)).toThrow();
    expect(() => decrypt("nonsense", key)).toThrow();
  });
  it("insists on a proper key", () => {
    expect(() => loadKey("short")).toThrow();
    expect(() => loadKey(undefined)).toThrow();
  });
});
