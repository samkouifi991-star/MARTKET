import { describe, expect, it } from "vitest";
import { classifyDatasetFreshness } from "./freshness-policy";

const NOW = new Date("2027-01-15T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe("classifyDatasetFreshness", () => {
  it("treats a 7-day-old CFTC report as live, since CFTC publishes weekly", () => {
    expect(classifyDatasetFreshness("cftc", daysAgo(7), NOW)).toBe("live");
  });

  it("treats a 7-day-old FX/market price quote as stale, not live — the exact example from the requirement", () => {
    expect(classifyDatasetFreshness("marketPrice", daysAgo(7), NOW)).toBe("stale");
  });

  it("gives CPI a multi-week live window matching its real publication lag", () => {
    expect(classifyDatasetFreshness("cpi", daysAgo(30), NOW)).toBe("live");
    expect(classifyDatasetFreshness("cpi", daysAgo(60), NOW)).toBe("delayed");
    expect(classifyDatasetFreshness("cpi", daysAgo(100), NOW)).toBe("stale");
  });

  it("gives GDP the widest window of all, matching its quarterly cadence", () => {
    expect(classifyDatasetFreshness("gdp", daysAgo(90), NOW)).toBe("live");
    expect(classifyDatasetFreshness("gdp", daysAgo(150), NOW)).toBe("delayed");
  });

  it("classifies a fresh market price as live and a several-hour-old one as delayed", () => {
    expect(classifyDatasetFreshness("marketPrice", new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("live");
    expect(classifyDatasetFreshness("marketPrice", new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("delayed");
  });

  it("every dataset kind eventually degrades to stale given enough age", () => {
    const kinds = ["marketPrice", "intradayCandles", "dailyCandles", "oandaSentiment", "cftc", "cpi", "gdp", "payrolls", "centralBankRates", "seasonality", "news"] as const;
    for (const kind of kinds) {
      expect(classifyDatasetFreshness(kind, daysAgo(10_000), NOW)).toBe("stale");
    }
  });
});
