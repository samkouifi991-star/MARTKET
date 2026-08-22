import { DEFAULT_WATCHLISTS } from "@/lib/demo/watchlists";
import { allMarketRows } from "@/lib/market-data";
import { WatchlistsClient } from "./WatchlistsClient";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Watchlists — Market Intelligence AI" };

export default async function WatchlistsPage() {
  await requireEntitlement();
  const rows = allMarketRows();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Watchlists</h1>
        <p className="text-sm text-(--text-faint) mt-1">Create multiple watchlists, reorder instruments, and track scores for just the markets you care about.</p>
      </div>
      <WatchlistsClient defaults={DEFAULT_WATCHLISTS} rows={rows} />
    </div>
  );
}
