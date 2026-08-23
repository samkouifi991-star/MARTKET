"use client";

import { useActionState, useState } from "react";
import { saveScoringConfiguration, recomputeAllScores, recomputeScoresV2Now, type AdminActionState } from "@/lib/actions/admin";
import type { ResolvedScoringConfig } from "@/lib/pipeline/scoring-config";
import { DEFAULT_SCORING_V2_SETTINGS, ImportanceTier, ScoringV2Settings } from "@/lib/scoring-v2/config";
import { FACTOR_LABELS, ScoreFactorKey } from "@/lib/types";
import { BiasThreshold } from "@/lib/config";
import { Card } from "@/components/ui/Card";
import { AuditLogEntry } from "@/lib/demo/admin";
import { formatDateTime, formatRelative } from "@/lib/time";
import { RotateCw } from "lucide-react";
import Link from "next/link";

// Slugs match lib/actions/admin.ts's parseV2Settings field names exactly.
const HYSTERESIS_ROWS: { bias: BiasThreshold["bias"]; slug: string }[] = [
  { bias: "Very Bullish", slug: "veryBullish" },
  { bias: "Bullish", slug: "bullish" },
  { bias: "Bearish", slug: "bearish" },
  { bias: "Very Bearish", slug: "veryBearish" },
];
const FAMILY_ROWS: { family: ScoringV2Settings["familyCaps"][number]["family"]; slug: string }[] = [
  { family: "Macro", slug: "macro" },
  { family: "Positioning", slug: "positioning" },
  { family: "Technical", slug: "technical" },
  { family: "Event", slug: "event" },
];

const WEIGHT_SUM_EPSILON = 0.005;

function weightSum(weights: Record<ScoreFactorKey, number>): number {
  return Object.values(weights).reduce((s, v) => s + v, 0);
}

function weightsSumValid(weights: Record<ScoreFactorKey, number>): boolean {
  return Math.abs(weightSum(weights) - 1) <= WEIGHT_SUM_EPSILON;
}

function thresholdsOrderedValid(thresholds: BiasThreshold[]): boolean {
  for (let i = 0; i < thresholds.length - 1; i++) {
    if (thresholds[i].min <= thresholds[i + 1].min) return false;
  }
  return true;
}

const BULLISH_BIASES: BiasThreshold["bias"][] = ["Very Bullish", "Bullish"];

// Mirrors lib/actions/admin.ts's parseV2Settings validation exactly, so the
// client can disable the (shared) Save & Version button before a round trip
// that would only come back with a v2-specific error.
function v2SettingsValid(v2: ScoringV2Settings): boolean {
  if (v2.minConfidenceForExtreme < 0 || v2.minConfidenceForExtreme > 100) return false;
  if (v2.smoothingAlpha < 0 || v2.smoothingAlpha > 1) return false;
  if (v2.smoothingAlphaHighImpact < 0 || v2.smoothingAlphaHighImpact > 1) return false;
  for (const h of v2.hysteresis) {
    const isBullishSide = BULLISH_BIASES.includes(h.bias);
    if (isBullishSide && h.exit > h.enter) return false;
    if (!isBullishSide && h.exit < h.enter) return false;
  }
  for (const f of v2.familyCaps) {
    if (f.maxContribution < 0) return false;
  }
  return true;
}

// A configuration saved before Very Bearish became editable stored it as
// -Infinity (the old catch-all-floor convention) — normalize that to a
// real number as soon as it enters component state so every threshold row
// is a plain editable number from here on, with nothing else needing to
// special-case -Infinity.
function normalizeThresholds(thresholds: BiasThreshold[]): BiasThreshold[] {
  return thresholds.map((t) => ({ ...t, min: t.min === -Infinity ? -10 : t.min }));
}

