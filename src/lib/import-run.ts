import type { Rpc } from "./dispatch";
import { toDatabasePayload, type InboxPayload } from "./inbox-schema";

export type ImportStatus = "new" | "updated" | "unchanged";
export type ImportReport = {
  committed: boolean;
  counts: Record<"classes" | "assignments" | "grades", Record<ImportStatus, number>>;
  results: { kind: "class" | "assignment" | "grade"; external_id: string; title: string; status: ImportStatus }[];
  warnings: string[];
};

export type ImportOutcome = { ok: true; report: ImportReport } | { ok: false; status: number; problems: string[] };

/** Runs the database import (or a preview of it) for one person. Used by the Import page and by /api/inbox. */
export async function runImport(rpc: Rpc, userId: string, payload: InboxPayload, tz: string, commit: boolean): Promise<ImportOutcome> {
  const res = await rpc("nudge_import", {
    p_user: userId,
    p_source: payload.source,
    p_payload: toDatabasePayload(payload, tz),
    p_commit: commit,
  });
  if (res.error) {
    const message = res.error.message;
    if (/No profile/i.test(message)) {
      return { ok: false, status: 409, problems: ["This account has not been set up yet. Open Nudge once and finish the first-time steps, then try again."] };
    }
    if (/your own account/i.test(message)) return { ok: false, status: 403, problems: [message] };
    if (/Could not find the function|does not exist|schema cache/i.test(message)) {
      return { ok: false, status: 503, problems: ["The database is missing setup file 0009 (school import). Run it in Supabase, then try again."] };
    }
    return { ok: false, status: 500, problems: [`The import could not be saved: ${message.slice(0, 200)}`] };
  }
  const data = res.data as ImportReport | null;
  if (!data || typeof data !== "object" || !("counts" in data)) {
    return { ok: false, status: 500, problems: ["The import answered in a way Nudge did not understand. Nothing was changed."] };
  }
  return { ok: true, report: data };
}
