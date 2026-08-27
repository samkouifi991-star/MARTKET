// Secure Zapier ingestion webhook (Email -> Zapier -> here), replacing
// the FMP economic-calendar/news dependency for NEW incoming data. Never
// scrapes ForexFactory.com — consumes only what Zapier forwards from the
// user's own lawfully-received email. Authenticated by a dedicated
// ZAPIER_INGEST_SECRET (never CRON_SECRET/EVENT_WATCH_SECRET/Stripe
// secrets, never exposed client-side — see ../_shared.ts).
//
// This route is now a thin HTTP wrapper: auth, rate-limit, and Zod-parse
// only. All actual validate->normalize->save->surprise->affected-markets
// ->recompute logic lives in src/lib/ingestion/economic-event.ts and
// news.ts — the SAME functions the Admin manual-entry Server Action calls
// with channel: "manual" — so Zapier and manual entry are never two
// separate implementations of the same pipeline.
import { NextRequest, NextResponse } from "next/server";
import { demoModeSkip, isDemoMode } from "../../../cron/_shared";
import { verifyZapierAuth, unauthorized } from "../../_shared";
import { ZapierIngestPayload } from "./schema";
import { ingestEconomicEvent } from "@/lib/ingestion/economic-event";
import { ingestNews } from "@/lib/ingestion/news";
import { logZapierIngest } from "@/db/queries/zapier-ingest-log";
import { recordAuthAttempt } from "@/db/queries/rate-limit";

const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  if (!verifyZapierAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const attemptCount = await recordAuthAttempt("zapier-webhook", "zapier_ingest", RATE_LIMIT_WINDOW_MS);
  if (attemptCount > RATE_LIMIT_PER_MINUTE) {
    await logZapierIngest({ payloadType: "unknown", channel: "zapier", rawPayload: {}, dedupKey: null, outcome: "rejected_rate_limited" }).catch(() => {});
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const bodyJson = await req.json().catch(() => null);
  const parsed = ZapierIngestPayload.safeParse(bodyJson);
  if (!parsed.success) {
    await logZapierIngest({
      payloadType: "unknown",
      channel: "zapier",
      rawPayload: bodyJson ?? {},
      dedupKey: null,
      outcome: "rejected_invalid_payload",
      errorDetail: parsed.error.message,
    }).catch(() => {});
    return NextResponse.json({ error: "Invalid payload", detail: parsed.error.flatten() }, { status: 400 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1" || req.nextUrl.searchParams.get("dryRun") === "true";

  if (parsed.data.type === "economic_event") {
    const result = await ingestEconomicEvent(parsed.data, { channel: "zapier", provider: "zapier-forexfactory", dryRun, rawPayload: bodyJson });
    if (result.dryRun) return NextResponse.json(result);
    return NextResponse.json({ received: true, type: "economic_event", economicEventId: result.economicEventId, processingStatus: result.processingStatus, recomputedMarkets: result.recomputedMarkets });
  }

  const result = await ingestNews(parsed.data, { channel: "zapier", dryRun, rawPayload: bodyJson });
  if (result.dryRun) return NextResponse.json(result);
  if (result.duplicate) return NextResponse.json({ received: true, type: "news", duplicate: true });
  return NextResponse.json({ received: true, type: "news", newsArticleId: result.newsArticleId, recomputedMarkets: result.recomputedMarkets });
}
