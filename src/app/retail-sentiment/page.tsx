import Link from "next/link";
import { INSTRUMENTS } from "@/lib/instruments";
import { generateRetailSentiment } from "@/lib/demo/retail";
import { getAllLiveMarketDetails } from "@/lib/pipeline/market-detail";
import { Card } from "@/components/ui/Card";
import { DEFAULT_RETAIL_SENTIMENT_CONFIG } from "@/lib/config";
import { requireEntitlement } from "@/lib/auth/dal";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";

export const metadata = { title: "Retail Sentiment — Market Intelligence AI" };
export const dynamic = "force-dynamic";

type ContrarianBias = "Bullish" | "Bearish" | "Neutral";
type RetailData = { pctLong: number; pctShort: number; longShortRatio: number; isExtreme: boolean; contrarianBias: ContrarianBias };
type Row = { symbol: string; retail: RetailData | null; unavailableReason: string | null };

function classify(pctLong: number, pctShort: number): { isExtreme: boolean; contrarianBias: ContrarianBias } {
  const { extremeLongThreshold, extremeShortThreshold } = DEFAULT_RETAIL_SENTIMENT_CONFIG;
  const isExtreme = pctLong >= extremeLongThreshold || pctShort >= extremeShortThreshold;
  let contrarianBias: ContrarianBias = "Neutral";
  if (pctLong > extremeLongThreshold) contrarianBias = "Bearish";
  else if (pctShort > extremeShortThreshold) contrarianBias = "Bullish";
  return { isExtreme, contrarianBias };
}

export default async function RetailSentimentPage() {
  await requireEntitlement();
  const demoMode = isDemoOnly();

  let rows: Row[];
  if (demoMode) {
    rows = INSTRUMENTS.map((instrument) => {
      const d = generateRetailSentiment(instrument);
      return { symbol: instrument.symbol, retail: { pctLong: d.pctLong, pctShort: d.pctShort, longShortRatio: d.longShortRatio, isExtreme: d.isExtreme, contrarianBias: d.contrarianBias }, unavailableReason: null };
    });
  } else {
    const all = await getAllLiveMarketDetails(DATA_MODE);
    rows = all.map(({ instrument, detail }) => {
      if (!detail.retail.data) {
        return {
          symbol: instrument.symbol,
          retail: null,
          unavailableReason: detail.retail.freshness === "not_applicable" ? "No retail-sentiment provider covers this market." : (detail.retail.reason ?? "Data temporarily unavailable."),
        };
      }
      const { pctLong, pctShort } = detail.retail.data;
      const { isExtreme, contrarianBias } = classify(pctLong, pctShort);
      return { symbol: instrument.symbol, retail: { pctLong, pctShort, longShortRatio: Math.round((pctLong / pctShort) * 100) / 100, isExtreme, contrarianBias }, unavailableReason: null };
    });
  }

  const withData = rows.filter((r) => r.retail !== null) as (Row & { retail: NonNullable<Row["retail"]> })[];
  const extremes = withData.filter((r) => r.retail.isExtreme).sort((a, b) => Math.max(b.retail.pctLong, b.retail.pctShort) - Math.max(a.retail.pctLong, a.retail.pctShort));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Retail Sentiment</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          {demoMode ? "Estimated" : "Real"} retail positioning aggregated across broker/platform sources. Default contrarian logic: above{" "}
          {DEFAULT_RETAIL_SENTIMENT_CONFIG.extremeLongThreshold}% long or short is treated as extreme.
          {!demoMode && " Markets with no connected retail-sentiment provider, or a currently unavailable feed, are shown as such rather than estimated."}
        </p>
      </div>

      <Card title="Currently extreme" subtitle="Markets crossing the contrarian threshold">
        {extremes.length === 0 ? (
          <p className="text-sm text-(--text-faint)">No markets currently show extreme retail positioning.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {extremes.map((r) => (
              <Link key={r.symbol} href={`/markets/${r.symbol}`} className="rounded-lg border border-(--border) p-3 hover:border-(--border-strong)">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{r.symbol}</span>
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
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                <th className="py-2 pr-3">Market</th>
                <th className="py-2 px-3 text-right">% Long</th>
                <th className="py-2 px-3 text-right">% Short</th>
                <th className="py-2 px-3 text-right">L/S Ratio</th>
                <th className="py-2 px-3">Extreme?</th>
                <th className="py-2 pl-3">Contrarian read</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                  <td className="py-2 pr-3">
                    <Link href={`/markets/${r.symbol}`} className="font-medium hover:text-(--accent)">
                      {r.symbol}
                    </Link>
                  </td>
                  {r.retail ? (
                    <>
                      <td className="py-2 px-3 text-right tabular-nums">{r.retail.pctLong.toFixed(0)}%</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.retail.pctShort.toFixed(0)}%</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.retail.longShortRatio.toFixed(2)}</td>
                      <td className="py-2 px-3">{r.retail.isExtreme ? <span className="text-amber-400 text-xs font-medium">Yes</span> : <span className="text-(--text-faint) text-xs">No</span>}</td>
                      <td className="py-2 pl-3 text-(--text-dim)">{r.retail.contrarianBias}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-2 px-3 text-(--text-faint) text-xs italic">
                      {r.unavailableReason}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
