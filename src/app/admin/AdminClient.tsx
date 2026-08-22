"use client";

import { useActionState, useState } from "react";
import { saveScoringConfiguration, recomputeAllScores, type AdminActionState } from "@/lib/actions/admin";
import type { ResolvedScoringConfig } from "@/lib/pipeline/scoring-config";
import { FACTOR_LABELS, ScoreFactorKey } from "@/lib/types";
import { BiasThreshold } from "@/lib/config";
import { Card } from "@/components/ui/Card";
import { AuditLogEntry } from "@/lib/demo/admin";
import { formatDateTime, formatRelative } from "@/lib/time";
import { RotateCw } from "lucide-react";

const WEIGHT_SUM_EPSILON = 0.005;

function weightSum(weights: Record<ScoreFactorKey, number>): number {
  return Object.values(weights).reduce((s, v) => s + v, 0);
}

function weightsSumValid(weights: Record<ScoreFactorKey, number>): boolean {
  return Math.abs(weightSum(weights) - 1) <= WEIGHT_SUM_EPSILON;
}

function thresholdsOrderedValid(thresholds: BiasThreshold[]): boolean {
  for (let i = 0; i < thresholds.length - 2; i++) {
    if (thresholds[i].min <= thresholds[i + 1].min) return false;
  }
  return true;
}

