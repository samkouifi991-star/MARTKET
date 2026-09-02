// Shared helper for the Supabase egress fix's second phase: separating
// Market Detail's fast current-state refresh from its slow chart-history
// refresh by caching the historical resolvers (candles, score history,
// seasonality, CFTC) with unstable_cache. That API requires a real Next.js
// request/build context to attach its cache entry to — calling it from
// anywhere else (this codebase's vitest suite, most directly) throws
// "Invariant: incrementalCache missing" synchronously from inside the
// cached function, not at unstable_cache(...) definition time. Every
// caller of a cached historical resolver in this codebase routes through
// this wrapper so that failure mode degrades to the exact same real,
// uncached read instead of ever breaking a page render or a test.
//
// Lives directly under lib/, not lib/pipeline/, so db/queries/*.ts (a
// lower layer that already imports from lib/*, e.g. lib/types, but never
// from lib/pipeline/*) can use it too — see db/queries/scores.ts's cached
// score-history read.
export async function withCacheFallback<T>(cachedFn: () => Promise<T>, rawFn: () => Promise<T>): Promise<T> {
  try {
    return await cachedFn();
  } catch (err) {
    if (err instanceof Error && err.message.includes("incrementalCache")) return rawFn();
    throw err;
  }
}
