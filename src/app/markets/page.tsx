import Link from "next/link";
import { ASSET_CLASSES } from "@/lib/instruments";
import { getCanonicalMarketRows } from "@/lib/pipeline/top-setups";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { formatPrice, formatSigned, scoreColorClass } from "@/lib/format";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Markets — Market Intelligence AI" };

// Every price/score shown here must be the same canonical value Top Setups
// and /markets/[symbol] read — never a build-time snapshot. See
// pipeline/top-setups.ts's getCanonicalMarketRows for why.
export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  await requireEntitlement();
  const rows = await getCanonicalMarketRows();

  return (
    <div className="space-y-8">
      <AutoRefresh intervalSeconds={45} />
      <div>
        <h1 className="text-xl font-semibold">Markets</h1>
        <p className="text-sm text-(--text-faint) mt-1">All supported instruments, grouped by asset class. Open any market for the full transparent breakdown.</p>
      </div>

      {ASSET_CLASSES.map((cls) => {
        const items = rows.filter((r) => r.instrument.assetClass === cls);
        return (
          <section key={cls}>
            <h2 className="text-sm font-semibold text-(--text-dim) mb-3">{cls}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {items.map((r) => (
                <Link key={r.instrument.symbol} href={`/markets/${r.instrument.symbol}`} className="card p-4 hover:border-(--border-strong) transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{r.instrument.symbol}</div>
                      <div className="text-xs text-(--text-faint)">{r.instrument.name}</div>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${scoreColorClass(r.score.totalScore)}`}>{formatSigned(r.score.totalScore)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm tabular-nums">{formatPrice(r.price.current, r.instrument.decimals)}</span>
                    <BiasBadge bias={r.score.bias} size="sm" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
