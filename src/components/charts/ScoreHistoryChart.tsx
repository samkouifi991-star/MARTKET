"use client";

import { ScoreHistoryPoint } from "@/lib/types";
import { BiasThreshold, DEFAULT_BIAS_THRESHOLDS, classifyBias } from "@/lib/config";
import { formatDate, filterToRecentWindow } from "@/lib/time";
import { dedupeScoreHistoryByDate, MIN_LEGITIMATE_OBSERVATIONS } from "@/lib/pipeline/score-history-view";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function thresholdMin(thresholds: BiasThreshold[], bias: string): number | undefined {
  return thresholds.find((t) => t.bias === bias)?.min;
}

type ScoreTooltipPayload = { active?: boolean; payload?: { payload: { label: string; score: number } }[] };

function ScoreTooltipContent({ active, payload, thresholds }: ScoreTooltipPayload & { thresholds: BiasThreshold[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
      <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>{point.label}</div>
      <div>
        Score: <strong>{point.score.toFixed(2)}</strong>
      </div>
      <div>
        Bias: <strong>{classifyBias(point.score, thresholds)}</strong>
      </div>
    </div>
  );
}

/** thresholds defaults to DEFAULT_BIAS_THRESHOLDS but every real caller
 * (Market Detail, the landing page) should pass the currently active Admin
 * scoring configuration's biasThresholds — see pipeline/scoring-config.ts's
 * resolveActiveScoringConfig — so these reference lines (and the tooltip's
 * Bias label) always reflect what Admin actually has configured, never a
 * hardcoded ±4/±8. Changing thresholds in Admin only changes how this
 * chart's existing, unchanged historical scores are labeled/framed — it
 * never rewrites the stored history itself.
 *
 * `autoWindow` (default false, preserving every existing caller's current
 * behavior unchanged) opts into this component owning the "is there enough
 * real history to show a 5-month chart" decision: pass the FULL, un-
 * windowed history in this mode. Below MIN_LEGITIMATE_OBSERVATIONS deduped
 * points, it renders an honest "still building" note instead of stretching
 * a handful of real points across a misleadingly wide axis; once enough
 * real history has accumulated, it auto-switches to the normal 5-month
 * window. The landing page keeps doing its own separate real-vs-
 * illustrative-example selection upstream (see app/page.tsx) and passes
 * `autoWindow={false}` (the default) to keep that logic in charge there. */
export function ScoreHistoryChart({
  history,
  thresholds = DEFAULT_BIAS_THRESHOLDS,
  height = 220,
  autoWindow = false,
}: {
  history: ScoreHistoryPoint[];
  thresholds?: BiasThreshold[];
  height?: number;
  autoWindow?: boolean;
}) {
  const deduped = dedupeScoreHistoryByDate(history);

  if (autoWindow && deduped.length < MIN_LEGITIMATE_OBSERVATIONS) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-center px-4">
        <p className="text-xs text-(--text-faint)">
          {deduped.length === 0 ? "Score history is building — tracking has not started yet." : `Score history is building — tracking began ${formatDate(deduped[0].date)}.`}
        </p>
      </div>
    );
  }

  const windowed = autoWindow ? filterToRecentWindow(deduped) : deduped;
  const data = windowed.map((p) => ({ ...p, label: formatDate(p.date) }));

  const veryBullish = thresholdMin(thresholds, "Very Bullish");
  const bullish = thresholdMin(thresholds, "Bullish");
  const bearish = thresholdMin(thresholds, "Bearish");
  const veryBearish = thresholdMin(thresholds, "Very Bearish");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-faint)" }} minTickGap={40} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis domain={[-10, 10]} tick={{ fontSize: 11, fill: "var(--text-faint)" }} width={30} axisLine={false} tickLine={false} />
        {veryBullish !== undefined && <ReferenceLine y={veryBullish} stroke="#22c58b55" strokeDasharray="4 4" />}
        {bullish !== undefined && <ReferenceLine y={bullish} stroke="#22c58b33" strokeDasharray="4 4" />}
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        {bearish !== undefined && <ReferenceLine y={bearish} stroke="#f2506b33" strokeDasharray="4 4" />}
        {veryBearish !== undefined && <ReferenceLine y={veryBearish} stroke="#f2506b55" strokeDasharray="4 4" />}
        <Tooltip content={<ScoreTooltipContent thresholds={thresholds} />} />
        <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
