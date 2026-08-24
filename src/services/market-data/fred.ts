// FRED (Federal Reserve Economic Data) client — macroeconomic fundamentals.
// The only place in the app allowed to call api.stlouisfed.org.
// Requires FRED_API_KEY (free, instant self-serve at
// https://fred.stlouisfed.org/docs/api/api_key.html).
import { FredIndicatorKey, getFredSeriesId } from "./fred-series";
import { errorResult, FredSeriesPoint, Provenance, unavailable } from "../types";

const FRED_BASE = "https://api.stlouisfed.org/fred";
const SOURCE = "FRED (Federal Reserve Economic Data)";

function apiKey(): string | null {
  return process.env.FRED_API_KEY?.trim() || null;
}

// API availability and data freshness are separate concepts: a series can
// resolve successfully (the HTTP call succeeds, real observations come
// back) while still being months behind — GB CPI (GBRCPIALLMINMEI) is the
// concrete case that motivated this: it resolves fine but FRED's own last
// observation was ~17 months old at verification time. A successful fetch
// must not automatically mean "live". Cadence is standard domain knowledge
// per indicator (CPI/unemployment/payrolls publish monthly, GDP quarterly,
// policy rates effectively daily), not derived per-call, so this needs no
// extra API request.
type FredCadence = "daily" | "weekly" | "monthly" | "quarterly";

const INDICATOR_CADENCE: Record<FredIndicatorKey, FredCadence> = {
  realGdp: "quarterly",
  gdpGrowth: "quarterly",
  industrialProduction: "monthly",
  retailSales: "monthly",
  cpi: "monthly",
  coreCpi: "monthly",
  pce: "monthly",
  corePce: "monthly",
  ppi: "monthly",
  unemploymentRate: "monthly",
  payrolls: "monthly",
  initialClaims: "weekly",
  wageGrowth: "monthly",
  laborParticipation: "monthly",
  policyRate: "daily",
  yield2y: "daily",
  yield10y: "daily",
  realYield10y: "daily",
  breakevenInflation10y: "daily",
  usdIndexBroad: "daily",
  vix: "daily",
};

// Generous windows (real-world publication lag, not the raw cadence
// itself) — e.g. monthly CPI is typically released 2-5 weeks after the
// reference month ends, so a ~45-day-old CPI print is still genuinely
// current, not delayed.
const CADENCE_WINDOW_DAYS: Record<FredCadence, { live: number; delayed: number }> = {
  daily: { live: 5, delayed: 14 },
  weekly: { live: 14, delayed: 30 },
  monthly: { live: 60, delayed: 120 },
  quarterly: { live: 150, delayed: 270 },
};

export type FredFreshness = "live" | "delayed" | "stale";

export function classifyFredFreshness(indicator: FredIndicatorKey, latestObservationDateIso: string): { freshness: FredFreshness; ageDays: number; cadence: FredCadence } {
  const cadence = INDICATOR_CADENCE[indicator];
  const ageDays = Math.round((Date.now() - new Date(latestObservationDateIso).getTime()) / 86_400_000);
  const window = CADENCE_WINDOW_DAYS[cadence];
  const freshness: FredFreshness = ageDays <= window.live ? "live" : ageDays <= window.delayed ? "delayed" : "stale";
  return { freshness, ageDays, cadence };
}

async function fredGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("FRED_API_KEY is not configured");
  const url = new URL(`${FRED_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`FRED request failed: ${res.status} ${res.statusText} (${path})`);
  return (await res.json()) as T;
}

export async function getSeries(country: string, indicator: FredIndicatorKey, limit = 24): Promise<Provenance<FredSeriesPoint[]>> {
  const series = getFredSeriesId(country, indicator);
  if (!series) return unavailable("fred", SOURCE, `No FRED series mapped for ${country}/${indicator}`);
  if (!series.verified) {
    return unavailable(
      "fred",
      SOURCE,
      `FRED series ${series.id} for ${country}/${indicator} is unverified — confirm via searchSeries() before enabling`
    );
  }

  try {
    type FredObservations = { observations: { date: string; value: string }[] };
    const data = await fredGet<FredObservations>("/series/observations", {
      series_id: series.id,
      sort_order: "desc",
      limit: String(limit),
    });

    const points: FredSeriesPoint[] = data.observations
      .filter((o) => o.value !== ".") // FRED uses "." for missing observations
      .map((o) => ({ date: o.date, value: Number(o.value) }))
      .reverse(); // oldest-first, matching the rest of the app's series convention

    if (points.length === 0) return unavailable("fred", SOURCE, `No observations for ${series.id}`);

    const latestObservationDate = points[points.length - 1].date;
    const { freshness, ageDays, cadence } = classifyFredFreshness(indicator, latestObservationDate);

    const now = new Date().toISOString();
    return {
      provider: "fred",
      source: SOURCE,
      status: freshness,
      fetchedAt: now,
      sourceUpdatedAt: latestObservationDate,
      nextExpectedUpdate: null,
      value: points,
      raw: data,
      ...(freshness !== "live" ? { error: `Latest ${series.id} observation is ${latestObservationDate} (~${ageDays}d old, ${cadence} cadence) — ${freshness}, not current` } : {}),
    };
  } catch (err) {
    return errorResult("fred", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

/** Look up candidate FRED series by keyword — use this to confirm/replace the
 * unverified IDs in fred-series.ts rather than guessing. */
export async function searchSeries(searchText: string): Promise<{ id: string; title: string; frequency: string }[]> {
  type FredSearchResult = { seriess: { id: string; title: string; frequency: string }[] };
  const data = await fredGet<FredSearchResult>("/series/search", { search_text: searchText, limit: "10" });
  return data.seriess.map((s) => ({ id: s.id, title: s.title, frequency: s.frequency }));
}
