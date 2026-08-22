// Real data for the public landing page's product preview — deliberately
// reuses getCanonicalMarketRows() (the exact same canonical source Top
// Setups, Markets, Heatmap, and Watchlists all read) rather than a separate
// demo/mock dataset, so the landing page can never show a fabricated score
// or price. See top-setups.ts's own header for why this never triggers a
// live provider call.
import { getCanonicalMarketRows } from "./top-setups";
import { resolveSmartMoney, SmartMoneyResolution } from "./positioning";
import { MarketRow } from "@/lib/market-data";

// Gold (XAUUSD) is the featured symbol: it has full CFTC, retail-sentiment,
// and Smart Money coverage (see symbol-map.ts), so the landing page's
// showcase card renders a complete, non-NOT_APPLICABLE factor breakdown —
// still the real, current canonical score, never a fabricated one.
const FEATURED_SYMBOL = "XAUUSD";

export type LandingPreview = { rows: MarketRow[]; featured: MarketRow; smartMoney: SmartMoneyResolution };

// Unlike ETHUSD (which short-circuits on "no CFTC contract" before ever
// touching the database), Gold has full CFTC coverage, so resolveSmartMoney
// reaches real DB-backed lookups — same last-known-good-style degradation
// as getCurrentScore's own .catch(() => null) in top-setups.ts above: a
// transient failure here must show "temporarily unavailable" on the
// landing page, never crash it.
async function resolveSmartMoneySafely(symbol: string): Promise<SmartMoneyResolution> {
  return resolveSmartMoney(symbol).catch(
    (): SmartMoneyResolution => ({
      signal: "None",
      confidence: 0,
      explanation: "Smart Money data is temporarily unavailable.",
      provider: "cftc",
      freshness: "error",
    })
  );
}

export async function getLandingPreview(): Promise<LandingPreview> {
  const rows = await getCanonicalMarketRows();
  const featured = rows.find((r) => r.instrument.symbol === FEATURED_SYMBOL) ?? rows[0];
  const smartMoney = await resolveSmartMoneySafely(featured.instrument.symbol);
  return { rows, featured, smartMoney };
}
