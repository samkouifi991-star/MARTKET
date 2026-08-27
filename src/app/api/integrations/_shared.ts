// Auth for the Zapier ingestion webhook — a dedicated credential, never
// CRON_SECRET/EVENT_WATCH_SECRET/Stripe secrets, per explicit instruction
// to give this integration its own. Server-only: this file lives under
// app/api/, never imported by a client component, and the env var carries
// no NEXT_PUBLIC_ prefix, so it never reaches browser JavaScript.
import { NextRequest, NextResponse } from "next/server";

export function verifyZapierAuth(req: NextRequest): boolean {
  const secret = process.env.ZAPIER_INGEST_SECRET;
  if (!secret) return false; // fail closed: no secret configured means no access
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
