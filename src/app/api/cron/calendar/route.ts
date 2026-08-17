// Economic calendar — every 5-15 minutes around active periods. Maps each
// released event to the markets it affects via the event's currency/country
// (matches "US CPI released -> USD pairs, gold, US indices" from the spec).
import { NextRequest, NextResponse } from "next/server";
import * as fmp from "@/services/market-data/fmp";
import { upsertEconomicEvent } from "@/db/queries/market-data";
import { recordProviderCheck } from "@/db/queries/provider-health";
import { INSTRUMENTS } from "@/lib/instruments";
import { demoModeSkip, isDemoMode, unauthorized, verifyCronAuth } from "../_shared";

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  "United States": "USD",
  US: "USD",
  Eurozone: "EUR",
  EU: "EUR",
  "United Kingdom": "GBP",
  GB: "GBP",
  Japan: "JPY",
  JP: "JPY",
  Switzerland: "CHF",
  CH: "CHF",
  Australia: "AUD",
  AU: "AUD",
  "New Zealand": "NZD",
  NZ: "NZD",
  Canada: "CAD",
  CA: "CAD",
};

function affectedMarketsFor(country: string): string[] {
  const currency = COUNTRY_TO_CURRENCY[country];
  if (!currency) return [];
  const markets = INSTRUMENTS.filter((i) => i.currencies?.includes(currency)).map((i) => i.symbol);
  // USD releases also move gold, silver and the major indices — a stronger
  // structural link than the generic currency-pair match below.
  if (currency === "USD") markets.push("XAUUSD", "XAGUSD", "SPX500", "NAS100", "DJ30", "RUT2000");
  return Array.from(new Set(markets));
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const t0 = Date.now();
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 86_400_000).toISOString();

  const calendar = await fmp.getEconomicCalendar(from, to);
  if (calendar.status !== "live" || !calendar.value) {
    await recordProviderCheck({ provider: "fmp", ok: false, latencyMs: Date.now() - t0, error: calendar.error ?? "calendar unavailable" }).catch(() => {});
    return NextResponse.json({ job: "calendar", okCount: 0, failCount: 1, error: calendar.error }, { status: 502 });
  }

  for (const event of calendar.value) {
    await upsertEconomicEvent(event, affectedMarketsFor(event.country));
  }
  await recordProviderCheck({ provider: "fmp", ok: true, latencyMs: Date.now() - t0 }).catch(() => {});

  return NextResponse.json({ job: "calendar", okCount: calendar.value.length, failCount: 0 });
}
