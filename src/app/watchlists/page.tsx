import { DEFAULT_WATCHLISTS } from "@/lib/demo/watchlists";
import { getCanonicalMarketRows } from "@/lib/pipeline/top-setups";
import { WatchlistsClient } from "./WatchlistsClient";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Watchlists — Market Intelligence AI" };

// Every price/score shown here must be the same canonical value Top Setups
// and /markets/[symbol] read — never a build-time snapshot. See
// pipeline/top-setups.ts's getCanonicalMarketRows for why.
export const dynamic = "force-dynamic";

export default async function WatchlistsPage() {
  await requireEntitlement();
  const rows = await getCanonicalMarketRows();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSeconds={45} />
      <div>
        <h1 className="text-xl font-semibold">Watchlists</h1>
        <p className="text-sm text-(--text-faint) mt-1">Create multiple watchlists, reorder instruments, and track scores for just the markets you care about.</p>
      </div>
      <WatchlistsClient defaults={DEFAULT_WATCHLISTS} rows={rows} />
    </div>
  );
}
