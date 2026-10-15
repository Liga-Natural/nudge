import { NextResponse } from "next/server";
import { z } from "zod";
import { markDone, snoozeOccurrence } from "@/app/actions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  occ: z.string().uuid(),
  action: z.enum(["done", "snooze10", "snooze60", "tonight", "tomorrow"]),
});

// The buttons on a notification (Android and desktop). The service worker calls this with the
// signed-in cookie; the server actions underneath check who you are and that the item is yours.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That button was not understood." }, { status: 400 });
  const { occ, action } = parsed.data;
  const result =
    action === "done"
      ? await markDone(occ)
      : await snoozeOccurrence(occ, action === "snooze10" ? "10" : action === "snooze60" ? "60" : action);
  if (!result.ok) return NextResponse.json({ error: "Could not do that. Open Nudge and try again." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
