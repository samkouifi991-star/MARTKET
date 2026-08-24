// OANDA PositionBook — primary retail-sentiment source. Uses OANDA's
// official v20 REST API (developer.oanda.com), which requires only an API
// token (OANDA_API_TOKEN) — no separate account ID is needed for the
// PositionBook endpoint itself. OANDA_ENVIRONMENT selects practice
// (api-fxpractice.oanda.com, the default) vs. live (api-fxtrade.oanda.com)
// hosts; the token itself determines which environment it's valid for.
//
// VERIFY BEFORE LIVE: this sandbox cannot reach api-fxpractice.oanda.com,
// so the response shape below is this project's best-documented
// understanding of OANDA v20's PositionBook schema (developer.oanda.com's
// published Instrument endpoints), not an independently confirmed live
// response — same caveat this project already applies to myfxbook.ts.
// Before trusting this for any symbol: call the endpoint once for a real
// instrument, log the raw response, and confirm the field names below
// (positionBook.buckets[].price/longCountPercent/shortCountPercent) match;
// correct them if OANDA's actual field names differ. This client
// deliberately returns "unavailable"/"error" rather than a silently-wrong
// percentage if the expected shape isn't there.
import { getSymbolMapping } from "../symbol-map";
import { errorResult, Provenance, unavailable } from "../../types";
import { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

const SOURCE = "OANDA PositionBook";

function baseUrl(): string {
  return process.env.OANDA_ENVIRONMENT === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
}

function credentialsConfigured(): boolean {
  return Boolean(process.env.OANDA_API_TOKEN);
}

type PositionBookBucket = { price: string; longCountPercent: string; shortCountPercent: string };
type PositionBookResponse = {
  positionBook?: {
    instrument: string;
    time: string;
    unclassifiedPositionRatio?: string;
    buckets: PositionBookBucket[];
  };
  errorMessage?: string;
};

/**
 * Deterministic bucket aggregation — the only place this math happens.
 *
 * OANDA's PositionBook returns one bucket per price level. Each bucket's
 * longCountPercent/shortCountPercent is the share of ALL open position
 * counts in the book (long+short combined) sitting long/short at that
 * price. Summing longCountPercent across every bucket therefore gives the
 * aggregate long share of the whole book; summing shortCountPercent gives
 * the aggregate short share. Those two sums plus unclassifiedPositionRatio
 * should total the full book (unclassified positions carry no directional
 * bucket, so they're excluded here rather than guessed at).
 *
 * This app's NormalizedRetailSentiment stores pctLong/pctShort as a
 * long-vs-short-only 0-100 split (matching Myfxbook/IG's shape), so the two
 * aggregate sums are renormalized to exclude the unclassified remainder:
 *   pctLong  = aggregateLong  / (aggregateLong + aggregateShort) * 100
 *   pctShort = aggregateShort / (aggregateLong + aggregateShort) * 100
 * This ratio is scale-invariant — it comes out identical whether OANDA
 * expresses bucket percentages as fractions (0-1) or percentages (0-100) —
 * so no assumption about that scale is needed for pctLong/pctShort to be
 * correct. The raw (non-renormalized) sums are still surfaced via
 * aggregateLongWeight/aggregateShortWeight/totalPositioningWeight for
 * transparency, in whatever scale OANDA actually returned them in.
 */
function aggregateBuckets(buckets: PositionBookBucket[]): { aggregateLong: number; aggregateShort: number } {
  let aggregateLong = 0;
  let aggregateShort = 0;
  for (const bucket of buckets) {
    const long = Number(bucket.longCountPercent);
    const short = Number(bucket.shortCountPercent);
    if (Number.isFinite(long)) aggregateLong += long;
    if (Number.isFinite(short)) aggregateShort += short;
  }
  return { aggregateLong, aggregateShort };
}

async function getRetailSentiment(internalSymbol: string): Promise<Provenance<NormalizedRetailSentiment>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping?.oandaInstrument) {
    return unavailable("oanda", SOURCE, `OANDA PositionBook does not cover ${internalSymbol}`);
  }
  if (!credentialsConfigured()) {
    return unavailable("oanda", SOURCE, "OANDA_API_TOKEN not configured");
  }

  try {
    const url = `${baseUrl()}/v3/instruments/${encodeURIComponent(mapping.oandaInstrument)}/positionBook`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.OANDA_API_TOKEN}` },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      // Body may carry OANDA's own errorMessage (e.g. "Invalid Authorization
      // header") — useful for diagnosis, never includes the token itself
      // since we only ever sent it, never received it back.
      const body = await res.text().catch(() => "");
      throw new Error(`OANDA PositionBook request failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
    }

    const data = (await res.json()) as PositionBookResponse;
    const book = data.positionBook;
    if (!book || !Array.isArray(book.buckets) || book.buckets.length === 0) {
      return unavailable("oanda", SOURCE, `OANDA returned no PositionBook buckets for ${mapping.oandaInstrument} — response shape may not match what this client expects (see file header)`);
    }

    const { aggregateLong, aggregateShort } = aggregateBuckets(book.buckets);
    const totalClassified = aggregateLong + aggregateShort;
    if (totalClassified <= 0) {
      return unavailable("oanda", SOURCE, `OANDA PositionBook for ${mapping.oandaInstrument} had no classified long/short positioning to aggregate`);
    }

    const pctLong = (aggregateLong / totalClassified) * 100;
    const pctShort = (aggregateShort / totalClassified) * 100;
    const now = new Date().toISOString();

    return {
      provider: "oanda",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: book.time,
      nextExpectedUpdate: null,
      value: {
        symbol: internalSymbol,
        pctLong,
        pctShort,
        aggregateLongWeight: aggregateLong,
        aggregateShortWeight: aggregateShort,
        totalPositioningWeight: totalClassified,
      },
      raw: book,
    };
  } catch (err) {
    return errorResult("oanda", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export const oandaProvider: RetailSentimentProvider = {
  name: "oanda",
  sourceLabel: SOURCE,
  getRetailSentiment,
};
