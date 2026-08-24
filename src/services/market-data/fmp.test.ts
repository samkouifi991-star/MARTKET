// Regression coverage for the real production 404 this session traced:
// getEconomicCalendar was calling FMP's Stable API with a typo'd plural
// path ("/economics-calendar") instead of the documented singular
// ("/economic-calendar"). This is the ONE shared implementation behind
// both /api/cron/calendar (V1) and the V2 economic-calendar provider
// (services/economic-calendar/fmp-provider.ts, used by both
// /api/cron/economic-releases and /api/watch/economic-releases) — fixing
// it here fixes every caller.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getEconomicCalendar } from "./fmp";

describe("getEconomicCalendar", () => {
  const originalKey = process.env.FMP_API_KEY;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FMP_API_KEY = "test-key";
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
  });

  afterEach(() => {
    process.env.FMP_API_KEY = originalKey;
    fetchSpy.mockRestore();
  });

  it("calls FMP's Stable API /economic-calendar (singular) — never the old /economics-calendar typo that returned a real production 404", async () => {
    await getEconomicCalendar("2027-03-01T00:00:00.000Z", "2027-03-02T00:00:00.000Z");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://financialmodelingprep.com/stable/economic-calendar?")).toBe(true);
    expect(calledUrl).not.toContain("economics-calendar");
  });

  it("sends from/to as plain YYYY-MM-DD query params, matching the same convention already used by /historical-price-eod/full on this same Stable API", async () => {
    await getEconomicCalendar("2027-04-05T12:34:56.000Z", "2027-04-10T00:00:00.000Z");

    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("from")).toBe("2027-04-05");
    expect(calledUrl.searchParams.get("to")).toBe("2027-04-10");
  });
});
