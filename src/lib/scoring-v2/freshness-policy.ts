// Dataset-specific freshness policy (requirement #18) — a 7-day-old CFTC
// report is genuinely current (CFTC publishes weekly); a 7-day-old FX quote
// is not. Generalizes the ad-hoc cadence tables already scattered across
// the codebase (fred.ts's INDICATOR_CADENCE for FRED series, last-known-
// good.ts's RECENT_STORAGE_WINDOW_MS for prices) into one explicit policy
// table V2 reads from, so every dataset's "how old is too old" answer lives
// in one place instead of being re-derived ad hoc per module.
import { DataFreshness } from "@/lib/types";

export type DatasetKind =
  | "marketPrice"
  | "intradayCandles"
  | "dailyCandles"
  | "oandaSentiment"
  | "cftc"
  | "cpi"
  | "gdp"
  | "payrolls"
  | "centralBankRates"
  | "seasonality"
  | "news";

// live/delayed windows, in DAYS since the observation's own source
// timestamp (never since it was merely stored/fetched — matches this
// codebase's existing "freshness reflects the data's own age" convention).
// Anything older than `delayed` is "stale"; there is never a "never valid"
// ceiling here — a genuinely stale value is still shown, just labeled
// honestly (requirement #17's last-known-good behavior).
const POLICY: Record<DatasetKind, { live: number; delayed: number }> = {
  marketPrice: { live: 0.02, delayed: 0.25 }, // ~30 min live, ~6h delayed — a quote is stale fast
  intradayCandles: { live: 0.1, delayed: 1 }, // ~2.4h live, 1 day delayed
  dailyCandles: { live: 1.5, delayed: 4 },
  oandaSentiment: { live: 1, delayed: 3 },
  cftc: { live: 8, delayed: 16 }, // weekly report — a week-plus-a-bit old is still the current report
  cpi: { live: 45, delayed: 75 }, // monthly, ~2-5 week publication lag is normal
  gdp: { live: 100, delayed: 180 }, // quarterly
  payrolls: { live: 10, delayed: 40 }, // monthly, published promptly (first Friday)
  centralBankRates: { live: 2, delayed: 10 }, // effectively continuous, but a rate doesn't change often
  seasonality: { live: 30, delayed: 400 }, // recomputed from history, not itself "released" on a cadence
  news: { live: 1, delayed: 3 },
};

export function classifyDatasetFreshness(kind: DatasetKind, sourceTimestamp: Date, now: Date = new Date()): DataFreshness {
  const ageDays = (now.getTime() - sourceTimestamp.getTime()) / 86_400_000;
  const policy = POLICY[kind];
  if (ageDays <= policy.live) return "live";
  if (ageDays <= policy.delayed) return "delayed";
  return "stale";
}

export function freshnessPolicyFor(kind: DatasetKind): { live: number; delayed: number } {
  return POLICY[kind];
}
