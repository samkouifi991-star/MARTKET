import { InvestorSentiment } from "../types";
import { Rng } from "../rng";
import { NOW } from "../time";

const rng = new Rng("investor-sentiment");

const bullishPct = Math.round(rng.float(28, 52));
const bearishPct = Math.round(rng.float(20, 42));
const neutralPct = Math.max(0, 100 - bullishPct - bearishPct);

export const INVESTOR_SENTIMENT: InvestorSentiment = {
  bullishPct,
  bearishPct,
  neutralPct,
  bullBearSpread: bullishPct - bearishPct,
  fearGreedIndex: Math.round(rng.float(25, 78)),
  volatilityIndex: Number(rng.float(12, 22).toFixed(1)),
  creditSpread: Number(rng.float(0.9, 2.4).toFixed(2)),
  safeHavenDemand: rng.pick(["Low", "Moderate", "High"] as const),
};

export const INVESTOR_SENTIMENT_HISTORY: { date: string; fearGreed: number; vix: number }[] = (() => {
  const arr: { date: string; fearGreed: number; vix: number }[] = [];
  let fg = INVESTOR_SENTIMENT.fearGreedIndex;
  let vix = INVESTOR_SENTIMENT.volatilityIndex;
  for (let i = 89; i >= 0; i--) {
    fg = Math.min(95, Math.max(5, fg + rng.float(-4, 4)));
    vix = Math.min(40, Math.max(10, vix + rng.float(-1, 1)));
    arr.push({ date: new Date(NOW.getTime() - i * 86_400_000).toISOString(), fearGreed: Math.round(fg), vix: Number(vix.toFixed(1)) });
  }
  arr[arr.length - 1] = { date: arr[arr.length - 1].date, fearGreed: INVESTOR_SENTIMENT.fearGreedIndex, vix: INVESTOR_SENTIMENT.volatilityIndex };
  return arr;
})();