export function AdminClient({ initialAuditLog, activeScoringConfig }: { initialAuditLog: AuditLogEntry[]; activeScoringConfig: ResolvedScoringConfig }) {
  const [weights, setWeights] = useState<Record<ScoreFactorKey, number>>(activeScoringConfig.weights);
  const [thresholds, setThresholds] = useState(activeScoringConfig.biasThresholds.map((t) => ({ ...t })));
  // Snapshot of the last saved values — compared against current state to
  // detect unsaved changes, and refreshed on a successful save so further
  // edits are measured against the newly-active configuration.
  const [baseline, setBaseline] = useState({ weights: activeScoringConfig.weights, thresholds: activeScoringConfig.biasThresholds });
  const [activeVersion, setActiveVersion] = useState<{ id: number | null; updatedAt: string | null }>({
    id: activeScoringConfig.id,
    updatedAt: activeScoringConfig.updatedAt ?? null,
  });
  const [auditLog, setAuditLog] = useState(initialAuditLog);
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(saveScoringConfiguration, undefined);
  const [recomputeState, recomputeAction, recomputing] = useActionState<AdminActionState, FormData>(recomputeAllScores, undefined);
  // Tracks which action-state result has already been applied to
  // baseline/activeVersion/auditLog, so a fresh successful save is handled
  // exactly once — the render-time "adjust state on change" pattern
  // (see react.dev/learn/you-might-not-need-an-effect), not an effect,
  // since this only ever reacts to the action's own result, never an
  // external system.
  const [handledState, setHandledState] = useState(state);

  const currentWeightSum = weightSum(weights);

  if (state !== handledState) {
    setHandledState(state);
    // Only record the version as active — and log it — once the server
    // confirms the save actually happened; an optimistic pre-submit log
    // would misreport success if validation or persistence failed server-side.
    if (state?.success && state.versionId !== undefined) {
      setBaseline({ weights, thresholds });
      setActiveVersion({ id: state.versionId, updatedAt: state.updatedAt ?? new Date().toISOString() });
      setAuditLog((prev) => [
        {
          id: `audit-${Date.now()}`,
          actor: "admin",
          action: "Saved scoring configuration",
          detail: `v${state.versionId} · weights sum to ${(currentWeightSum * 100).toFixed(0)}% · thresholds: ${thresholds
            .map((t) => `${t.bias} ≥ ${t.min === -Infinity ? "-∞" : t.min}`)
            .join(", ")}`,
          at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  }

  const weightsValid = weightsSumValid(weights);
  const thresholdsValid = thresholdsOrderedValid(thresholds);
  const isValid = weightsValid && thresholdsValid;
  const isDirty = JSON.stringify(weights) !== JSON.stringify(baseline.weights) || JSON.stringify(thresholds) !== JSON.stringify(baseline.thresholds);

  function updateWeight(key: ScoreFactorKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <form action={formAction}>
        <Card
          title="Scoring configuration"
          subtitle={
            activeVersion.id
              ? `Active version: v${activeVersion.id} · Last updated: ${activeVersion.updatedAt ? formatDateTime(activeVersion.updatedAt) : "—"}`
              : "Bootstrap defaults — no saved configuration yet"
          }
          action={
            <div className="flex items-center gap-3">
              {isDirty && <span className="text-xs text-amber-400 font-medium">Unsaved changes</span>}
              <button
                type="submit"
                disabled={pending || !isValid}
                className="text-sm rounded-lg bg-(--accent) text-white px-4 py-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending ? "Saving…" : "Save & Version"}
              </button>
            </div>
          }
        >
          <p className="text-xs text-(--text-faint)">
            One versioned configuration — factor weights and bias thresholds are always saved and activated together.
          </p>
          {!weightsValid && (
            <p className="text-xs text-amber-400 mt-2">Weights currently sum to {(currentWeightSum * 100).toFixed(0)}% — adjust to exactly 100% before saving.</p>
          )}
          {!thresholdsValid && (
            <p className="text-xs text-amber-400 mt-1">Bias thresholds must strictly decrease from Very Bullish down to Very Bearish before saving.</p>
          )}
          {state?.error && <p className="text-xs text-rose-400 mt-2">{state.error}</p>}
          {state?.success && <p className="text-xs text-emerald-400 mt-2">{state.success}</p>}
        </Card>

        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <Card title="Scoring weights" subtitle={`Current total: ${(currentWeightSum * 100).toFixed(0)}% (should sum to 100%)`}>
            <div className="space-y-3">
              {(Object.keys(weights) as ScoreFactorKey[]).map((key) => (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-(--text-dim)">{FACTOR_LABELS[key]}</span>
                    <span className="tabular-nums font-medium">{(weights[key] * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.01}
                    value={weights[key]}
                    onChange={(e) => updateWeight(key, Number(e.target.value))}
                    className="w-full accent-(--accent)"
                  />
                  <input type="hidden" name={`weight:${key}`} value={weights[key]} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Bias thresholds" subtitle="Minimum total score required for each bias label">
            <div className="space-y-2.5">
              {thresholds.map((t, i) => (
                <div key={t.bias} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-(--text-dim) w-28 shrink-0">{t.bias}</span>
                  <input
                    type="number"
                    step={0.1}
                    value={t.min === -Infinity ? -10 : t.min}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setThresholds((prev) => prev.map((p, idx) => (idx === i ? { ...p, min: value } : p)));
                    }}
                    disabled={t.min === -Infinity}
                    className="h-8 flex-1 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none disabled:opacity-40"
                  />
                  {t.min !== -Infinity && <input type="hidden" name={`threshold:${i}`} value={t.min} />}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-(--text-faint) mt-2">Saved together with scoring weights as one versioned configuration.</p>
          </Card>
        </div>
      </form>

      <Card
        title="Recalculation"
        action={
          <form action={recomputeAction}>
            <button
              type="submit"
              disabled={recomputing}
              className="flex items-center gap-1.5 text-xs rounded-lg border border-(--border) px-3 py-1.5 font-medium hover:border-(--border-strong) disabled:opacity-60"
            >
              <RotateCw size={13} className={recomputing ? "animate-spin" : ""} /> {recomputing ? "Recalculating…" : "Re-run all calculations"}
            </button>
          </form>
        }
      >
        <p className="text-sm text-(--text-faint)">
          Forces every strict-live market to recompute from the latest stored factor data, using the currently active scoring
          configuration — no weight/threshold change, and no live provider calls. Use after a data-source outage is resolved.
        </p>
        {recomputeState?.success && <p className="text-xs text-emerald-400 mt-2">{recomputeState.success}</p>}
        {recomputeState?.error && <p className="text-xs text-rose-400 mt-2">{recomputeState.error}</p>}
      </Card>

      <Card title="Audit log" subtitle="Every scoring-weight and threshold change is versioned">
        <ul className="space-y-2.5">
          {auditLog.map((a) => (
            <li key={a.id} className="text-sm border-b border-(--border) last:border-0 pb-2.5 last:pb-0">
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.action}</span>
                <span className="text-xs text-(--text-faint)">{formatRelative(a.at)}</span>
              </div>
              <p className="text-xs text-(--text-dim) mt-0.5">{a.detail}</p>
              <p className="text-[10px] text-(--text-faint) mt-0.5">{a.actor}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
