import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/scoring-v2/release-watch");
vi.mock("@/lib/scoring-v2/recompute");
vi.mock("@/db/queries/market-data");
vi.mock("@/db/queries/zapier-ingest-log");

import { processReleases } from "@/lib/scoring-v2/release-watch";
import { recomputeAffectedMarketsForCountries } from "@/lib/scoring-v2/recompute";
import { upsertEconomicEventFromZapier } from "@/db/queries/market-data";
import { logZapierIngest } from "@/db/queries/zapier-ingest-log";
import { ingestEconomicEvent } from "./economic-event";
import { EconomicEventPayload } from "@/app/api/integrations/zapier/market-event/schema";

const payload: EconomicEventPayload = {
  type: "economic_event",
  source: "forex_factory_email",
  currency: "USD",
  event: "CPI m/m",
  scheduledAt: "2027-01-15T13:30:00.000Z",
  impact: "High",
  actual: "0.4%",
  forecast: "0.2%",
  previous: "0.1%",
  revisedPrevious: null,
  headline: null,
  summary: null,
  sourceUrl: null,
};

describe("ingestEconomicEvent (canonical ingestion, both channels)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(upsertEconomicEventFromZapier).mockResolvedValue(42);
    vi.mocked(logZapierIngest).mockResolvedValue(undefined);
    vi.mocked(processReleases).mockResolvedValue({
      scanned: 1,
      processed: [{ releaseKey: "forex-factory:US:cpi:2027-01-15T13:30:00.000Z", country: "US", indicatorKey: "cpi", importanceTier: "HIGH", surpriseId: 1 }],
      skippedCount: 0,
      diagnosticsCount: 0,
      failCount: 0,
    });
    vi.mocked(recomputeAffectedMarketsForCountries).mockResolvedValue(["EURUSD", "GBPUSD"]);
  });

  it("dry run validates/normalizes/classifies but writes nothing", async () => {
    const result = await ingestEconomicEvent(payload, { channel: "manual", provider: "manual-admin", dryRun: true, rawPayload: payload });
    expect(result.dryRun).toBe(true);
    if (result.dryRun) expect(result.wouldWrite.indicatorKey).toBe("cpi");
    expect(upsertEconomicEventFromZapier).not.toHaveBeenCalled();
    expect(logZapierIngest).not.toHaveBeenCalled();
  });

  it("manual channel writes with provider 'manual-admin' and channel-agnostic dedup namespace", async () => {
    const result = await ingestEconomicEvent(payload, { channel: "manual", provider: "manual-admin", dryRun: false, rawPayload: payload });
    expect(result.dryRun).toBe(false);
    expect(upsertEconomicEventFromZapier).toHaveBeenCalledWith(expect.objectContaining({ provider: "manual-admin", externalId: "forex-factory:US:cpi:2027-01-15T13:30:00.000Z" }));
    expect(logZapierIngest).toHaveBeenCalledWith(expect.objectContaining({ channel: "manual" }));
  });

  it("zapier channel uses the SAME dedup namespace as manual entry, so a later revision resolves to the same row", async () => {
    await ingestEconomicEvent(payload, { channel: "zapier", provider: "zapier-forexfactory", dryRun: false, rawPayload: payload });
    expect(upsertEconomicEventFromZapier).toHaveBeenCalledWith(expect.objectContaining({ provider: "zapier-forexfactory", externalId: "forex-factory:US:cpi:2027-01-15T13:30:00.000Z" }));
    expect(logZapierIngest).toHaveBeenCalledWith(expect.objectContaining({ channel: "zapier" }));
  });

  it("recomputes only the affected countries when a release is newly processed", async () => {
    const result = await ingestEconomicEvent(payload, { channel: "zapier", provider: "zapier-forexfactory", dryRun: false, rawPayload: payload });
    expect(processReleases).toHaveBeenCalledWith([expect.objectContaining({ country: "US", indicatorKey: "cpi" })]);
    expect(recomputeAffectedMarketsForCountries).toHaveBeenCalledWith(["US"]);
    expect(result.dryRun).toBe(false);
    if (!result.dryRun) expect(result.recomputedMarkets).toEqual(["EURUSD", "GBPUSD"]);
  });

  it("still writes an unclassifiable event, but never calls processReleases or recompute", async () => {
    const result = await ingestEconomicEvent({ ...payload, event: "Some Unrecognized Event Name" }, { channel: "manual", provider: "manual-admin", dryRun: false, rawPayload: payload });
    expect(result.dryRun).toBe(false);
    if (!result.dryRun) expect(result.processingStatus).toBe("unclassified");
    expect(processReleases).not.toHaveBeenCalled();
    expect(recomputeAffectedMarketsForCountries).not.toHaveBeenCalled();
  });
});
