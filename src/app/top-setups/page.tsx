import { allMarketRows } from "@/lib/market-data";
import { TopSetupsTable } from "@/components/tables/TopSetupsTable";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

export const metadata = { title: "Top Market Setups — Market Intelligence AI" };

export default function TopSetupsPage() {
  const rows = allMarketRows();

  return (
    <div>
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Top Market Setups</h1>
          <InfoTooltip text="Every score blends institutional positioning, retail sentiment, technicals, seasonality, growth, inflation, labor, interest rates, and news into one transparent -10..+10 total. Click a row to see the top contributing factors, or open a market for the full breakdown." />
        </div>
        <p className="text-sm text-(--text-faint) mt-1">
          The primary daily dashboard — every supported market ranked by total score, with the full factor breakdown one click away.
        </p>
      </div>
      <TopSetupsTable rows={rows} />
    </div>
  );
}
