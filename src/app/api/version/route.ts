import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Which deploy is live. The app compares this with the version it was loaded from.
export function GET() {
  return NextResponse.json({ build: process.env.NUDGE_BUILD ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
