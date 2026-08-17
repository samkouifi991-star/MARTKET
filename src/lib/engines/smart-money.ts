// Smart Money engine — deliberately separate from the Institutional
// Positioning factor. Institutional Positioning scores *where* large
// speculators currently stand (absolute net position, current percentile).
// Smart Money scores *how their position is changing* (momentum: is the
// move accelerating, and for how many consecutive weeks), optionally
// cross-checked against retail flow and price to name a divergence signal.
// The two must never read the same underlying number the same way.

export type WeeklyPositioning = { reportDate: string; netPositioning: number };

export type InstitutionalMomentumResult = {
  rawScore: number; // -10..10
  consecutiveWeeks: number; // consecutive weeks moving in the same direction
  direction: "Accumulating" | "Distributing" | "Flat";
  recentAvgWeeklyChange: number;
  historicalAvgAbsWeeklyChange: number;
  explanation: string;
};

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

/** History must be sorted newest-first (index 0 = most recent report). */
export function computeInstitutionalMomentum(classification: string, history: WeeklyPositioning[]): InstitutionalMomentumResult | null {
  if (history.length < 4) return null; // need at least a few weeks to call it momentum, not noise

  const weeklyChanges: number[] = [];
  for (let i = 0; i < history.length - 1; i++) weeklyChanges.push(history[i].netPositioning - history[i + 1].netPositioning);

  let consecutiveWeeks = 0;
  const latestSign = Math.sign(weeklyChanges[0]);
  if (latestSign !== 0) {
    for (const change of weeklyChanges) {
      if (Math.sign(change) === latestSign) consecutiveWeeks++;
      else break;
    }
  }

  const recentWindow = weeklyChanges.slice(0, Math.min(4, weeklyChanges.length));
  const recentAvgWeeklyChange = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length;
  const historicalAvgAbsWeeklyChange = weeklyChanges.reduce((a, b) => a + Math.abs(b), 0) / weeklyChanges.length;

  // Normalize momentum by the contract's own typical weekly swing so this
  // works across instruments with wildly different contract-count scales.
  const normalizedMomentum = historicalAvgAbsWeeklyChange > 0 ? recentAvgWeeklyChange / historicalAvgAbsWeeklyChange : 0;
  const consecutiveBoost = Math.min(consecutiveWeeks, 5) * 0.6; // longer streaks add conviction, capped
  const rawScore = clamp(normalizedMomentum * 3 + Math.sign(normalizedMomentum) * consecutiveBoost);

  const direction: InstitutionalMomentumResult["direction"] = recentAvgWeeklyChange > 0 ? "Accumulating" : recentAvgWeeklyChange < 0 ? "Distributing" : "Flat";

  const explanation =
    consecutiveWeeks >= 2
      ? `${classification} net positioning has been ${direction.toLowerCase()} for ${consecutiveWeeks} consecutive weeks, averaging ${recentAvgWeeklyChange > 0 ? "+" : ""}${Math.round(recentAvgWeeklyChange).toLocaleString()} contracts/week recently versus a typical weekly swing of ${Math.round(historicalAvgAbsWeeklyChange).toLocaleString()}.`
      : `${classification} net positioning changed by ${recentAvgWeeklyChange > 0 ? "+" : ""}${Math.round(recentAvgWeeklyChange).toLocaleString()} contracts on average over the last ${recentWindow.length} weeks — no sustained multi-week streak yet.`;

  return { rawScore, consecutiveWeeks, direction, recentAvgWeeklyChange, historicalAvgAbsWeeklyChange, explanation };
}

export type SmartMoneySignal =
  | "Bullish Smart Money Divergence"
  | "Bearish Smart Money Divergence"
  | "Crowded Institutional Trade"
  | "Retail Capitulation"
  | "Positioning Reversal"
  | "None";

export type DivergenceInput = {
  netPositioning: number;
  netWeeklyChange: number;
  percentile: number | null; // 0-100, 3yr preferred, falls back to 1yr
  priceChangePct: number; // recent price change, e.g. 24h or over the same window as netWeeklyChange
  retail: { pctLong: number; pctShort: number; change7d: number } | null; // null when IG has no coverage for this market
};

export function detectDivergenceSignal(input: DivergenceInput): { signal: SmartMoneySignal; confidence: number; explanation: string } {
  const institutionsBuying = input.netWeeklyChange > 0;
  const institutionsSelling = input.netWeeklyChange < 0;
  const priceRising = input.priceChangePct > 0;
  const institutionsExtreme = input.percentile !== null && (input.percentile >= 85 || input.percentile <= 15);

  if (input.retail) {
    const retailBuying = input.retail.pctLong > 50;
    const retailSelling = input.retail.pctShort > 50;

    if (institutionsBuying && retailSelling && input.retail.pctShort > 55) {
      return {
        signal: "Bullish Smart Money Divergence",
        confidence: 70,
        explanation: `Institutions added ${input.netWeeklyChange.toLocaleString()} net long contracts this week while retail traders leaned short (${input.retail.pctShort.toFixed(0)}%).`,
      };
    }
    if (institutionsSelling && retailBuying && input.retail.pctLong > 55) {
      return {
        signal: "Bearish Smart Money Divergence",
        confidence: 70,
        explanation: `Institutions reduced net length by ${Math.abs(input.netWeeklyChange).toLocaleString()} contracts this week while retail traders leaned long (${input.retail.pctLong.toFixed(0)}%).`,
      };
    }
    if (input.retail.change7d !== 0 && Math.sign(input.netWeeklyChange) !== Math.sign(input.retail.change7d)) {
      return {
        signal: "Positioning Reversal",
        confidence: 48,
        explanation: "Institutional weekly flow and the 7-day retail sentiment trend have moved in opposite directions.",
      };
    }
    if ((input.retail.pctShort > 65 && priceRising) || (input.retail.pctLong > 65 && !priceRising)) {
      return {
        signal: "Retail Capitulation",
        confidence: 55,
        explanation: `Retail positioning is extreme (${input.retail.pctLong > 65 ? input.retail.pctLong.toFixed(0) + "% long" : input.retail.pctShort.toFixed(0) + "% short"}) and moving further from price direction.`,
      };
    }
  }

  if (institutionsExtreme) {
    const confirmed = (input.netPositioning > 0 && priceRising) || (input.netPositioning < 0 && !priceRising);
    if (!confirmed) {
      return {
        signal: "Crowded Institutional Trade",
        confidence: 58,
        explanation: `Institutional net positioning sits at the ${input.percentile}th percentile of its historical range without price confirming the same direction — elevated reversal risk.`,
      };
    }
  }

  return { signal: "None", confidence: 40, explanation: "Institutional and retail positioning are broadly aligned; no notable divergence detected." };
}
