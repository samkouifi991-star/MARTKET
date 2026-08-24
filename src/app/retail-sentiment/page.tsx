import Link from "next/link";
import { INSTRUMENTS } from "@/lib/instruments";
import { generateRetailSentiment } from "@/lib/demo/retail";
import { Card } from "@/components/ui/Card";
import { formatSigned } from "@/lib/format";
import { DEFAULT_RETAIL_SENTIMENT_CONFIG } from "@/lib/config";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Retail Sentiment — Market Intelligence AI" };

export default async function RetailSentimentPage() {
  await requireEntitlement();
  const rows = INSTRUMENTS.map((instrument) => ({ instrument, retail: generateRetailSentiment(instrument) }));
  const extremes = rows.filter((r) => r.retail.isExtreme).sort((a, b) => Math.max(b.retail.pctLong, b.retail.pctShort) - Math.max(a.retail.pctLong, a.retail.pctShort));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Retail Sentiment</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Estimated retail positioning aggregated across broker/platform sources. Default contrarian logic: above{" "}
          {DEFAULT_RETAIL_SENTIMENT_CONFIG.extremeLongThreshold}% long or short is treated as extreme, with contribution strength scaling as positioning gets more one-sided. Thresholds are admin-configurable.
        </p>
      </div>

      <Card title="Currently extreme" subtitle="Markets crossing the contrarian threshold">
        {extremes.length === 0 ? (
          <p className="text-sm text-(--text-faint)">No markets currently show extreme retail positioning.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {extremes.map((r) => (
              <Link key={r.instrument.symbol} href={`/markets/${r.instrument.symbol}`} className="rounded-lg border border-(--border) p-3 hover:border-(--border-strong)">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{r.instrument.symbol}</span>
                  <span className="text-[10px] rounded-full px-1.5 py-0.5 font-medium text-amber-400 bg-amber-500/10">Extreme</span>
                </div>
                <p className="text-xs text-(--text-dim) mt-1">
                  {r.retail.pctLong.toFixed(0)}% long / {r.retail.pctShort.toFixed(0)}% short
                </p>
                <p className="text-xs text-(--accent) mt-0.5">Contrarian: {r.retail.contrarianBias}</p>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card title="All markets">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                <th className="py-2 pr-3">Market</th>
                <th className="py-2 px-3 text-right">% Long</th>
                <th className="py-2 px-3 text-right">% Short</th>
                <th className="py-2 px-3 text-right">L/S Ratio</th>
                <th className="py-2 px-3 text-right">24h Δ</th>
                <th className="py-2 px-3 text-right">7d Δ</th>
                <th className="py-2 px-3">Extreme?</th>
                <th className="py-2 pl-3">Contrarian read</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.instrument.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                  <td className="py-2 pr-3">
                    <Link href={`/markets/${r.instrument.symbol}`} className="font-medium hover:text-(--accent)">
                      {r.instrument.symbol}
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.retail.pctLong.toFixed(0)}%</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.retail.pctShort.toFixed(0)}%</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.retail.longShortRatio.toFixed(2)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${r.retail.change24h >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatSigned(r.retail.change24h)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${r.retail.change7d >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatSigned(r.retail.change7d)}</td>
                  <td className="py-2 px-3">{r.retail.isExtreme ? <span className="text-amber-400 text-xs font-medium">Yes</span> : <span className="text-(--text-faint) text-xs">No</span>}</td>
                  <td className="py-2 pl-3 text-(--text-dim)">{r.retail.contrarianBias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
