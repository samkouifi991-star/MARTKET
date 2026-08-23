import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { StatTile } from "@/components/ui/StatTile";
import { formatDateTime, formatRelative } from "@/lib/time";
import { DATA_MODE, isDemoOnly, strictLiveSymbolList } from "@/services/data-mode";
import { getAllCurrentScoresV2, getLatestShadowComparisons, getRecentIntegrityErrors } from "@/db/queries/scoring-v2";
import { computeScoreChangeAttribution } from "@/lib/scoring-v2/attribution";
import { requireAdmin } from "@/lib/auth/dal";
import { Bias } from "@/lib/types";

export const metadata = { title: "Scoring Engine V2 — Admin — Market Intelligence AI" };
// Reads the database directly (V2's own shadow tables, never V1's) — no
// live provider calls happen on render, so per-request revalidation is safe.
export const dynamic = "force-dynamic";

export default async function ScoringV2Page() {
  await requireAdmin();
  const demoMode = isDemoOnly();

  return (
    <div className="space-y-6">
      <Link href="/admin" className="inline-flex items-center gap-1 text-xs text-(--text-faint) hover:text-(--text-dim)">
        <ArrowLeft size={13} /> Back to Admin
      </Link>

      <div>
        <h1 className="text-xl font-semibold">Scoring Engine V2 (shadow mode)</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          V2 runs the full event-driven, asset-specific engine — economic-release surprises, event shocks with decay, hysteresis,
          smoothing, factor-family caps, and an integrity check before every publish — against its own separate tables. It is not
          shown to regular users and has no effect on Dashboard, Top Setups, Market Detail, Heatmap, Watchlists, or the AI Analyst.
          This page exists purely to compare V1 and V2 side by side before any decision to promote V2. DATA_MODE is currently{" "}
          <code className="text-(--text-dim)">{DATA_MODE}</code>.
        </p>
      </div>

      {demoMode ? (
        <Card title="V1 vs V2 comparison">
          <p className="text-sm text-(--text-faint)">
            Scoring Engine V2 only runs when <code className="text-(--text-dim)">DATA_MODE</code> is{" "}
            <code className="text-(--text-dim)">hybrid</code> or <code className="text-(--text-dim)">live</code>. Currently running in
            demo mode — nothing to compare.
          </p>
        </Card>
      ) : (
        <ScoringV2Body />
      )}
    </div>
  );
}

