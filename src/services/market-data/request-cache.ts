// Provider-agnostic in-process request cache + coalescing, built to stop
// the exact failure mode that caused FMP 429s: technical.ts, seasonality.ts,
// market-detail.ts, and gbpusd-validation.ts each independently called
// fmp.getDailyCandles("GBPUSD") — 4 real HTTP requests for the same data on
// a single page load, before even counting quote/intraday/news.
//
// Two mechanisms, both keyed by an explicit cache key:
//   1. Coalescing — if a request for a key is already in flight, every
//      caller within that window gets the SAME promise instead of starting
//      a second HTTP request. This is exact and guaranteed within a single
//      execution (e.g. the Promise.all of 9 factor resolvers in
//      scoring-engine.ts), since they share this module's memory.
//   2. TTL caching — once a request resolves, the result is kept for
//      `ttlMs` and served to any caller in that window without a new
//      request at all.
//
// Honest limitation: this is a plain module-level Map, not Redis/Vercel KV
// or the database. It's reliably shared within one execution and
// opportunistically shared across nearby requests on a warm serverless
// instance, but a cold start gets an empty cache. That's an acceptable
// first fix for the immediate 429 problem (which was overwhelmingly
// same-request duplication, not cross-request volume) — a durable
// cross-invocation cache is the "raw storage" stage of the intended
// External API -> raw storage -> factor engine architecture (see
// db/queries/market-data.ts + the cron jobs that populate it), which is
// the real long-term fix once ingestion is running on a schedule instead
// of being triggered by page loads.
type CacheEntry<T> = { value: T; expiresAt: number };

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/** Test/diagnostic use only — production code should never need to force a
 * cache miss; this exists so tests can assert fresh-fetch behavior without
 * depending on module load order between test files. */
export function clearRequestCache(): void {
  cache.clear();
  inFlight.clear();
}
