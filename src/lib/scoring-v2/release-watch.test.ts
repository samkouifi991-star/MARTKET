import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db/queries/market-data");
vi.mock("@/db/queries/economic-releases");
vi.mock("@/db/queries/release-tracking");

import { updateEconomicEventClassification } from "@/db/queries/market-data";
import { getHistoricalEffectiveSurprises, hasDiagnostic, hasProcessedReleaseKey, recordReleaseSurprise, recordWatchDiagnostic } from "@/db/queries/economic-releases";
import { markReleaseProcessed, upsertReleaseTracking } from "@/db/queries/release-tracking";
import { processReleases } from "./release-watch";
import { EconomicRelease } from "@/services/economic-calendar/provider";

function release(overrides: Partial<EconomicRelease> = {}): EconomicRelease {
  return {
    id: "fmp-US-CPI-2027-01-15-0",
    country: "United States",
    event: "CPI m/m",
    indicatorKey: "cpi",
    importanceTier: "HIGH",
    releaseKey: "fmp:US:cpi:2027-01-15T13:30:00.000Z",
    dateTime: "2027-01-15T13:30:00.000Z",
    actual: 0.4,
    forecast: 0.2,
    previous: 0.2,
    revisedPrevious: null,
    ...overrides,
  };
}

describe("processReleases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(updateEconomicEventClassification).mockResolvedValue(undefined);
    vi.mocked(upsertReleaseTracking).mockResolvedValue({ row: {} as never, transition: "created_released" });
    vi.mocked(markReleaseProcessed).mockResolvedValue(undefined);
    vi.mocked(recordWatchDiagnostic).mockResolvedValue(undefined);
    vi.mocked(hasDiagnostic).mockResolvedValue(false);
    vi.mocked(hasProcessedReleaseKey).mockResolvedValue(false);
    vi.mocked(getHistoricalEffectiveSurprises).mockResolvedValue([]);
    vi.mocked(recordReleaseSurprise).mockResolvedValue(99);
  });

  it("logs a normalization_failure diagnostic and skips an event the taxonomy couldn't classify", async () => {
    const result = await processReleases([release({ indicatorKey: null, importanceTier: null, releaseKey: null, event: "Some Obscure Survey" })]);
    expect(recordWatchDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: "normalization_failure", rawEvent: "Some Obscure Survey" }));
    expect(result.processed).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("logs missing_forecast for a HIGH-impact release with no forecast, deduped via hasDiagnostic", async () => {
    await processReleases([release({ forecast: null })]);
    expect(recordWatchDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: "missing_forecast" }));
  });

  it("does not log missing_forecast again once hasDiagnostic already reports one recorded", async () => {
    vi.mocked(hasDiagnostic).mockImplementation(async (kind) => kind === "missing_forecast");
    await processReleases([release({ forecast: null })]);
    expect(recordWatchDiagnostic).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "missing_forecast" }));
  });

  it("logs missing_revision for a HIGH-impact release with a real previous value but no revisedPrevious (FMP's honest gap)", async () => {
    await processReleases([release({ previous: 0.2, revisedPrevious: null })]);
    expect(recordWatchDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: "missing_revision" }));
  });

  it("does not log missing_actual for a release that's merely scheduled and not yet overdue", async () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 min in the future
    await processReleases([release({ actual: null, dateTime: soon })]);
    expect(recordWatchDiagnostic).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "missing_actual" }));
  });

  it("logs missing_actual for a HIGH-impact release well past its scheduled time with still no actual", async () => {
    const longAgo = new Date(Date.now() - 90 * 60_000).toISOString(); // 90 min ago
    const result = await processReleases([release({ actual: null, dateTime: longAgo })]);
    expect(recordWatchDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: "missing_actual" }));
    expect(result.processed).toHaveLength(0); // never surprise-scored — no actual to score
  });

  it("computes and stores a real surprise, marks the tracking row processed with the theoretical affected-market list, and reports it as newly processed", async () => {
    const result = await processReleases([release()]);

    expect(recordReleaseSurprise).toHaveBeenCalledWith(expect.objectContaining({ releaseKey: "fmp:US:cpi:2027-01-15T13:30:00.000Z", actual: 0.4, forecast: 0.2 }));
    expect(markReleaseProcessed).toHaveBeenCalledWith(
      "fmp:US:cpi:2027-01-15T13:30:00.000Z",
      expect.objectContaining({ surpriseId: 99, affectedMarkets: expect.arrayContaining(["XAUUSD", "BTCUSD"]) })
    );
    expect(result.processed).toEqual([{ releaseKey: "fmp:US:cpi:2027-01-15T13:30:00.000Z", country: "US", indicatorKey: "cpi", importanceTier: "HIGH", surpriseId: 99 }]);
  });

  it("never re-scores a release already processed on a prior run (idempotency — requirement #2)", async () => {
    vi.mocked(hasProcessedReleaseKey).mockResolvedValue(true);
    const result = await processReleases([release()]);
    expect(recordReleaseSurprise).not.toHaveBeenCalled();
    expect(result.processed).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("processing the identical release object twice in separate calls only ever surprise-scores it once", async () => {
    await processReleases([release()]);
    expect(recordReleaseSurprise).toHaveBeenCalledTimes(1);

    // Simulate the SAME release being fetched again on the next 5-minute
    // poll — hasProcessedReleaseKey now reflects that it was already stored.
    vi.mocked(hasProcessedReleaseKey).mockResolvedValue(true);
    await processReleases([release()]);
    expect(recordReleaseSurprise).toHaveBeenCalledTimes(1); // still just once
  });
});