export function AdminClient({ initialAuditLog, activeScoringConfig }: { initialAuditLog: AuditLogEntry[]; activeScoringConfig: ResolvedScoringConfig }) {
  const [weights, setWeights] = useState<Record<ScoreFactorKey, number>>(activeScoringConfig.weights);
  const [thresholds, setThresholds] = useState(normalizeThresholds(activeScoringConfig.biasThresholds));
  // Scoring Engine V2 (shadow mode) settings — saved in the SAME row/form
  // submission as weights/thresholds above, per requirement #24's "one
  // Save & Version" for the complete model.
  const [v2Settings, setV2Settings] = useState<ScoringV2Settings>(activeScoringConfig.v2Settings ?? DEFAULT_SCORING_V2_SETTINGS);
  // Snapshot of the last saved values — compared against current state to
  // detect unsaved changes, and refreshed on a successful save so further
  // edits are measured against the newly-active configuration.
  const [baseline, setBaseline] = useState({
    weights: activeScoringConfig.weights,
    thresholds: normalizeThresholds(activeScoringConfig.biasThresholds),
    v2Settings: activeScoringConfig.v2Settings ?? DEFAULT_SCORING_V2_SETTINGS,
  });
  const [activeVersion, setActiveVersion] = useState<{ id: number | null; updatedAt: string | null }>({
    id: activeScoringConfig.id,
    updatedAt: activeScoringConfig.updatedAt ?? null,
  });
  const [auditLog, setAuditLog] = useState(initialAuditLog);
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(saveScoringConfiguration, undefined);
  const [recomputeState, recomputeAction, recomputing] = useActionState<AdminActionState, FormData>(recomputeAllScores, undefined);
  const [recomputeV2State, recomputeV2Action, recomputingV2] = useActionState<AdminActionState, FormData>(recomputeScoresV2Now, undefined);
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
      setBaseline({ weights, thresholds, v2Settings });
      setActiveVersion({ id: state.versionId, updatedAt: state.updatedAt ?? new Date().toISOString() });
      setAuditLog((prev) => [
        {
          id: `audit-${Date.now()}`,
          actor: "admin",
          action: "Saved scoring configuration",
          detail: `v${state.versionId} · weights sum to ${(currentWeightSum * 100).toFixed(0)}% · thresholds: ${thresholds
            .map((t) => `${t.bias} ≥ ${t.min}`)
            .join(", ")}`,
          at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  }

  const weightsValid = weightsSumValid(weights);
  const thresholdsValid = thresholdsOrderedValid(thresholds);
  const v2Valid = v2SettingsValid(v2Settings);
  const isValid = weightsValid && thresholdsValid && v2Valid;
  const isDirty =
    JSON.stringify(weights) !== JSON.stringify(baseline.weights) ||
    JSON.stringify(thresholds) !== JSON.stringify(baseline.thresholds) ||
    JSON.stringify(v2Settings) !== JSON.stringify(baseline.v2Settings);

  function updateWeight(key: ScoreFactorKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  function updateEventShockMax(value: number) {
    setV2Settings((prev) => ({ ...prev, eventShock: { ...prev.eventShock, maxContribution: value } }));
  }
  function updateDecayHalfLife(tier: ImportanceTier, value: number) {
    setV2Settings((prev) => ({
      ...prev,
      eventShock: { ...prev.eventShock, decayHalfLifeHoursByTier: { ...prev.eventShock.decayHalfLifeHoursByTier, [tier]: value } },
    }));
  }
  function updateMinConfidenceForExtreme(value: number) {
    setV2Settings((prev) => ({ ...prev, minConfidenceForExtreme: value }));
  }
  function updateSmoothingAlpha(field: "smoothingAlpha" | "smoothingAlphaHighImpact", value: number) {
    setV2Settings((prev) => ({ ...prev, [field]: value }));
  }
  function updateHysteresis(bias: BiasThreshold["bias"], field: "enter" | "exit", value: number) {
    setV2Settings((prev) => ({ ...prev, hysteresis: prev.hysteresis.map((h) => (h.bias === bias ? { ...h, [field]: value } : h)) }));
  }
  function updateFamilyCap(family: ScoringV2Settings["familyCaps"][number]["family"], value: number) {
    setV2Settings((prev) => ({ ...prev, familyCaps: prev.familyCaps.map((f) => (f.family === family ? { ...f, maxContribution: value } : f)) }));
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
                    value={t.min}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setThresholds((prev) => prev.map((p, idx) => (idx === i ? { ...p, min: value } : p)));
                    }}
                    className="h-8 flex-1 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                  />
                  <input type="hidden" name={`threshold:${i}`} value={t.min} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-(--text-faint) mt-2">Saved together with scoring weights as one versioned configuration.</p>
          </Card>
        </div>

        <Card
          title="Scoring Engine V2 settings (shadow mode)"
          subtitle="Event shocks, hysteresis, smoothing and family caps — saved in the same version as weights/thresholds above"
          className="mt-4"
        >
          <p className="text-xs text-(--text-faint) mb-3">
            V2 runs in the background against a separate set of tables and is not shown to regular users yet — see the{" "}
            <Link href="/admin/scoring-v2" className="text-(--accent) underline underline-offset-2">
              V1 vs V2 comparison page
            </Link>
            .
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-(--text-dim) mb-1.5">Event shock</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-(--text-dim)">Max contribution</span>
                  <input
                    type="number"
                    step={0.1}
                    value={v2Settings.eventShock.maxContribution}
                    onChange={(e) => updateEventShockMax(Number(e.target.value))}
                    className="h-8 w-24 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                  />
                  <input type="hidden" name="v2:eventShockMax" value={v2Settings.eventShock.maxContribution} />
                </div>
                {(["HIGH", "MEDIUM", "LOW"] as ImportanceTier[]).map((tier) => (
                  <div key={tier} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-(--text-dim)">{tier} decay half-life (hrs)</span>
                    <input
                      type="number"
                      step={1}
                      value={v2Settings.eventShock.decayHalfLifeHoursByTier[tier]}
                      onChange={(e) => updateDecayHalfLife(tier, Number(e.target.value))}
                      className="h-8 w-24 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                    />
                    <input
                      type="hidden"
                      name={`v2:decay${tier === "HIGH" ? "High" : tier === "MEDIUM" ? "Medium" : "Low"}`}
                      value={v2Settings.eventShock.decayHalfLifeHoursByTier[tier]}
                    />
                  </div>
                ))}
              </div>

              <div className="text-xs font-medium text-(--text-dim) mt-4 mb-1.5">Smoothing &amp; confidence</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-(--text-dim)">Min confidence for extreme label</span>
                  <input
                    type="number"
                    step={1}
                    value={v2Settings.minConfidenceForExtreme}
                    onChange={(e) => updateMinConfidenceForExtreme(Number(e.target.value))}
                    className="h-8 w-24 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                  />
                  <input type="hidden" name="v2:minConfidenceForExtreme" value={v2Settings.minConfidenceForExtreme} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-(--text-dim)">Smoothing α (normal)</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={v2Settings.smoothingAlpha}
                    onChange={(e) => updateSmoothingAlpha("smoothingAlpha", Number(e.target.value))}
                    className="h-8 w-24 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                  />
                  <input type="hidden" name="v2:smoothingAlpha" value={v2Settings.smoothingAlpha} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-(--text-dim)">Smoothing α (HIGH-impact cycle)</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={v2Settings.smoothingAlphaHighImpact}
                    onChange={(e) => updateSmoothingAlpha("smoothingAlphaHighImpact", Number(e.target.value))}
                    className="h-8 w-24 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                  />
                  <input type="hidden" name="v2:smoothingAlphaHighImpact" value={v2Settings.smoothingAlphaHighImpact} />
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-(--text-dim) mb-1.5">Hysteresis (enter / exit)</div>
              <div className="space-y-2">
                {HYSTERESIS_ROWS.map(({ bias, slug }) => {
                  const row = v2Settings.hysteresis.find((h) => h.bias === bias)!;
                  return (
                    <div key={bias} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-(--text-dim) w-24 shrink-0">{bias}</span>
                      <input
                        type="number"
                        step={0.1}
                        value={row.enter}
                        onChange={(e) => updateHysteresis(bias, "enter", Number(e.target.value))}
                        className="h-8 w-20 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                      />
                      <input
                        type="number"
                        step={0.1}
                        value={row.exit}
                        onChange={(e) => updateHysteresis(bias, "exit", Number(e.target.value))}
                        className="h-8 w-20 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                      />
                      <input type="hidden" name={`v2:hysteresis:${slug}:enter`} value={row.enter} />
                      <input type="hidden" name={`v2:hysteresis:${slug}:exit`} value={row.exit} />
                    </div>
                  );
                })}
              </div>

              <div className="text-xs font-medium text-(--text-dim) mt-4 mb-1.5">Factor-family contribution caps</div>
              <div className="space-y-2">
                {FAMILY_ROWS.map(({ family, slug }) => {
                  const row = v2Settings.familyCaps.find((f) => f.family === family)!;
                  return (
                    <div key={family} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-(--text-dim)">{family}</span>
                      <input
                        type="number"
                        step={0.1}
                        value={row.maxContribution}
                        onChange={(e) => updateFamilyCap(family, Number(e.target.value))}
                        className="h-8 w-24 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm tabular-nums outline-none"
                      />
                      <input type="hidden" name={`v2:familyCap:${slug}`} value={row.maxContribution} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {!v2Valid && <p className="text-xs text-amber-400 mt-3">Check Scoring V2 settings above — confidence/smoothing must be in range and each hysteresis exit must sit closer to zero than its entry.</p>}
        </Card>
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

      <Card
        title="Scoring Engine V2 (shadow mode)"
        action={
          <form action={recomputeV2Action}>
            <button
              type="submit"
              disabled={recomputingV2}
              className="flex items-center gap-1.5 text-xs rounded-lg border border-(--border) px-3 py-1.5 font-medium hover:border-(--border-strong) disabled:opacity-60"
            >
              <RotateCw size={13} className={recomputingV2 ? "animate-spin" : ""} /> {recomputingV2 ? "Recalculating…" : "Recompute V2 now"}
            </button>
          </form>
        }
      >
        <p className="text-sm text-(--text-faint)">
          Runs the event-driven V2 engine for every strict-live market against currently stored factor data and writes only to
          V2&apos;s own shadow tables — no live provider calls, and no effect on the scores shown anywhere else in the product.
          Use after a new economic release lands to see V2&apos;s reaction before its automatic cadence exists.
        </p>
        <Link href="/admin/scoring-v2" className="inline-block mt-2 text-xs text-(--accent) underline underline-offset-2">
          View V1 vs V2 comparison →
        </Link>
        {recomputeV2State?.success && <p className="text-xs text-emerald-400 mt-2">{recomputeV2State.success}</p>}
        {recomputeV2State?.error && <p className="text-xs text-rose-400 mt-2">{recomputeV2State.error}</p>}
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
