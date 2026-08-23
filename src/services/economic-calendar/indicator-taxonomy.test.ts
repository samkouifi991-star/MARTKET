import { describe, expect, it } from "vitest";
import { IMPORTANCE_TIER, matchIndicator } from "./indicator-taxonomy";
import { EconomicIndicatorKey } from "./indicator-taxonomy";

describe("matchIndicator", () => {
  it("matches realistic FMP-style event names for the major inflation releases", () => {
    expect(matchIndicator("CPI m/m")).toBe("cpi");
    expect(matchIndicator("Core CPI m/m")).toBe("coreCpi");
    expect(matchIndicator("PPI m/m")).toBe("ppi");
    expect(matchIndicator("Core PPI m/m")).toBe("corePpi");
    expect(matchIndicator("Core PCE Price Index m/m")).toBe("corePce");
    expect(matchIndicator("PCE Price Index m/m")).toBe("pce");
  });

  it("never misclassifies a Core release as its headline counterpart (priority ordering)", () => {
    expect(matchIndicator("Core CPI y/y")).not.toBe("cpi");
    expect(matchIndicator("Core PPI y/y")).not.toBe("ppi");
    expect(matchIndicator("Core PCE Price Index y/y")).not.toBe("pce");
  });

  it("matches the major labor releases", () => {
    expect(matchIndicator("Non-Farm Payrolls")).toBe("nfp");
    expect(matchIndicator("Unemployment Rate")).toBe("unemploymentRate");
    expect(matchIndicator("Average Hourly Earnings m/m")).toBe("avgHourlyEarnings");
    expect(matchIndicator("Initial Jobless Claims")).toBe("joblessClaims");
    expect(matchIndicator("Continuing Jobless Claims")).toBe("continuingClaims");
    expect(matchIndicator("JOLTS Job Openings")).toBe("jolts");
    expect(matchIndicator("ADP Nonfarm Employment Change")).toBe("adpEmployment");
  });

  it("matches the major growth releases", () => {
    expect(matchIndicator("GDP q/q")).toBe("gdp");
    expect(matchIndicator("Retail Sales m/m")).toBe("retailSales");
    expect(matchIndicator("Industrial Production m/m")).toBe("industrialProduction");
    expect(matchIndicator("Durable Goods Orders m/m")).toBe("durableGoods");
    expect(matchIndicator("ISM Manufacturing PMI")).toBe("ismManufacturing");
    expect(matchIndicator("ISM Services PMI")).toBe("ismServices");
    expect(matchIndicator("S&P Global Manufacturing PMI")).toBe("spGlobalManufacturingPmi");
    expect(matchIndicator("S&P Global Services PMI")).toBe("spGlobalServicesPmi");
  });

  it("matches central bank events across the major currencies", () => {
    expect(matchIndicator("Fed Interest Rate Decision")).toBe("fedRateDecision");
    expect(matchIndicator("FOMC Statement")).toBe("fomcStatement");
    expect(matchIndicator("FOMC Meeting Minutes")).toBe("fomcMinutes");
    expect(matchIndicator("Powell Speaks")).toBe("powellPressConference");
    expect(matchIndicator("ECB Interest Rate Decision")).toBe("ecbRateDecision");
    expect(matchIndicator("BOE Interest Rate Decision")).toBe("boeRateDecision");
    expect(matchIndicator("BOJ Interest Rate Decision")).toBe("bojRateDecision");
    expect(matchIndicator("SNB Interest Rate Decision")).toBe("snbRateDecision");
    expect(matchIndicator("BOC Interest Rate Decision")).toBe("bocRateDecision");
    expect(matchIndicator("RBA Interest Rate Decision")).toBe("rbaRateDecision");
    expect(matchIndicator("RBNZ Interest Rate Decision")).toBe("rbnzRateDecision");
  });

  it("matches the remaining high-impact releases", () => {
    expect(matchIndicator("CB Consumer Confidence")).toBe("consumerConfidence");
    expect(matchIndicator("Michigan Consumer Sentiment")).toBe("michiganSentiment");
    expect(matchIndicator("Michigan Inflation Expectations")).toBe("michiganInflationExpectations");
    expect(matchIndicator("Building Permits")).toBe("housingData");
    expect(matchIndicator("Trade Balance")).toBe("tradeBalance");
    expect(matchIndicator("Nonfarm Productivity")).toBe("productivity");
    expect(matchIndicator("Unit Labor Costs")).toBe("unitLaborCosts");
  });

  it("is case-insensitive", () => {
    expect(matchIndicator("cpi m/m")).toBe("cpi");
    expect(matchIndicator("NON-FARM PAYROLLS")).toBe("nfp");
  });

  it("returns null for an event that doesn't match anything, rather than guessing", () => {
    expect(matchIndicator("Some Obscure Regional Confidence Survey")).toBeNull();
  });
});

describe("IMPORTANCE_TIER", () => {
  it("classifies the headline market-moving releases as HIGH", () => {
    const highImpact: EconomicIndicatorKey[] = ["cpi", "coreCpi", "nfp", "unemploymentRate", "gdp", "fedRateDecision", "fomcStatement", "dotPlot", "powellPressConference"];
    for (const key of highImpact) expect(IMPORTANCE_TIER[key]).toBe("HIGH");
  });

  it("classifies minor/secondary releases as LOW", () => {
    const lowImpact: EconomicIndicatorKey[] = ["joblessClaims", "continuingClaims", "industrialProduction", "durableGoods", "consumerConfidence", "housingData", "tradeBalance"];
    for (const key of lowImpact) expect(IMPORTANCE_TIER[key]).toBe("LOW");
  });

  it("has a tier for every key in the taxonomy (exhaustiveness is enforced by TypeScript on the Record type itself)", () => {
    expect(Object.keys(IMPORTANCE_TIER).length).toBeGreaterThan(30);
  });
});
