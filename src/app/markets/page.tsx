import Link from "next/link";
import { ASSET_CLASSES } from "@/lib/instruments";
import { getCanonicalMarketRows } from "@/lib/pipeline/top-setups";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { Card } from "@/components/ui/Card";
import { formatPrice, formatSigned, scoreColorClass } from "@/lib/format";
import { formatRelative } from "@/lib/time";
import { requireEntitlement } from "@/lib/auth/dal";
import { ChevronUp, ChevronDown } from "lucide-react";

export const metadata = { title: "Markets — Market Intelligence AI" };

// Every price/score shown here must be the same canonical value Top Setups
// and /markets/[symbol] read — never a build-time snapshot. See
// pipeline/top-setups.ts's getCanonicalMarketRows for why.
export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  await requireEntitlement();
  const rows = await getCanonicalMarketRows();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSeconds={45} />
      <div>
        <h1 className="text-xl font-semibold">Markets</h1>
        <p className="text-sm text-(--text-faint) mt-1">All supported instruments, grouped by asset class. Open any market for the full transparent breakdown — for a single ranked list across all classes, see Top Setups.</p>
      </div>

      {ASSET_CLASSES.map((cls) => {
        const items = rows.filter((r) => r.instrument.assetClass === cls);
        if (items.length === 0) return null;
        return (
          <Card key={cls} title={cls} subtitle={`${items.length} market${items.length === 1 ? "" : "s"}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                    <th className="py-2 pr-3">Market</th>
                    <th className="py-2 px-3 text-right">Price</th>
                    <th className="py-2 px-3 text-right">Score</th>
                    <th className="py-2 px-3">Bias</th>
                    <th className="py-2 px-3">Confidence</th>
                    <th className="py-2 px-3 text-right">24h Δ</th>
                    <th className="py-2 pl-3 text-right">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.instrument.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                      <td className="py-2 pr-3">
                        <Link href={`/markets/${r.instrument.symbol}`} className="font-medium hover:text-(--accent)">
                          {r.instrument.symbol}
                        </Link>
                        <span className="text-(--text-faint) text-xs ml-1.5">{r.instrument.name}</span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatPrice(r.price.current, r.instrument.decimals)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-semibold ${scoreColorClass(r.score.totalScore)}`}>{formatSigned(r.score.totalScore)}</td>
                      <td className="py-2 px-3">
                        <BiasBadge bias={r.score.bias} size="sm" />
                      </td>
                      <td className="py-2 px-3">
                        <ConfidenceBar value={r.score.confidence} compact />
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums ${scoreColorClass(r.score.change24h)}`}>
                        <div className="flex items-center justify-end gap-1">
                          {r.score.change24h >= 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {formatSigned(r.score.change24h)}
                        </div>
                      </td>
                      <td className="py-2 pl-3 text-right text-(--text-faint) text-xs whitespace-nowrap">{formatRelative(r.score.lastUpdated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
