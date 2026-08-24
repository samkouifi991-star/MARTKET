import { getCanonicalMarketRows } from "@/lib/pipeline/top-setups";
import { HeatmapClient } from "./HeatmapClient";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Market Heatmap — Market Intelligence AI" };

// Every price/score shown here must be the same canonical value Top Setups
// and /markets/[symbol] read — never a build-time snapshot. See
// pipeline/top-setups.ts's getCanonicalMarketRows for why.
export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  await requireEntitlement();
  const rows = await getCanonicalMarketRows();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSeconds={45} />
      <div>
        <h1 className="text-xl font-semibold">Market Heatmap</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          An interactive view across all tracked markets. Switch between performance, total score, sentiment, volatility and score-change lenses.
        </p>
      </div>
      <HeatmapClient rows={rows} />
    </div>
  );
}
