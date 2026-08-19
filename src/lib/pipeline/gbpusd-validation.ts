// GBPUSD dependency-chain validation — distinct from the general Provider
// Health page (which reports aggregate provider status across all 25
// markets). This lives-calls every real dependency the GBPUSD score and
// market-detail page actually read from, specifically for GBPUSD, and
// reports it next to how many rows raw storage has for it — proving the
// full External API -> raw storage -> factor engine chain, not just that a
// request succeeded. Never fabricates a row: an unreachable DB reports the
// error rather than a fake zero.
import { DataFreshness } from "@/lib/types";
import * as fmp from "@/services/market-data/fmp";
import * as cftc from "@/services/market-data/cftc";
import * as fred from "@/services/market-data/fred";
import { diagnoseMyfxbookConnection, MyfxbookDiagnostic, myfxbookProvider } from "@/services/market-data/retail-sentiment/myfxbook";
import { igProvider } from "@/services/market-data/retail-sentiment/ig-provider";
import { getGbpusdRecordCounts, GbpusdRecordCounts } from "@/db/queries/gbpusd-validation";

const SYMBOL = "GBPUSD";

export type ValidationRow = {
  provider: string;
  dataset: string;
  status: DataFreshness;
  lastFetch: string | null;
  sourceTimestamp: string | null;
  records: number | string;
  factorUsing: string;
  detail?: string;
};

type Fetched = { status: DataFreshness; fetchedAt: string; sourceUpdatedAt: string | null; error?: string };

function toRow(provider: string, dataset: string, p: Fetched, records: number | string, factorUsing: string): ValidationRow {
  return { provider, dataset, status: p.status, lastFetch: p.fetchedAt, sourceTimestamp: p.sourceUpdatedAt, records, factorUsing, detail: p.error };
}

export async function getGbpusdValidation(): Promise<{ rows: ValidationRow[]; dbCounts: GbpusdRecordCounts | null; dbError: string | null; myfxbookDiagnostic: MyfxbookDiagnostic }> {
  const [
    quote,
    daily,
    h4,
    h1,
    news,
    positioning,
    usCpi,
    usCoreCpi,
    usGdpGrowth,
    usUnemployment,
    usPayrolls,
    usPolicyRate,
    gbCpi,
    gbUnemployment,
    gbPolicyRate,
    gbGdpGrowth,
    myfxbook,
    ig,
    myfxbookDiagnostic,
  ] = await Promise.all([
    fmp.getQuote(SYMBOL),
    fmp.getDailyCandles(SYMBOL),
    fmp.getIntradayCandles(SYMBOL, "4hour"),
    fmp.getIntradayCandles(SYMBOL, "1hour"),
    fmp.getForexAndMarketNews(50),
    cftc.getInstitutionalPositioning(SYMBOL),
    fred.getSeries("US", "cpi"),
    fred.getSeries("US", "coreCpi"),
    fred.getSeries("US", "gdpGrowth"),
    fred.getSeries("US", "unemploymentRate"),
    fred.getSeries("US", "payrolls"),
    fred.getSeries("US", "policyRate"),
    fred.getSeries("GB", "cpi"),
    fred.getSeries("GB", "unemploymentRate"),
    fred.getSeries("GB", "policyRate"),
    fred.getSeries("GB", "gdpGrowth"),
    myfxbookProvider.getRetailSentiment(SYMBOL),
    igProvider.getRetailSentiment(SYMBOL),
    diagnoseMyfxbookConnection(SYMBOL),
  ]);

  let dbCounts: GbpusdRecordCounts | null = null;
  let dbError: string | null = null;
  try {
    dbCounts = await getGbpusdRecordCounts();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  const r = (n: number | undefined) => (dbCounts ? (n ?? 0) : dbError ? "error" : "—");

  const rows: ValidationRow[] = [
    toRow("FMP", "Quotes (GBPUSD)", quote, r(dbCounts?.marketPrices), "Price, Technical Trend"),
    toRow("FMP", "Daily candles (GBPUSD)", daily, r(dbCounts?.marketCandlesDaily), "Technical Trend, Seasonality, Price chart"),
    toRow("FMP", "4H candles (GBPUSD)", h4, r(dbCounts?.marketCandles4h), "Technical Trend (intraday confirmation)"),
    toRow("FMP", "1H candles (GBPUSD)", h1, r(dbCounts?.marketCandles1h), "Technical Trend (intraday confirmation)"),
    toRow("FMP", "Forex/market news", news, "—", "News"),
    toRow("CFTC", "GBP futures positioning (Asset Manager)", positioning, r(dbCounts?.institutionalPositioning), "Institutional Positioning, Smart Money"),
    toRow("FRED", "US CPI", usCpi, r(dbCounts?.economicIndicatorsUS), "Inflation"),
    toRow("FRED", "US Core CPI", usCoreCpi, r(dbCounts?.economicIndicatorsUS), "Inflation"),
    toRow("FRED", "US GDP growth", usGdpGrowth, r(dbCounts?.economicIndicatorsUS), "Economic Growth"),
    toRow("FRED", "US unemployment rate", usUnemployment, r(dbCounts?.economicIndicatorsUS), "Labor Market"),
    toRow("FRED", "US payrolls", usPayrolls, r(dbCounts?.economicIndicatorsUS), "Labor Market"),
    toRow("FRED", "US policy rate (Fed Funds)", usPolicyRate, r(dbCounts?.economicIndicatorsUS), "Interest Rates"),
    toRow("FRED", "GB CPI", gbCpi, r(dbCounts?.economicIndicatorsGB), "Inflation"),
    toRow("FRED", "GB unemployment rate", gbUnemployment, r(dbCounts?.economicIndicatorsGB), "Labor Market"),
    toRow("FRED", "GB policy rate (Bank Rate / SONIA)", gbPolicyRate, r(dbCounts?.economicIndicatorsGB), "Interest Rates"),
    toRow("FRED", "GB GDP growth", gbGdpGrowth, r(dbCounts?.economicIndicatorsGB), "Economic Growth"),
    toRow("Myfxbook", "GBPUSD Community Outlook", myfxbook, r(dbCounts?.retailSentiment), "Retail Sentiment (primary)"),
    toRow("IG", "GBPUSD Client Sentiment", ig, "—", "Retail Sentiment (secondary, optional)"),
  ];

  return { rows, dbCounts, dbError, myfxbookDiagnostic };
}
