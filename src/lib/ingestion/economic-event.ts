// Canonical economic-release ingestion — the ONE place that does
// validate→normalize→save→surprise→affected-markets→recompute for an
// incoming economic-release event, regardless of which channel produced
// it. Both the email/Zapier webhook
// (src/app/api/integrations/zapier/market-event/route.ts) and the Admin
// manual-entry Server Action call this exact function — there is no
// second, parallel implementation for manual input.
//
// Dedup identity uses the channel-agnostic FOREX_FACTORY_PROVIDER_NAMESPACE
// (see release-identity.ts) so a manually-entered release and a later
// Zapier-delivered revision of the SAME real release resolve to the same
// releaseKey/externalId and UPDATE one row. Which channel actually wrote a
// given row is tracked separately via `options.provider` (display only,
// e.g. "manual-admin" | "zapier-forexfactory") and `options.channel`
// (audit-log only, "manual" | "zapier").
import { EconomicEventPayload, normalizeImpact } from "@/app/api/integrations/zapier/market-event/schema";
import { normalizeNumericString } from "@/lib/normalization/numeric-string";
import { countryFromCurrency } from "@/services/economic-calendar/zapier-country";
import { deriveDisplayCategory } from "@/services/economic-calendar/display-category";
import { matchIndicator, importanceTierFor } from "@/services/economic-calendar/indicator-taxonomy";
import { releaseKeyFor, FOREX_FACTORY_PROVIDER_NAMESPACE } from "@/services/economic-calendar/release-identity";
import { affectedMarketsFor } from "@/services/economic-calendar/affected-markets";
import { EconomicRelease } from "@/services/economic-calendar/provider";
import { processReleases } from "@/lib/scoring-v2/release-watch";
import { recomputeAffectedMarketsForCountries } from "@/lib/scoring-v2/recompute";
import { upsertEconomicEventFromZapier } from "@/db/queries/market-data";
import { logZapierIngest, ZapierIngestOutcome } from "@/db/queries/zapier-ingest-log";

export type IngestChannel = "manual" | "zapier";

export type IngestEconomicEventOptions = {
  /** Which entry point is calling — recorded on zapier_ingest_log.channel (audit only). */
  channel: IngestChannel;
  /** Display provenance recorded on economic_events.provider, e.g. "manual-admin" | "zapier-forexfactory". */
  provider: string;
  /** When true: validate/normalize/classify only — no write, no recompute. */
  dryRun: boolean;
  /** The exact original submitted body, logged verbatim for Admin Incoming Data. */
  rawPayload: unknown;
};

export type IngestEconomicEventResult =
  | {
      dryRun: true;
      wouldWrite: {
        externalId: string;
        country: string;
        event: string;
        indicatorKey: string | null;
        importanceTier: string | null;
        category: string;
        processingStatus: "classified" | "unclassified";
        actual: { raw: string | null; value: number | null };
        forecast: { raw: string | null; value: number | null };
        previous: { raw: string | null; value: number | null };
        revisedPrevious: { raw: string | null; value: number | null };
        wouldSurpriseScore: boolean;
      };
    }
  | {
      dryRun: false;
      economicEventId: number;
      processingStatus: "classified" | "unclassified";
      recomputedMarkets: string[];
    };

export async function ingestEconomicEvent(payload: EconomicEventPayload, options: IngestEconomicEventOptions): Promise<IngestEconomicEventResult> {
  const actual = normalizeNumericString(payload.actual);
  const forecast = normalizeNumericString(payload.forecast);
  const previous = normalizeNumericString(payload.previous);
  const revisedPrevious = normalizeNumericString(payload.revisedPrevious);
  const impact = normalizeImpact(payload.impact);

  const country = countryFromCurrency(payload.currency);
  const indicatorKey = matchIndicator(payload.event);
  const importanceTier = indicatorKey ? importanceTierFor(indicatorKey) : null;
  const category = deriveDisplayCategory(indicatorKey);

  const releaseKey = country && indicatorKey ? releaseKeyFor(FOREX_FACTORY_PROVIDER_NAMESPACE, country, indicatorKey, payload.scheduledAt) : null;
  const externalId = releaseKey ?? `${FOREX_FACTORY_PROVIDER_NAMESPACE}:${payload.currency}:${payload.event}:${payload.scheduledAt}`;

  if (options.dryRun) {
    return {
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
    };
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
    provider: options.provider,
  });

  let recomputedMarkets: string[] = [];
  const outcome: ZapierIngestOutcome = indicatorKey ? "accepted_new" : "accepted_unclassified";

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
    channel: options.channel,
    rawPayload: options.rawPayload,
    dedupKey: releaseKey,
    outcome,
    economicEventId,
    recomputedMarkets,
  }).catch(() => {});

  return {
    dryRun: false,
    economicEventId,
    processingStatus: indicatorKey ? "classified" : "unclassified",
    recomputedMarkets,
  };
}
