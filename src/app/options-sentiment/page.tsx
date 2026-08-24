import { INSTRUMENTS } from "@/lib/instruments";
import { generateOptionsSentiment } from "@/lib/demo/options";
import { INVESTOR_SENTIMENT } from "@/lib/demo/investorSentiment";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";

export const metadata = { title: "Options & Investor Sentiment — Market Intelligence AI" };
export const dynamic = "force-dynamic";

// Phase 18 (public-launch demo sweep): put/call ratios, the VIX proxy,
// Fear & Greed, and credit-spread readings here have no real data source
// anywhere in this codebase — no provider integration exists for any of
// them, and building one is out of scope for this pass ("do not add
// another market-data provider"). Demo-mode only; outside demo mode this
// renders an honest "not available yet" state instead of fabricated
// numbers. Hidden from nav outside demo mode too — see Sidebar.tsx.
export default async function OptionsSentimentPage() {
  await requireEntitlement();
  if (!isDemoOnly()) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Options & Investor Sentiment</h1>
        </div>
        <Card>
          <p className="text-sm text-(--text-faint) py-6 text-center">
            Not available yet — this feature requires an options/investor-sentiment data provider not yet connected. It is not shown with estimated data.
          </p>
        </Card>
      </div>
    );
  }
  const indices = INSTRUMENTS.filter((i) => i.assetClass === "Indices").map((i) => ({ instrument: i, options: generateOptionsSentiment(i) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Options &amp; Investor Sentiment</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Put/call positioning for stock indices, plus broader investor sentiment indicators. Extreme readings are flagged as possible contrarian setups but require confirmation from price action or another factor before being treated as a reversal signal.
        </p>
      </div>

      <Card title="Options sentiment by index">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                <th className="py-2 pr-3">Index</th>
                <th className="py-2 px-3 text-right">Put/Call ratio</th>
                <th className="py-2 px-3 text-right">Put volume</th>
                <th className="py-2 px-3 text-right">Call volume</th>
                <th className="py-2 px-3 text-right">20d average</th>
                <th className="py-2 px-3 text-right">Percentile</th>
                <th className="py-2 pl-3">Reading</th>
              </tr>
            </thead>
            <tbody>
              {indices.map((r) => (
                <tr key={r.instrument.symbol} className="border-b border-(--border) last:border-0">
                  <td className="py-2 pr-3 font-medium">{r.instrument.symbol}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.options.putCallRatio.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.options.putVolume.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.options.callVolume.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.options.avg20d.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.options.percentile}th</td>
                  <td className="py-2 pl-3">
                    {r.options.isExtreme ? (
                      <span className="text-amber-400 text-xs font-medium">Extreme — needs confirmation</span>
                    ) : (
                      <span className="text-(--text-faint) text-xs">Normal range</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Broader investor sentiment">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Bullish investors" value={`${INVESTOR_SENTIMENT.bullishPct}%`} />
          <StatTile label="Bearish investors" value={`${INVESTOR_SENTIMENT.bearishPct}%`} />
          <StatTile label="Bull-bear spread" value={`${INVESTOR_SENTIMENT.bullBearSpread > 0 ? "+" : ""}${INVESTOR_SENTIMENT.bullBearSpread}pt`} />
          <StatTile label="Fear &amp; Greed index" value={String(INVESTOR_SENTIMENT.fearGreedIndex)} />
          <StatTile label="Volatility index (VIX proxy)" value={INVESTOR_SENTIMENT.volatilityIndex.toFixed(1)} />
          <StatTile label="High-yield credit spread" value={`${INVESTOR_SENTIMENT.creditSpread.toFixed(2)}%`} />
          <StatTile label="Safe-haven demand" value={INVESTOR_SENTIMENT.safeHavenDemand} />
          <StatTile label="Neutral investors" value={`${INVESTOR_SENTIMENT.neutralPct}%`} />
        </div>
      </Card>
    </div>
  );
}