async function ScoringV2Body() {
  const symbols = strictLiveSymbolList();
  const [comparisons, currentV2, integrityErrors] = await Promise.all([
    getLatestShadowComparisons(),
    getAllCurrentScoresV2(),
    getRecentIntegrityErrors(20),
  ]);

  const rows = symbols
    .map((symbol) => ({ symbol, comparison: comparisons.get(symbol) ?? null, v2: currentV2.get(symbol) ?? null }))
    .filter((r) => r.comparison || r.v2);

  const attributions = await Promise.all(rows.map((r) => computeScoreChangeAttribution(r.symbol)));

  const compared = rows.filter((r) => r.comparison).length;
  const agreeingBias = rows.filter((r) => r.comparison && r.comparison.v1Bias === r.comparison.v2Bias).length;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Strict-live markets" value={String(symbols.length)} />
        <StatTile label="With a V1/V2 comparison" value={String(compared)} />
        <StatTile label="Bias agrees (V1 vs V2)" value={compared > 0 ? `${agreeingBias}/${compared}` : "—"} />
        <StatTile
          label="Integrity errors (recent)"
          value={String(integrityErrors.length)}
          valueClassName={integrityErrors.length > 0 ? "text-amber-400" : undefined}
        />
      </div>

      <Card
        title="V1 vs V2 — current score comparison"
        subtitle="Snapshot taken at each V2 computation cycle, alongside V1's score at that same moment"
      >
        {rows.length === 0 ? (
          <p className="text-sm text-(--text-faint)">
            No V2 shadow computations yet. Use <span className="text-(--text-dim)">Recompute V2 now</span> on the main Admin page to
            run the first cycle.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-(--text-faint) border-b border-(--border)">
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">V1 score</th>
                  <th className="py-2 pr-3 font-medium">V1 bias</th>
                  <th className="py-2 pr-3 font-medium">V2 score</th>
                  <th className="py-2 pr-3 font-medium">V2 raw</th>
                  <th className="py-2 pr-3 font-medium">V2 bias</th>
                  <th className="py-2 pr-3 font-medium">V2 confidence</th>
                  <th className="py-2 pr-3 font-medium">Compared at</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ symbol, comparison, v2 }) => (
                  <tr key={symbol} className="border-b border-(--border) last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      <Link href={`/markets/${symbol}`} className="hover:text-(--accent)">
                        {symbol}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{comparison ? comparison.v1Score.toFixed(2) : "—"}</td>
                    <td className="py-2 pr-3">{comparison ? <BiasBadge bias={comparison.v1Bias as Bias} size="sm" /> : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{v2 ? v2.totalScore.toFixed(2) : comparison ? comparison.v2Score.toFixed(2) : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums text-(--text-faint)">{v2 ? v2.rawScore.toFixed(2) : "—"}</td>
                    <td className="py-2 pr-3">
                      {v2 ? <BiasBadge bias={v2.bias} size="sm" /> : comparison ? <BiasBadge bias={comparison.v2Bias as Bias} size="sm" /> : "—"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{v2 ? `${v2.confidence.toFixed(0)}%` : comparison ? `${comparison.v2Confidence.toFixed(0)}%` : "—"}</td>
                    <td className="py-2 pr-3 text-xs text-(--text-faint)">
                      {comparison ? formatRelative(comparison.computedAt) : v2 ? formatRelative(v2.lastUpdated) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Why did the score change? (per market)"
        subtitle="Generated from the two most recent real V2 computation cycles — never LLM-invented"
      >
        {attributions.every((a) => a === null || a.items.length === 0) ? (
          <p className="text-sm text-(--text-faint)">Not enough V2 history yet — needs at least two computation cycles per market.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(({ symbol }, i) => {
              const attribution = attributions[i];
              if (!attribution || attribution.items.length === 0) return null;
              return (
                <details key={symbol} className="border-b border-(--border) last:border-0 pb-2 last:pb-0">
                  <summary className="cursor-pointer text-sm font-medium flex items-center justify-between py-1.5 gap-3">
                    <span>{symbol}</span>
                    <span className={`tabular-nums ${attribution.netChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {attribution.fromTotal.toFixed(1)} → {attribution.toTotal.toFixed(1)} ({attribution.netChange >= 0 ? "+" : ""}
                      {attribution.netChange.toFixed(1)})
                    </span>
                  </summary>
                  <ul className="mt-1.5 space-y-1 pl-1">
                    {attribution.items.map((item) => (
                      <li key={item.key} className="flex items-center justify-between text-xs text-(--text-dim) gap-3">
                        <span>
                          {item.label} — {item.explanation}
                        </span>
                        <span className={`tabular-nums shrink-0 ${item.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {item.delta >= 0 ? "+" : ""}
                          {item.delta.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="Integrity errors (recent)"
        subtitle="A rejected V2 computation always keeps the previous canonical score — this table is purely diagnostic"
      >
        {integrityErrors.length === 0 ? (
          <p className="text-sm text-(--text-faint)">No integrity failures recorded.</p>
        ) : (
          <ul className="space-y-2">
            {integrityErrors.map((e, i) => (
              <li key={i} className="text-sm border-b border-(--border) last:border-0 pb-2 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.symbol}</span>
                  <span className="text-xs text-(--text-faint)">{formatDateTime(e.computedAt)}</span>
                </div>
                <ul className="mt-1 text-xs text-rose-400 list-disc list-inside">
                  {e.errors.map((err, j) => (
                    <li key={j}>{err}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
