// Fetches full series metadata (title/units/frequency/seasonal
// adjustment/last_updated) for series fred-verify.ts confirmed resolve, so
// flipping verified:true means "the metadata matches the intended factor,"
// not just "observations exist." Run this before adding any new country's
// series to fred-series.ts.
//
// Usage: FRED_API_KEY=xxx npm run test:fred-metadata
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

const FRED_BASE = "https://api.stlouisfed.org/fred";

const SERIES_TO_CHECK: { country: string; indicator: string; id: string }[] = [
  { country: "GB", indicator: "realGdp", id: "NGDPRSAXDCGBQ" },
  { country: "GB", indicator: "gdpGrowth", id: "NAEXKP01GBQ657S" },
  { country: "GB", indicator: "cpi", id: "GBRCPIALLMINMEI" },
  { country: "GB", indicator: "unemploymentRate", id: "LRHUTTTTGBM156S" },
  { country: "GB", indicator: "policyRate", id: "IUDSOIA" },
  // EU/JP: needed for EURUSD/USDJPY's macro differential — currently all
  // verified:false in fred-series.ts (never used at runtime, getSeries()
  // refuses unverified series), so this is the same confirmation pass GB
  // went through before it was flipped to verified:true.
  { country: "EU", indicator: "cpi", id: "CP0000EZ19M086NEST" },
  { country: "EU", indicator: "unemploymentRate", id: "LRHUTTTTEZM156S" },
  { country: "EU", indicator: "policyRate", id: "ECBDFR" },
  { country: "JP", indicator: "cpi", id: "JPNCPIALLMINMEI" },
  { country: "JP", indicator: "unemploymentRate", id: "LRHUTTTTJPM156S" },
  // AU/CA: needed for AUDUSD/USDCAD's macro differential — candidates
  // found via fred-verify.ts's live search, same GB pattern. policyRate
  // entries are unconfirmed guesses following CA/CH's existing OECD MEI
  // IRSTCI01 convention — this metadata check IS the confirmation step,
  // not an assumption; if the title doesn't match, it stays unverified.
  { country: "AU", indicator: "realGdp", id: "NGDPRSAXDCAUQ" },
  { country: "AU", indicator: "gdpGrowth", id: "NAEXKP01AUQ657S" },
  { country: "AU", indicator: "policyRate", id: "IRSTCI01AUM156N" },
  { country: "CA", indicator: "realGdp", id: "NGDPRSAXDCCAQ" },
  { country: "CA", indicator: "gdpGrowth", id: "NAEXKP01CAQ657S" },
  { country: "CA", indicator: "policyRate", id: "IRSTCI01CAM156N" },
  { country: "CA", indicator: "cpi", id: "CANCPIALLMINMEI" },
  { country: "CA", indicator: "unemploymentRate", id: "LRHUTTTTCAM156S" },
  { country: "AU", indicator: "cpi", id: "AUSCPIALLQINMEI" },
  { country: "AU", indicator: "unemploymentRate", id: "LRHUTTTTAUM156S" },
  // JP growth/policy-rate: needed for NIKKEI225's full primary local
  // macro model (JP already has cpi/unemploymentRate verified).
  { country: "JP", indicator: "realGdp", id: "NGDPRSAXDCJPQ" },
  { country: "JP", indicator: "gdpGrowth", id: "NAEXKP01JPQ657S" },
  { country: "JP", indicator: "policyRate", id: "IRSTCI01JPM156N" },
  // CH: needed for USDCHF PARTIAL->READY. cpi/policyRate were already
  // configured but never actually metadata-confirmed — confirming them
  // here for the first time alongside the new growth/labor candidates.
  { country: "CH", indicator: "cpi", id: "CHECPIALLMINMEI" },
  { country: "CH", indicator: "policyRate", id: "IRSTCI01CHM156N" },
  { country: "CH", indicator: "realGdp", id: "CLVMNACSAB1GQCH" },
  { country: "CH", indicator: "gdpGrowth", id: "NAEXKP01CHQ657S" },
  { country: "CH", indicator: "unemploymentRate", id: "LRUN64TTCHQ156S" },
  // NZ: needed for NZDUSD PARTIAL->READY. cpi was already configured but
  // never metadata-confirmed.
  { country: "NZ", indicator: "cpi", id: "NZLCPIALLQINMEI" },
  { country: "NZ", indicator: "realGdp", id: "NZLGDPRQPSMEI" },
  { country: "NZ", indicator: "gdpGrowth", id: "NAEXKP01NZQ657S" },
  { country: "NZ", indicator: "unemploymentRate", id: "LRHUTTTTNZQ156S" },
  { country: "NZ", indicator: "policyRate", id: "IRSTCI01NZM156N" },
];

async function main() {
  const key = process.env.FRED_API_KEY;
  if (!key) {
    console.log("FRED_METADATA: FRED_API_KEY not set, skipping");
    return;
  }

  for (const s of SERIES_TO_CHECK) {
    try {
      const url = new URL(`${FRED_BASE}/series`);
      url.searchParams.set("series_id", s.id);
      url.searchParams.set("api_key", key);
      url.searchParams.set("file_type", "json");
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.log(`FRED_METADATA: ${s.country}/${s.indicator} (${s.id}) — HTTP ${res.status} ${res.statusText}`);
        continue;
      }
      const data = (await res.json()) as { seriess?: Record<string, unknown>[] };
      const info = data.seriess?.[0];
      if (!info) {
        console.log(`FRED_METADATA: ${s.country}/${s.indicator} (${s.id}) — no series metadata returned`);
        continue;
      }
      console.log(
        `FRED_METADATA: ${s.country}/${s.indicator} (${s.id}) | title="${info.title}" | units="${info.units}" | frequency="${info.frequency}" | seasonal_adjustment="${info.seasonal_adjustment}" | last_updated="${info.last_updated}" | observation_start="${info.observation_start}" | observation_end="${info.observation_end}"`
      );
    } catch (err) {
      console.log(`FRED_METADATA: ${s.country}/${s.indicator} (${s.id}) — ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => console.log(`FRED_METADATA: unexpected error ${err instanceof Error ? err.message : String(err)}`));
