import { INSTRUMENTS } from "@/lib/instruments";
import { monthlySeasonality, weekdaySeasonality } from "@/lib/demo/seasonality";
import { SeasonalityClient } from "./SeasonalityClient";

export const metadata = { title: "Seasonality — Market Intelligence AI" };

export default function SeasonalityPage() {
  const monthlyBySymbol: Record<string, ReturnType<typeof monthlySeasonality>> = {};
  const weekdayBySymbol: Record<string, ReturnType<typeof weekdaySeasonality>> = {};
  for (const i of INSTRUMENTS) {
    monthlyBySymbol[i.symbol] = monthlySeasonality(i);
    weekdayBySymbol[i.symbol] = weekdaySeasonality(i);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Seasonality</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Historical performance by calendar period. Select a market and lookback to compare full distributions, not just averages.
        </p>
      </div>
      <SeasonalityClient instruments={INSTRUMENTS} monthlyBySymbol={monthlyBySymbol} weekdayBySymbol={weekdayBySymbol} />
    </div>
  );
}
