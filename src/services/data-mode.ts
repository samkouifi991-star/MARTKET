// Central switch for how the app sources data. Every consumer (scoring
// engine, page components, admin health screen) reads through here rather
// than checking process.env directly, so there is exactly one place that
// decides demo vs. live behavior.
//
//   demo   — current deterministic demo-data generators only (default; this
//            is what's live in production today and what ships until every
//            tracked market is verified against real providers).
//   hybrid — real providers are called where credentials exist; any factor
//            whose provider isn't configured or fails falls back to demo
//            data, but is flagged as demo in its provenance so the UI can
//            show it honestly instead of pretending it's live. Intended for
//            development/staging only.
//   live   — real providers only. A missing/failing provider must render
//            "Data temporarily unavailable" (or "Retail sentiment
//            unavailable" for that specific factor) and lower confidence —
//            never a fabricated or demo value.
export type DataMode = "demo" | "hybrid" | "live";

function readDataMode(): DataMode {
  const raw = (process.env.DATA_MODE ?? "demo").toLowerCase().trim();
  if (raw === "live" || raw === "hybrid") return raw;
  return "demo";
}

export const DATA_MODE: DataMode = readDataMode();

export function isDemoOnly(): boolean {
  return DATA_MODE === "demo";
}

export function allowsLiveProviders(): boolean {
  return DATA_MODE === "live" || DATA_MODE === "hybrid";
}

/** In live mode a missing provider must surface as unavailable, never fall back to demo data. */
export function allowsDemoFallback(): boolean {
  return DATA_MODE === "hybrid";
}
