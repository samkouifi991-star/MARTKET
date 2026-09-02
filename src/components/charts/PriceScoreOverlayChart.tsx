"use client";

// Pre-launch value pass: "Price & Intelligence History" — a single
// synchronized chart overlaying price (left axis) and the -10..+10 Market
// Intelligence score (right axis) on the same date domain, so a user can
// visually compare "what the score was doing" against "what the market
// eventually did" without us ever claiming causation. Reuses exactly the
// same two datasets Market Detail already fetches for its existing,
// separate Price chart and Score History chart (recentPriceSeries,
// score.history) — no new query. See lib/pipeline/price-score-overlay.ts
// for the (unit-tested) join/honesty logic this component only renders.
import { PricePoint, ScoreHistoryPoint } from "@/lib/types";
import { formatDate } from "@/lib/time";
import { buildPriceScoreOverlay } from "@/lib/pipeline/price-score-overlay";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BiasThreshold, DEFAULT_BIAS_THRESHOLDS, classifyBias } from "@/lib/config";

type TooltipPoint = { label: string; price: number | null; score: number | null };
type OverlayTooltipPayload = { active?: boolean; payload?: { payload: TooltipPoint }[] };

function OverlayTooltip({ active, payload, decimals, thresholds }: OverlayTooltipPayload & { decimals: number; thresholds: BiasThreshold[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
      <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>{point.label}</div>
      <div>Price: <strong>{point.price !== null ? point.price.toFixed(decimals) : "—"}</strong></div>
      <div>Score: <strong>{point.score !== null ? point.score.toFixed(2) : "—"}</strong></div>
      {point.score !== null && (
        <div>Bias: <strong>{classifyBias(point.score, thresholds)}</strong></div>
      )}
    </div>
  );
}

export function PriceScoreOverlayChart({
  priceSeries,
  scoreHistory,
  decimals,
  thresholds = DEFAULT_BIAS_THRESHOLDS,
  height = 320,
}: {
  priceSeries: PricePoint[];
  scoreHistory: ScoreHistoryPoint[];
  decimals: number;
  thresholds?: BiasThreshold[];
  height?: number;
}) {
  const overlay = buildPriceScoreOverlay(priceSeries, scoreHistory);

  if (overlay.status === "building") {
    return (
      <div style={{ height }} className="flex items-center justify-center text-center px-4">
        <p className="text-xs text-(--text-faint)">
          {overlay.deduped.length === 0
            ? "Score tracking has not started yet — this overlay will appear once it has."
            : `Score tracking began ${formatDate(overlay.deduped[0].date)} — not enough history yet for a meaningful overlay.`}
        </p>
      </div>
    );
  }

  const data = overlay.points.map((p) => ({ ...p, label: formatDate(`${p.day}T00:00:00.000Z`) }));
  const prices = overlay.points.map((p) => p.price).filter((p): p is number => p !== null);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 1;
  const pad = (max - min) * 0.08 || 1;

  return (
    <div>
      <div className="flex items-center gap-4 text-[11px] text-(--text-faint) mb-1.5">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />
          Price (left axis)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-400" />
          Intelligence score (right axis, -10 to +10)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-faint)" }} minTickGap={40} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
          <YAxis
            yAxisId="price"
            domain={[min - pad, max + pad]}
            tick={{ fontSize: 11, fill: "var(--text-faint)" }}
            width={70}
            tickFormatter={(v: number) => v.toFixed(decimals)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis yAxisId="score" orientation="right" domain={[-10, 10]} tick={{ fontSize: 11, fill: "var(--text-faint)" }} width={30} axisLine={false} tickLine={false} />
          <Tooltip content={<OverlayTooltip decimals={decimals} thresholds={thresholds} />} />
          <Line yAxisId="price" type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={false} />
          <Line yAxisId="score" type="monotone" dataKey="score" stroke="#a78bfa" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      {overlay.trimmedToScoreWindow && (
        <p className="text-[11px] text-(--text-faint) mt-2">
          Score tracking began {formatDate(overlay.earliestScoreDate)} — chart starts there, not the full price history.
        </p>
      )}
    </div>
  );
}
