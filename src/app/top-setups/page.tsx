import { getTopSetupsRows } from "@/lib/pipeline/top-setups";
import { TopSetupsTable } from "@/components/tables/TopSetupsTable";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Top Market Setups — Market Intelligence AI" };

// Every score here must be the same canonical value /markets/[symbol]
// computes — never a build-time snapshot. force-dynamic makes this route
// render fresh (a real Neon read) on every request instead of being
// prerendered once at build time and served frozen until the next deploy;
// AutoRefresh below keeps it current for a tab a user leaves open, since a
// server component can't re-run itself on a timer on its own.
export const dynamic = "force-dynamic";

export default async function TopSetupsPage() {
  await requireEntitlement();
  const rows = await getTopSetupsRows();

  return (
    <div>
      <AutoRefresh intervalSeconds={45} />
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
