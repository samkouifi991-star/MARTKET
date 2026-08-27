// Secure Zapier ingestion webhook (Email -> Zapier -> here), replacing
// the FMP economic-calendar/news dependency for NEW incoming data. Never
// scrapes ForexFactory.com — consumes only what Zapier forwards from the
// user's own lawfully-received email. Authenticated by a dedicated
// ZAPIER_INGEST_SECRET (never CRON_SECRET/EVENT_WATCH_SECRET/Stripe
// secrets, never exposed client-side — see ../_shared.ts).
//
// News payloads are accepted, validated, and audit-logged, but not yet
// written/classified — that lands in a follow-up commit alongside the
// LLM classifier so the higher-risk integration ships separately. This
// keeps the safer economic-event path (100% reused, battle-tested V2
// surprise engine) shippable on its own.
import { NextRequest, NextResponse } from "next/server";
import { demoModeSkip, isDemoMode } from "../../../cron/_shared";
import { verifyZapierAuth, unauthorized } from "../../_shared";
import { ZapierIngestPayload, normalizeImpact } from "./schema";
import { normalizeNumericString } from "@/lib/normalization/numeric-string";
import { countryFromCurrency } from "@/services/economic-calendar/zapier-country";
import { deriveDisplayCategory } from "@/services/economic-calendar/display-category";
import { matchIndicator, importanceTierFor } from "@/services/economic-calendar/indicator-taxonomy";
import { releaseKeyFor } from "@/services/economic-calendar/release-identity";
import { affectedMarketsFor } from "@/services/economic-calendar/affected-markets";
import { EconomicRelease } from "@/services/economic-calendar/provider";
import { processReleases } from "@/lib/scoring-v2/release-watch";
import { recomputeAffectedMarketsForCountries } from "@/lib/scoring-v2/recompute";
import { upsertEconomicEventFromZapier } from "@/db/queries/market-data";
import { logZapierIngest } from "@/db/queries/zapier-ingest-log";
import { recordAuthAttempt } from "@/db/queries/rate-limit";

const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  if (!verifyZapierAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const attemptCount = await recordAuthAttempt("zapier-webhook", "zapier_ingest", RATE_LIMIT_WINDOW_MS);
  if (attemptCount > RATE_LIMIT_PER_MINUTE) {
    await logZapierIngest({ payloadType: "unknown", rawPayload: {}, dedupKey: null, outcome: "rejected_rate_limited" }).catch(() => {});
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const bodyJson = await req.json().catch(() => null);
  const parsed = ZapierIngestPayload.safeParse(bodyJson);
  if (!parsed.success) {
    await logZapierIngest({
      payloadType: "unknown",
      rawPayload: bodyJson ?? {},
      dedupKey: null,
      outcome: "rejected_invalid_payload",
      errorDetail: parsed.error.message,
    }).catch(() => {});
    return NextResponse.json({ error: "Invalid payload", detail: parsed.error.flatten() }, { status: 400 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1" || req.nextUrl.searchParams.get("dryRun") === "true";

  if (parsed.data.type === "economic_event") {
    return handleEconomicEvent(parsed.data, bodyJson, dryRun);
  }

  // News path: validated and audit-logged, but not yet written — lands in
  // the follow-up LLM-classifier commit.
  await logZapierIngest({ payloadType: "news", rawPayload: bodyJson, dedupKey: null, outcome: "error", errorDetail: "News ingestion not yet enabled." }).catch(() => {});
  return NextResponse.json({ received: true, type: "news", note: "News ingestion lands in a follow-up release." }, { status: 202 });
}

async function handleEconomicEvent(payload: import("./schema").EconomicEventPayload, rawPayload: unknown, dryRun: boolean) {
  const actual = normalizeNumericString(payload.actual);
  const forecast = normalizeNumericString(payload.forecast);
  const previous = normalizeNumericString(payload.previous);
  const revisedPrevious = normalizeNumericString(payload.revisedPrevious);
  const impact = normalizeImpact(payload.impact);

  const country = countryFromCurrency(payload.currency);
  const indicatorKey = matchIndicator(payload.event);
  const importanceTier = indicatorKey ? importanceTierFor(indicatorKey) : null;
  const category = deriveDisplayCategory(indicatorKey);

  const releaseKey = country && indicatorKey ? releaseKeyFor("zapier-forexfactory", country, indicatorKey, payload.scheduledAt) : null;
  // externalId must equal EconomicRelease.id below so processReleases'
  // internal updateEconomicEventClassification enrichment join lands on
  // the same economic_events row this function writes.
  const externalId = releaseKey ?? `zapier-forexfactory:${payload.currency}:${payload.event}:${payload.scheduledAt}`;

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldWrite: {
        externalId,
        country: country ?? payload.currency,
        event: payload.event,
        indicatorKey,
        importanceTier,
        category,
        processingStatus: indicatorKey ? "classified" : "unclassified",
        actual,
        forecast,
        previous,
        revisedPrevious,
        wouldSurpriseScore: Boolean(country && indicatorKey && releaseKey),
      },
    });
  }

  const affectedMarkets = country ? affectedMarketsFor(country) : [];
  const economicEventId = await upsertEconomicEventFromZapier({
    externalId,
    country: country ?? payload.currency,
    event: payload.event,
    dateTime: payload.scheduledAt,
    impact,
    actual,
    forecast,
    previous,
    revisedPrevious,
    indicatorKey,
    importanceTier,
    category,
    affectedMarkets,
  });

  let recomputedMarkets: string[] = [];
  const outcome: "accepted_new" | "accepted_unclassified" = indicatorKey ? "accepted_new" : "accepted_unclassified";

  if (country && indicatorKey && releaseKey) {
    const release: EconomicRelease = {
      id: externalId,
      country,
      event: payload.event,
      indicatorKey,
      importanceTier,
      releaseKey,
      dateTime: payload.scheduledAt,
      actual: actual.value,
      forecast: forecast.value,
      previous: previous.value,
      revisedPrevious: revisedPrevious.value,
    };
    const { processed } = await processReleases([release]);
    if (processed.length > 0) {
      recomputedMarkets = await recomputeAffectedMarketsForCountries(processed.map((p) => p.country));
    }
  }

  await logZapierIngest({
    payloadType: "economic_event",
    rawPayload,
    dedupKey: releaseKey,
    outcome,
    economicEventId,
    recomputedMarkets,
  }).catch(() => {});

  return NextResponse.json({
    received: true,
    type: "economic_event",
    economicEventId,
    processingStatus: indicatorKey ? "classified" : "unclassified",
    recomputedMarkets,
  });
}
