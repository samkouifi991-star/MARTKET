// Real data for the public landing page's product preview — deliberately
// reuses getTopSetupsRows() (the exact same canonical source /top-setups
// reads) rather than a separate demo/mock dataset, so the landing page can
// never show a fabricated score. See top-setups.ts's own header for why
// this never triggers a live provider call.
import { getTopSetupsRows } from "./top-setups";
import { MarketRow } from "@/lib/market-data";

export type LandingPreview = { rows: MarketRow[]; featured: MarketRow };

export async function getLandingPreview(): Promise<LandingPreview> {
  const rows = await getTopSetupsRows();
  const featured = [...rows].sort((a, b) => Math.abs(b.score.totalScore) - Math.abs(a.score.totalScore))[0] ?? rows[0];
  return { rows, featured };
}
