"use client";

import { useState } from "react";
import { DEFAULT_BIAS_THRESHOLDS, DEFAULT_FACTOR_WEIGHTS } from "@/lib/config";
import { FACTOR_LABELS, ScoreFactorKey } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { AuditLogEntry } from "@/lib/demo/admin";
import { formatRelative } from "@/lib/time";
import { RotateCw } from "lucide-react";

export function AdminClient({ initialAuditLog }: { initialAuditLog: AuditLogEntry[] }) {
  const [weights, setWeights] = useState<Record<ScoreFactorKey, number>>(DEFAULT_FACTOR_WEIGHTS);
  const [thresholds, setThresholds] = useState(DEFAULT_BIAS_THRESHOLDS.map((t) => ({ ...t })));
  const [auditLog, setAuditLog] = useState(initialAuditLog);
  const [recalculating, setRecalculating] = useState(false);

  const weightSum = Object.values(weights).reduce((s, v) => s + v, 0);

  function updateWeight(key: ScoreFactorKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  function saveWeights() {
    setAuditLog((prev) => [
      { id: `audit-${Date.now()}`, actor: "you@this-session", action: "Updated factor weights", detail: `New weight set saved (sums to ${(weightSum * 100).toFixed(0)}%)`, at: new Date().toISOString() },
      ...prev,
    ]);
  }

  function saveThresholds() {
    setAuditLog((prev) => [
      { id: `audit-${Date.now()}`, actor: "you@this-session", action: "Updated bias thresholds", detail: thresholds.map((t) => `${t.bias} ≥ ${t.min === -Infinity ? "-∞" : t.min}`).join(", "), at: new Date().toISOString() },
      ...prev,
    ]);
  }

  function rerunCalculations() {
    setRecalculating(true);
    setTimeout(() => {
      setRecalculating(false);
      setAuditLog((prev) => [
        { id: `audit-${Date.now()}`, actor: "you@this-session", action: "Re-ran calculations", detail: "Manual full recalculation triggered from Admin", at: new Date().toISOString() },
        ...prev,
      ]);
    }, 900);
  }

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Scoring weights"
          subtitle={`Current total: ${(weightSum * 100).toFixed(0)}% (should sum to 100%)`}
          action={
            <button onClick={saveWeights} className="text-xs rounded-lg bg-(--accent) text-white px-3 py-1.5 font-medium">
              Save &amp; version
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
              </div>
            ))}
          </div>
          {Math.abs(weightSum - 1) > 0.01 && (
            <p className="text-[11px] text-amber-400 mt-2">Weights currently sum to {(weightSum * 100).toFixed(0)}% — adjust before publishing to production.</p>
          )}
        </Card>

        <Card
          title="Bias thresholds"
          subtitle="Minimum total score required for each bias label"
          action={
            <button onClick={saveThresholds} className="text-xs rounded-lg bg-(--accent) text-white px-3 py-1.5 font-medium">
              Save &amp; version
            </button>
          }
        >
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
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Recalculation" action={
        <button onClick={rerunCalculations} disabled={recalculating} className="flex items-center gap-1.5 text-xs rounded-lg border border-(--border) px-3 py-1.5 font-medium hover:border-(--border-strong) disabled:opacity-60">
          <RotateCw size={13} className={recalculating ? "animate-spin" : ""} /> {recalculating ? "Recalculating…" : "Re-run all calculations"}
        </button>
      }>
        <p className="text-sm text-(--text-faint)">Forces every market score to recompute from the latest available factor data. Use after a weight or threshold change, or after a data-source outage is resolved.</p>
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
