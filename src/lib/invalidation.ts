import { Instrument, MarketScore, PositioningData, PriceData, RetailSentimentData } from "./types";
import { upcomingHighImpact } from "./demo/calendar";
import { formatPrice } from "./format";

export function invalidationFactors(
  instrument: Instrument,
  score: MarketScore,
  price: PriceData,
  positioning: PositioningData,
  retail: RetailSentimentData
): string[] {
  const isBullish = score.totalScore > 0;
  const points: string[] = [];

  const ratesFactor = score.factors.find((f) => f.key === "interestRates")!;
  points.push(
    isBullish
      ? `Central bank commentary turns more dovish than currently priced, eroding the ${formatSignedNoPct(ratesFactor.contribution)} interest-rate contribution.`
      : `Central bank commentary turns more hawkish than currently priced, reversing the ${formatSignedNoPct(ratesFactor.contribution)} interest-rate contribution.`
  );

  points.push(
    isBullish
      ? `Price closes below the 200-day moving average (currently ${formatPrice(price.sma200, instrument.decimals)}), invalidating the bullish technical structure.`
      : `Price closes above the 200-day moving average (currently ${formatPrice(price.sma200, instrument.decimals)}), invalidating the bearish technical structure.`
  );

  points.push(
    isBullish
      ? `Institutional traders reduce long exposure sharply — net positioning is currently ${positioning.percentile}th percentile; a fast unwind would flip the institutional contribution negative.`
      : `Institutional traders cover short exposure sharply — net positioning is currently ${positioning.percentile}th percentile; a fast unwind would flip the institutional contribution positive.`
  );

  const nextEvents = upcomingHighImpact(96).filter((e) => e.affectedMarkets.some((m) => instrument.currencies?.includes(m) || m === instrument.symbol));
  if (nextEvents[0]) {
    points.push(`${nextEvents[0].event} (${nextEvents[0].country}) misses expectations, which would move the economic growth or inflation contribution against the current bias.`);
  } else {
    points.push(`An unscheduled high-impact data release or central bank surprise moves the growth or inflation contribution against the current bias.`);
  }

  points.push(
    retail.contrarianBias !== "Neutral"
      ? `Retail positioning becomes even more one-sided (currently ${retail.pctLong.toFixed(0)}% long / ${retail.pctShort.toFixed(0)}% short), which would further strengthen — not weaken — the existing contrarian read; watch for a sudden reversal in retail flow instead.`
      : `Retail positioning becomes overcrowded in the direction of the current bias, introducing contrarian risk that isn't yet present.`
  );

  points.push(`A major geopolitical or risk-sentiment shift strengthens the opposing side of this market faster than the scoring engine's next update cycle.`);

  return points;
}

function formatSignedNoPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
