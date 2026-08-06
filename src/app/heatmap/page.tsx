import { allMarketRows } from "@/lib/market-data";
import { HeatmapClient } from "./HeatmapClient";

export const metadata = { title: "Market Heatmap — Market Intelligence AI" };

export default function HeatmapPage() {
  const rows = allMarketRows();

  return (
    <div className="space-y-6">
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
