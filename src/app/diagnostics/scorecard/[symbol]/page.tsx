// Read-only verification view for the grouped market scorecard
// (components/market/Scorecard.tsx) — renders the EXACT same component,
// fed by the EXACT same data-fetching functions
// (getCurrentScore/getLiveMarketDetail/buildScorecardData) as the real
// customer-facing /markets/[symbol] page, so what's shown here is
// guaranteed to match what a real logged-in user sees. The only thing
// this page does differently from the real page is the auth gate: instead
// of a customer session (requireEntitlement), it's gated by a shared
// secret in the URL, matching the same bearer-secret pattern already used
// by /api/cron/* and /api/watch/economic-releases (see api/cron/_shared.ts) —
// so this can be checked from an external tool (e.g. a scripted browser in
// CI) without ever needing a paying customer's login session or touching
// Stripe. Never linked from anywhere in the product UI. No writes of any
// kind happen on this page.
import { notFound } from "next/navigation";
import { getInstrument } from "@/lib/instruments";
import { computeLiveMarketScore } from "@/lib/pipeline/scoring-engine";
import { resolveActiveScoringConfig } from "@/lib/pipeline/scoring-config";
import { getAllCurrentScores, getCurrentScore } from "@/db/queries/scores";
import { getLiveMarketDetail } from "@/lib/pipeline/market-detail";
import { buildScorecardData } from "@/lib/pipeline/scorecard";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";
import { Scorecard } from "@/components/market/Scorecard";
import { MarketScore } from "@/lib/types";

export const dynamic = "force-dynamic";

function authorized(providedKey: string | undefined): boolean {
  const secret = process.env.EVENT_WATCH_SECRET || process.env.CRON_SECRET;
  return Boolean(secret && providedKey && providedKey === secret);
}

export default async function ScorecardDiagnosticPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { symbol } = await params;
  const { key } = await searchParams;
  if (!authorized(key)) notFound();

  const instrument = getInstrument(symbol);
  if (!instrument) notFound();

  if (isDemoOnly()) {
    return <div className="p-6 text-sm text-(--text-faint)">DATA_MODE is demo — no live providers to verify.</div>;
  }

  // Identical read as the real page: the canonical current_market_score
  // row (db/queries/scores.ts's getCurrentScore), falling back to a fresh
  // live compute only if none exists yet.
  const score: MarketScore = (await getCurrentScore(instrument.symbol).catch(() => null)) ?? (await computeLiveMarketScore(instrument.symbol, DATA_MODE, { updateCurrent: true }));

  // Cross-check against Dashboard's own read (getAllCurrentScores, a bulk
  // read of the SAME table) — proves this page, Dashboard, and Top Setups
  // (which reads getCurrentScore directly, same as above) are all reading
  // one canonical record, never three independently-computed numbers.
  const allScores = await getAllCurrentScores();
  const dashboardScore = allScores.get(instrument.symbol) ?? null;
  const canonicalMatch = dashboardScore !== null && dashboardScore.totalScore === score.totalScore && dashboardScore.bias === score.bias && dashboardScore.lastUpdated === score.lastUpdated;

  const live = await getLiveMarketDetail(instrument.symbol, DATA_MODE);
  const scorecardData = await buildScorecardData(instrument, score, live);
  const scoringConfig = await resolveActiveScoringConfig();

  const contributionSum = Number(score.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  const sumMatchesTotal = contributionSum === score.totalScore;

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <div className="border border-amber-500/40 bg-amber-500/10 rounded-lg p-4 text-xs space-y-1">
        <p className="font-semibold text-amber-300">Diagnostic view — not part of the customer product, never linked from the app.</p>
        <p>
          Canonical score cross-check (this page&apos;s getCurrentScore vs. Dashboard&apos;s getAllCurrentScores): totalScore {score.totalScore} vs {dashboardScore?.totalScore ?? "n/a"},
          bias {score.bias} vs {dashboardScore?.bias ?? "n/a"}, lastUpdated {score.lastUpdated} vs {dashboardScore?.lastUpdated ?? "n/a"} —{" "}
          <span className={canonicalMatch ? "text-emerald-400" : "text-rose-400"}>{canonicalMatch ? "MATCH" : "MISMATCH"}</span>
        </p>
        <p>
          Sum-of-contributions check: {score.factors.map((f) => f.contribution).join(" + ")} = {contributionSum}, score.totalScore = {score.totalScore} —{" "}
          <span className={sumMatchesTotal ? "text-emerald-400" : "text-rose-400"}>{sumMatchesTotal ? "MATCH" : "MISMATCH"}</span>
        </p>
      </div>

      <Scorecard instrument={instrument} score={score} data={scorecardData} biasThresholds={scoringConfig.biasThresholds} price={live.price.data} priceFreshness={live.price.freshness} />

      <details className="text-xs">
        <summary className="cursor-pointer text-(--text-faint)">Raw JSON (score + scorecardData)</summary>
        <pre className="mt-2 p-3 rounded-lg bg-black/40 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify({ score, scorecardData }, null, 2)}</pre>
      </details>
    </div>
  );
}
