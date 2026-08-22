// Real data for the public landing page's product preview — deliberately
// reuses getTopSetupsRows() (the exact same canonical source /top-setups
// reads) rather than a separate demo/mock dataset, so the landing page can
// never show a fabricated score. See top-setups.ts's own header for why
// this never triggers a live provider call.
import { getTopSetupsRows } from "./top-setups";
import { resolveSmartMoney, SmartMoneyResolution } from "./positioning";
import { MarketRow } from "@/lib/market-data";

// ETHUSD is the deliberate showcase symbol: it genuinely exercises the
// NOT_APPLICABLE display path (no CFTC-reportable crypto contract, no
// retail-sentiment provider) alongside real live technical/macro/news
// factors, so the landing page can honestly demonstrate both cases.
const FEATURED_SYMBOL = "ETHUSD";

export type LandingPreview = { rows: MarketRow[]; featured: MarketRow; smartMoney: SmartMoneyResolution };

export async function getLandingPreview(): Promise<LandingPreview> {
  const rows = await getTopSetupsRows();
  const featured = rows.find((r) => r.instrument.symbol === FEATURED_SYMBOL) ?? rows[0];
  const smartMoney = await resolveSmartMoney(featured.instrument.symbol);
  return { rows, featured, smartMoney };
}
