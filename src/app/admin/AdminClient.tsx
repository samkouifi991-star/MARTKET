"use client";

import { useActionState, useState } from "react";
import { saveScoringConfiguration, recomputeAllScores, type AdminActionState } from "@/lib/actions/admin";
import type { ResolvedScoringConfig } from "@/lib/pipeline/scoring-config";
import { FACTOR_LABELS, ScoreFactorKey } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { AuditLogEntry } from "@/lib/demo/admin";
import { formatRelative } from "@/lib/time";
import { RotateCw } from "lucide-react";

export function AdminClient({ initialAuditLog, activeScoringConfig }: { initialAuditLog: AuditLogEntry[]; activeScoringConfig: ResolvedScoringConfig }) {
  const [weights, setWeights] = useState<Record<ScoreFactorKey, number>>(activeScoringConfig.weights);
  const [thresholds, setThresholds] = useState(activeScoringConfig.biasThresholds.map((t) => ({ ...t })));
  const [auditLog, setAuditLog] = useState(initialAuditLog);
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(saveScoringConfiguration, undefined);
  const [recomputeState, recomputeAction, recomputing] = useActionState<AdminActionState, FormData>(recomputeAllScores, undefined);

  const weightSum = Object.values(weights).reduce((s, v) => s + v, 0);

  function updateWeight(key: ScoreFactorKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(formData: FormData) {
    formAction(formData);
    setAuditLog((prev) => [
      {
        id: `audit-${Date.now()}`,
        actor: "admin",
        action: "Saved scoring configuration",
        detail: `Weights sum to ${(weightSum * 100).toFixed(0)}% · thresholds: ${thresholds.map((t) => `${t.bias} ≥ ${t.min === -Infinity ? "-∞" : t.min}`).join(", ")}`,
        at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  return (
    <div className="space-y-6">
      <form action={handleSubmit}>
        <div className="grid lg:grid-cols-2 gap-4">
          <Card
            title="Scoring weights"
            subtitle={
              activeScoringConfig.id
                ? `Active version v${activeScoringConfig.id} · current total: ${(weightSum * 100).toFixed(0)}% (should sum to 100%)`
                : `Bootstrap defaults — no saved configuration yet · current total: ${(weightSum * 100).toFixed(0)}% (should sum to 100%)`
            }
            action={
              <button type="submit" disabled={pending} className="text-xs rounded-lg bg-(--accent) text-white px-3 py-1.5 font-medium disabled:opacity-60">
                {pending ? "Saving…" : "Save & version"}
              </button>
            }
          >
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
            {Math.abs(weightSum - 1) > 0.005 && (
              <p className="text-[11px] text-amber-400 mt-2">Weights currently sum to {(weightSum * 100).toFixed(0)}% — adjust to exactly 100% before saving.</p>
            )}
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

        {state?.error && <p className="text-xs text-rose-400 mt-2">{state.error}</p>}
        {state?.success && <p className="text-xs text-emerald-400 mt-2">{state.success}</p>}
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
