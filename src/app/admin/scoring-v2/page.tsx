import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { StatTile } from "@/components/ui/StatTile";
import { formatDateTime, formatRelative } from "@/lib/time";
import { DATA_MODE, isDemoOnly, strictLiveSymbolList } from "@/services/data-mode";
import { getAllCurrentScoresV2, getLatestShadowComparisons, getRecentIntegrityErrors, getScoreV2AsOf } from "@/db/queries/scoring-v2";
import { computeScoreChangeAttribution } from "@/lib/scoring-v2/attribution";
import { getEventShocksForRelease, getRecentDiagnosticCounts, getSurpriseById } from "@/db/queries/economic-releases";
import { getLatencySamples, getRecentReleaseTracking } from "@/db/queries/release-tracking";
import { computeLatencyStats } from "@/lib/scoring-v2/latency-stats";
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

// Bounds how many processed releases get the (per-affected-market) full
// drill-down — the summary table above still shows every recent release;
// this just caps the more expensive fan-out queries to a reasonable number
// for an admin diagnostic page.
const DRILLDOWN_LIMIT = 15;

async function ScoringV2Body() {
  const symbols = strictLiveSymbolList();
  const [comparisons, currentV2, integrityErrors, releases, diagnosticCounts, latencySamples] = await Promise.all([
    getLatestShadowComparisons(),
    getAllCurrentScoresV2(),
    getRecentIntegrityErrors(20),
    getRecentReleaseTracking(50),
    getRecentDiagnosticCounts(),
    getLatencySamples(),
  ]);

  const rows = symbols
    .map((symbol) => ({ symbol, comparison: comparisons.get(symbol) ?? null, v2: currentV2.get(symbol) ?? null }))
    .filter((r) => r.comparison || r.v2);

  const attributions = await Promise.all(rows.map((r) => computeScoreChangeAttribution(r.symbol)));

  const compared = rows.filter((r) => r.comparison).length;
  const agreeingBias = rows.filter((r) => r.comparison && r.comparison.v1Bias === r.comparison.v2Bias).length;

  const latencyStats = computeLatencyStats(latencySamples);

  const processedReleases = releases.filter((r) => r.surpriseId !== null);
  const surpriseRows = await Promise.all(processedReleases.map((r) => getSurpriseById(r.surpriseId!)));
  const surprisesById = new Map(processedReleases.map((r, i) => [r.surpriseId!, surpriseRows[i]]));

  const drilldownReleases = processedReleases.slice(0, DRILLDOWN_LIMIT);
  const drilldowns = await Promise.all(
    drilldownReleases.map(async (release) => {
      const shocks = await getEventShocksForRelease(release.surpriseId!);
      const marketMoves = await Promise.all(
        release.affectedMarkets.map(async (symbol) => ({
          symbol,
          before: release.processedAt ? await getScoreV2AsOf(symbol, release.processedAt) : null,
          after: currentV2.get(symbol) ?? null,
        }))
      );
      return { release, shocks, marketMoves };
    })
  );

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

      <Card title="Recent economic releases" subtitle="Every release the watcher has seen, most recently scheduled first">
        {releases.length === 0 ? (
          <p className="text-sm text-(--text-faint)">
            No releases detected yet — the 5-minute watch route or the daily cron populates this once at least one runs.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-(--text-faint) border-b border-(--border)">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Country</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Actual</th>
                  <th className="py-2 pr-3 font-medium">Forecast</th>
                  <th className="py-2 pr-3 font-medium">Previous</th>
                  <th className="py-2 pr-3 font-medium">Surprise Z</th>
                  <th className="py-2 pr-3 font-medium">Impact</th>
                  <th className="py-2 pr-3 font-medium">Affected markets</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => {
                  const surprise = r.surpriseId ? surprisesById.get(r.surpriseId) : null;
                  return (
                    <tr key={r.releaseKey} className="border-b border-(--border) last:border-0 align-top">
                      <td className="py-2 pr-3 text-xs text-(--text-faint) whitespace-nowrap">{formatDateTime(r.scheduledAt)}</td>
                      <td className="py-2 pr-3">{r.country}</td>
                      <td className="py-2 pr-3">
                        {r.rawEvent}
                        <span className="block text-[10px] text-(--text-faint)">
                          {r.indicatorKey} · {r.state}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{r.actual ?? "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.forecast ?? "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.previous ?? "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{surprise?.surpriseZ !== null && surprise?.surpriseZ !== undefined ? surprise.surpriseZ.toFixed(2) : "—"}</td>
                      <td className="py-2 pr-3">{r.importanceTier}</td>
                      <td className="py-2 pr-3 text-xs">{r.affectedMarkets.length > 0 ? r.affectedMarkets.join(", ") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Release drill-down"
        subtitle={`Normalized type, revision, surprise calculation, event shocks, and V2 score before/after per affected market (most recent ${DRILLDOWN_LIMIT} processed releases)`}
      >
        {drilldowns.length === 0 ? (
          <p className="text-sm text-(--text-faint)">No processed releases yet to drill into.</p>
        ) : (
          <div className="space-y-2">
            {drilldowns.map(({ release, shocks, marketMoves }) => {
              const surprise = release.surpriseId ? surprisesById.get(release.surpriseId) : null;
              return (
                <details key={release.releaseKey} className="border-b border-(--border) last:border-0 pb-2 last:pb-0">
                  <summary className="cursor-pointer text-sm font-medium flex items-center justify-between py-1.5 gap-3">
                    <span>
                      {release.rawEvent} ({release.country})
                    </span>
                    <span className="text-xs text-(--text-faint)">{formatRelative(release.scheduledAt)}</span>
                  </summary>
                  <div className="mt-1.5 space-y-1.5 text-xs text-(--text-dim) pl-1">
                    <div>
                      Normalized: <span className="text-(--text)">{release.indicatorKey}</span> · Raw provider name: &quot;{release.rawEvent}&quot; · Provider: {release.provider}
                    </div>
                    {surprise && (
                      <div>
                        Actual {surprise.actual} vs forecast {surprise.forecast ?? "—"} → surprise {surprise.surprise?.toFixed(3) ?? "—"}, effective{" "}
                        {surprise.effectiveSurprise?.toFixed(3) ?? "—"}, Z {surprise.surpriseZ?.toFixed(2) ?? "—"}
                        {surprise.revisedPrevious !== null && <> · revised prior: {surprise.revisedPrevious}</>}
                      </div>
                    )}
                    <div>
                      Event shocks created:{" "}
                      {shocks.length === 0
                        ? "none"
                        : shocks.map((s) => `${s.symbol} (${s.factorKey ?? "total"}: ${s.initialContribution >= 0 ? "+" : ""}${s.initialContribution.toFixed(2)})`).join(", ")}
                    </div>
                    {marketMoves.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-(--text-faint)">V2 score before → after:</span>
                        {marketMoves.map((m) => (
                          <div key={m.symbol} className="flex items-center justify-between">
                            <span>{m.symbol}</span>
                            <span className="tabular-nums">
                              {m.before ? m.before.totalScore.toFixed(2) : "—"} → {m.after ? m.after.totalScore.toFixed(2) : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="Provider latency & diagnostics"
        subtitle="Scheduled release time vs first detection, plus data-quality gaps — tells us whether a better calendar provider is worth paying for"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-(--text-dim) mb-1.5">Detection latency by indicator</div>
            {latencyStats.length === 0 ? (
              <p className="text-xs text-(--text-faint)">Not enough real samples yet.</p>
            ) : (
              <ul className="space-y-1">
                {latencyStats.map((s) => (
                  <li key={s.indicatorKey} className="flex items-center justify-between text-xs">
                    <span className="text-(--text-dim)">
                      {s.indicatorKey} (n={s.sampleSize})
                    </span>
                    <span className="tabular-nums">
                      median {(s.medianMs / 60_000).toFixed(1)}m · P95 {(s.p95Ms / 60_000).toFixed(1)}m
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-(--text-dim) mb-1.5">Provider-quality diagnostics (30d)</div>
            <ul className="space-y-1 text-xs">
              <li className="flex items-center justify-between">
                <span className="text-(--text-dim)">Missing forecast</span>
                <span className="tabular-nums">{diagnosticCounts.missing_forecast}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-(--text-dim)">Missing actual (overdue)</span>
                <span className="tabular-nums">{diagnosticCounts.missing_actual}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-(--text-dim)">Duplicate event</span>
                <span className="tabular-nums">{diagnosticCounts.duplicate_event}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-(--text-dim)">Normalization failure</span>
                <span className="tabular-nums">{diagnosticCounts.normalization_failure}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-(--text-dim)">Missing revision</span>
                <span className="tabular-nums">{diagnosticCounts.missing_revision}</span>
              </li>
            </ul>
          </div>
        </div>
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
