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

    const now = new Date().toISOString();
    return {
      provider: "fred",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: points[points.length - 1].date,
      nextExpectedUpdate: null,
      value: points,
      raw: data,
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
