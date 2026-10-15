import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Fetching an address a person typed is risky: it must never reach into our own network.
// Only https, only public addresses, small answers, short waits, a few redirects.

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb")) return true; // link-local
    if (x.startsWith("fc") || x.startsWith("fd")) return true; // unique local
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // not an address at all: treat as unsafe
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: "bad_url" | "not_https" | "private" };

/** Cleans up an address typed by a person (accepts webcal://) and rejects unsafe ones before any lookup. */
export function checkFeedUrl(input: string): UrlCheck {
  let text = input.trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "bad_url" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "private" };
  }
  if (isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "private" };
  if (url.port && url.port !== "443") return { ok: false, reason: "bad_url" };
  return { ok: true, url };
}

export type FetchResult =
  | { kind: "ok"; text: string; etag: string | null }
  | { kind: "not_modified" }
  | { kind: "error"; message: string };

type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export async function safeFetchText(
  input: string,
  opts: { etag?: string | null; maxBytes?: number; timeoutMs?: number; resolver?: Resolver; fetchImpl?: typeof fetch; expect?: "calendar" | "json" } = {},
): Promise<FetchResult> {
  const json = opts.expect === "json";
  // What the address is called in the messages a person reads.
  const noun = json ? "bills link" : "calendar address";
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const resolve = opts.resolver ?? defaultResolver;
  let target = checkFeedUrl(input);
  for (let hop = 0; hop < 4; hop++) {
    if (!target.ok) return { kind: "error", message: `That ${noun} isn't allowed.` };
    try {
      const addresses = isIP(target.url.hostname) ? [target.url.hostname] : await resolve(target.url.hostname);
      if (!addresses.length || addresses.some(isPrivateAddress)) return { kind: "error", message: `That ${noun} isn't allowed.` };
    } catch {
      return { kind: "error", message: `We couldn't find that ${noun}.` };
    }
    let res: Response;
    try {
      res = await doFetch(target.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
        headers: { "User-Agent": "Nudge calendar sync", Accept: json ? "application/json, text/plain;q=0.8" : "text/calendar, text/plain;q=0.8", ...(opts.etag ? { "If-None-Match": opts.etag } : {}) },
      });
    } catch {
      return { kind: "error", message: `The ${noun} did not answer in time.` };
    }
    if (res.status === 304) return { kind: "not_modified" };
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { kind: "error", message: `The ${noun} sent us somewhere we can't follow.` };
      target = checkFeedUrl(new URL(loc, target.url).toString());
      continue;
    }
    if (!res.ok) return { kind: "error", message: `The ${noun} answered with an error (${res.status}).` };
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > maxBytes) return { kind: "error", message: json ? "That bills list is too big." : "That calendar is too big." };
    const reader = res.body?.getReader();
    if (!reader) return { kind: "error", message: json ? "The bills link came back empty." : "The calendar came back empty." };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return { kind: "error", message: json ? "That bills list is too big." : "That calendar is too big." };
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (json) {
      if (!/^\s*[[{]/.test(text)) return { kind: "error", message: "The bills link did not return JSON. Check that it is the Joker bills feed address (not a web page)." };
    } else if (!/BEGIN:VCALENDAR/i.test(text)) return { kind: "error", message: "That address isn't a calendar feed." };
    return { kind: "ok", text, etag: res.headers.get("etag") };
  }
  return { kind: "error", message: `The ${noun} redirected too many times.` };
}
