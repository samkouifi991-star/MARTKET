import { Instrument, SmartMoneyData } from "../types";
import { generatePositioning } from "./positioning";
import { generateRetailSentiment } from "./retail";
import { generatePriceData } from "./price";

const cache = new Map<string, SmartMoneyData>();

export function generateSmartMoney(instrument: Instrument): SmartMoneyData {
  const cached = cache.get(instrument.symbol);
  if (cached) return cached;

  const positioning = generatePositioning(instrument);
  const retail = generateRetailSentiment(instrument);
  const price = generatePriceData(instrument);

  const institutionsBuying = positioning.netWeeklyChange > 0;
  const institutionsSelling = positioning.netWeeklyChange < 0;
  const retailBuying = retail.change24h > 0 && retail.pctLong > 50;
  const retailSelling = retail.change24h < 0 || retail.pctShort > 50;
  const priceRising = price.changePct24h > 0;
  const institutionsExtreme = positioning.percentile >= 85 || positioning.percentile <= 15;
  const retailExtreme = retail.isExtreme;

  let signal: SmartMoneyData["signal"] = "None";
  let explanation = "Institutional and retail positioning are broadly aligned; no notable divergence detected.";
  let confidence = 40;

  if (institutionsBuying && retailSelling && retail.pctShort > 55) {
    signal = "Bullish Smart Money Divergence";
    explanation = `Institutions added ${positioning.netWeeklyChange.toLocaleString()} net long contracts this week while retail traders leaned short (${retail.pctShort.toFixed(0)}%). Historically, agreement between institutional accumulation and retail skepticism favors the institutional side.`;
    confidence = 70;
  } else if (institutionsSelling && retailBuying && retail.pctLong > 55) {
    signal = "Bearish Smart Money Divergence";
    explanation = `Institutions reduced net length by ${Math.abs(positioning.netWeeklyChange).toLocaleString()} contracts this week while retail traders leaned long (${retail.pctLong.toFixed(0)}%). This disagreement has historically favored fading the retail-crowded side.`;
    confidence = 70;
  } else if (institutionsExtreme && !priceRisingConfirmsPositioning(positioning.netPositioning, priceRising)) {
    signal = "Crowded Institutional Trade";
    explanation = `Institutional net positioning sits at the ${positioning.percentile}th percentile of its 3-year range — historically extreme — while price action has not confirmed with a matching trend. Crowded positioning raises reversal risk even without a retail-side divergence.`;
    confidence = 58;
  } else if (retailExtreme && ((retail.pctShort > 65 && priceRising) || (retail.pctLong > 65 && !priceRising))) {
    signal = "Retail Capitulation";
    explanation = `Retail positioning is extreme (${retail.pctLong > 65 ? retail.pctLong.toFixed(0) + "% long" : retail.pctShort.toFixed(0) + "% short"}) and moving further from price direction, consistent with retail capitulation into the prevailing trend.`;
    confidence = 55;
  } else if (Math.sign(positioning.netWeeklyChange) !== 0 && Math.sign(retail.change7d) !== 0 && Math.sign(positioning.netWeeklyChange) !== Math.sign(retail.change7d)) {
    signal = "Positioning Reversal";
    explanation = `Institutional weekly flow and the 7-day retail sentiment trend have moved in opposite directions, an early signal that positioning dynamics may be turning.`;
    confidence = 48;
  }

  const data: SmartMoneyData = { symbol: instrument.symbol, signal, confidence, explanation };
  cache.set(instrument.symbol, data);
  return data;
}

function priceRisingConfirmsPositioning(netPositioning: number, priceRising: boolean): boolean {
  return (netPositioning > 0 && priceRising) || (netPositioning < 0 && !priceRising);
}
