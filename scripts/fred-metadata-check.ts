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
