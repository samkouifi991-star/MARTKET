// Scorecard — the main Intelligence nav entry point (was "Forex Scorecard").
// A single canonical deep-dive now exists for every market — Forex, Gold/
// Silver, Indices, and Crypto — at markets/[symbol]; this page is just a
// fast, searchable way to get there instead of a second, FX-only
// implementation living at the old /forex-scorecard route (removed). Reads
// the exact same canonical rows every other list page reads
// (getCanonicalMarketRows) — no new data logic, no new provider calls.
import { getCanonicalMarketRows } from "@/lib/pipeline/top-setups";
import { ScorecardSelector } from "@/components/scorecard/ScorecardSelector";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Scorecard — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function ScorecardIndexPage() {
  await requireEntitlement();
  const rows = await getCanonicalMarketRows();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSeconds={45} />
      <div>
        <h1 className="text-xl font-semibold">Scorecard</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          The main deep-dive for any market — directional bias, why it exists, which factors agree or conflict, and what changed recently. Search or filter, then open a market to see its full Scorecard.
        </p>
      </div>
      <ScorecardSelector rows={rows} />
    </div>
  );
}
