import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/fmp");
vi.mock("@/services/market-data/cftc");
vi.mock("@/services/market-data/fred");
vi.mock("@/services/market-data/retail-sentiment/myfxbook");
vi.mock("@/services/market-data/retail-sentiment/ig-provider");
vi.mock("@/db/queries/gbpusd-validation");

import * as fmp from "@/services/market-data/fmp";
import * as cftc from "@/services/market-data/cftc";
import * as fred from "@/services/market-data/fred";
import { myfxbookProvider } from "@/services/market-data/retail-sentiment/myfxbook";
import { igProvider } from "@/services/market-data/retail-sentiment/ig-provider";
import { getGbpusdRecordCounts } from "@/db/queries/gbpusd-validation";
import { getGbpusdValidation } from "./gbpusd-validation";

const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fmp.getQuote).mockResolvedValue(down);
  vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
  vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
  vi.mocked(fmp.getForexAndMarketNews).mockResolvedValue(down);
  vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
  vi.mocked(fred.getSeries).mockResolvedValue(down);
  vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(down);
  vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(down);
});

describe("getGbpusdValidation", () => {
  it("never throws even when every provider and the database are unreachable", async () => {
    vi.mocked(getGbpusdRecordCounts).mockRejectedValue(new Error("DATABASE_URL is not configured"));

    const { rows, dbCounts, dbError } = await getGbpusdValidation();

    expect(rows.length).toBe(18);
    expect(rows.every((r) => r.status === "unavailable" || r.status === "error")).toBe(true);
    expect(dbCounts).toBeNull();
    expect(dbError).toBe("DATABASE_URL is not configured");
  });

  it("reports live rows and real DB counts when providers and the database succeed", async () => {
    vi.mocked(fmp.getQuote).mockResolvedValue({
      provider: "fmp",
      source: "Financial Modeling Prep",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: { symbol: "GBPUSD", price: 1.27, changePct24h: 0.2, timestamp: new Date().toISOString() },
    });
    vi.mocked(getGbpusdRecordCounts).mockResolvedValue({
      marketPrices: 1,
      marketCandlesDaily: 500,
      marketCandles4h: 200,
      marketCandles1h: 200,
      institutionalPositioning: 156,
      retailSentiment: 40,
      economicIndicatorsUS: 60,
      economicIndicatorsGB: 24,
    });

    const { rows, dbCounts, dbError } = await getGbpusdValidation();

    const fmpQuoteRow = rows.find((r) => r.dataset === "Quotes (GBPUSD)")!;
    expect(fmpQuoteRow.status).toBe("live");
    expect(fmpQuoteRow.records).toBe(1);
    expect(dbError).toBeNull();
    expect(dbCounts?.institutionalPositioning).toBe(156);
  });
});
