import Link from "next/link";
import { allMarketRows } from "@/lib/market-data";
import { Card } from "@/components/ui/Card";
import { formatPrice, formatSigned, formatSignedPct, scoreColorClass } from "@/lib/format";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Technical Trends — Market Intelligence AI" };

export default async function TechnicalTrendsPage() {
  await requireEntitlement();
  const rows = allMarketRows();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Technical Trends</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Moving-average alignment, momentum, and trend strength for every market. Overextended RSI is flagged as reversal risk but does not automatically flip the score.
        </p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                <th className="py-2 pr-3">Market</th>
                <th className="py-2 px-3 text-right">Price</th>
                <th className="py-2 px-3 text-right">20 EMA</th>
                <th className="py-2 px-3 text-right">50 SMA</th>
                <th className="py-2 px-3 text-right">100 SMA</th>
                <th className="py-2 px-3 text-right">200 SMA</th>
                <th className="py-2 px-3 text-right">RSI(14)</th>
                <th className="py-2 px-3 text-right">ADX(14)</th>
                <th className="py-2 px-3 text-right">10d ROC</th>
                <th className="py-2 px-3">Structure</th>
                <th className="py-2 pl-3 text-right">Technical Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tech = r.score.factors.find((f) => f.key === "technical")!;
                return (
                  <tr key={r.instrument.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                    <td className="py-2 pr-3">
                      <Link href={`/markets/${r.instrument.symbol}`} className="font-medium hover:text-(--accent)">
                        {r.instrument.symbol}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatPrice(r.price.current, r.instrument.decimals)}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${r.price.current > r.price.ema20 ? "text-emerald-400" : "text-rose-400"}`}>{formatPrice(r.price.ema20, r.instrument.decimals)}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${r.price.current > r.price.sma50 ? "text-emerald-400" : "text-rose-400"}`}>{formatPrice(r.price.sma50, r.instrument.decimals)}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${r.price.current > r.price.sma100 ? "text-emerald-400" : "text-rose-400"}`}>{formatPrice(r.price.sma100, r.instrument.decimals)}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${r.price.current > r.price.sma200 ? "text-emerald-400" : "text-rose-400"}`}>{formatPrice(r.price.sma200, r.instrument.decimals)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      <span className={r.price.rsi14 > 70 || r.price.rsi14 < 30 ? "text-amber-400 font-medium" : ""}>{r.price.rsi14.toFixed(0)}</span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.price.adx14.toFixed(0)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatSignedPct(r.price.roc10)}</td>
                    <td className="py-2 px-3 text-(--text-faint) text-xs">{r.price.structure}</td>
                    <td className={`py-2 pl-3 text-right tabular-nums font-semibold ${scoreColorClass(tech.rawScore)}`}>{formatSigned(tech.rawScore)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
