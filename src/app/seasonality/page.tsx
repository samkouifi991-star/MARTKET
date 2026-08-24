import { INSTRUMENTS } from "@/lib/instruments";
import { monthlySeasonality, weekdaySeasonality } from "@/lib/demo/seasonality";
import { getAllLiveSeasonality } from "@/lib/pipeline/market-detail";
import { SeasonalityClient } from "./SeasonalityClient";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { publicInstruments } from "@/services/market-coverage";

export const metadata = { title: "Seasonality — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function SeasonalityPage() {
  await requireEntitlement();
  const demoMode = isDemoOnly();

  if (demoMode) {
    const monthlyBySymbol: Record<string, ReturnType<typeof monthlySeasonality>> = {};
    const weekdayBySymbol: Record<string, ReturnType<typeof weekdaySeasonality>> = {};
    for (const i of INSTRUMENTS) {
      monthlyBySymbol[i.symbol] = monthlySeasonality(i);
      weekdayBySymbol[i.symbol] = weekdaySeasonality(i);
    }
    return (
      <div className="space-y-6">
        <Header demoMode />
        <SeasonalityClient instruments={INSTRUMENTS} monthlyBySymbol={monthlyBySymbol} weekdayBySymbol={weekdayBySymbol} unavailable={{}} />
      </div>
    );
  }

  const all = await getAllLiveSeasonality();
  const monthlyBySymbol: Record<string, ReturnType<typeof monthlySeasonality>> = {};
  const weekdayBySymbol: Record<string, ReturnType<typeof weekdaySeasonality>> = {};
  const unavailable: Record<string, string> = {};
  for (const { instrument, result, unavailableReason } of all) {
    if (result) {
      monthlyBySymbol[instrument.symbol] = result.monthly;
      weekdayBySymbol[instrument.symbol] = result.weekday;
    } else {
      unavailable[instrument.symbol] = unavailableReason ?? "Data currently unavailable.";
    }
  }

  return (
    <div className="space-y-6">
      <Header demoMode={false} />
      <SeasonalityClient instruments={publicInstruments()} monthlyBySymbol={monthlyBySymbol} weekdayBySymbol={weekdayBySymbol} unavailable={unavailable} />
    </div>
  );
}

function Header({ demoMode }: { demoMode: boolean }) {
  return (
    <div>
      <h1 className="text-xl font-semibold">Seasonality</h1>
      <p className="text-sm text-(--text-faint) mt-1">
        Historical performance by calendar period, computed directly from stored daily closes. Select a market and lookback to compare full distributions, not just averages.
        {!demoMode && " A market with fewer than 3 years of real stored history shows as unavailable rather than an estimated distribution."}
      </p>
    </div>
  );
}
