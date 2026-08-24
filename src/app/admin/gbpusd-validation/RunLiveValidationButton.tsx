"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { ValidationRow } from "@/lib/pipeline/gbpusd-validation";
import { GbpusdValidationTable } from "./GbpusdValidationTable";

type MyfxbookDiagnostic = { loginSuccessful: boolean; sessionReceived: boolean; communityOutlookSuccessful: boolean; symbolFound: boolean; error?: string };

type RunResult = {
  rows: ValidationRow[];
  dbError: string | null;
  myfxbookDiagnostic: MyfxbookDiagnostic | null;
  generatedAt: string;
};

// Matches the server route's RUN_TTL_MS — the server already coalesces
// calls within this window into one shared result, but disabling the
// button client-side too means an impatient click doesn't even reach the
// network, which is the point of item 6's "prevent repeated clicking".
const COOLDOWN_SECONDS = 60;

export function RunLiveValidationButton() {
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (pending || cooldown > 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/gbpusd-validation/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
      setCooldown(COOLDOWN_SECONDS);
      const interval = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(interval);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
  }

  return (
    <Card
      title="Run Live Validation"
      subtitle="Calls every real provider (FMP, CFTC, FRED, Myfxbook, IG) once, right now, instead of relying on the stored snapshot above. Rate-limited to one run per minute — repeated clicks reuse the in-flight or most recent result."
    >
      <button
        onClick={run}
        disabled={pending || cooldown > 0}
        className="inline-flex items-center gap-2 rounded-lg border border-(--border-strong) bg-(--bg-elevated) px-4 py-2 text-sm font-medium text-(--text) disabled:opacity-50 disabled:cursor-not-allowed hover:border-(--accent) transition-colors"
      >
        {pending ? "Running…" : cooldown > 0 ? `Run Live Validation (wait ${cooldown}s)` : "Run Live Validation"}
      </button>

      {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}

      {result && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-(--text-faint)">Live run completed — evidence as of that moment, not a live-updating view.</p>
          <GbpusdValidationTable rows={result.rows} />

          {result.myfxbookDiagnostic && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile label="Myfxbook login" value={result.myfxbookDiagnostic.loginSuccessful ? "Yes" : "No"} valueClassName={result.myfxbookDiagnostic.loginSuccessful ? "text-emerald-400" : "text-rose-400"} />
              <StatTile
                label="Session received"
                value={result.myfxbookDiagnostic.sessionReceived ? "Yes" : "No"}
                valueClassName={result.myfxbookDiagnostic.sessionReceived ? "text-emerald-400" : "text-rose-400"}
              />
              <StatTile
                label="Community outlook"
                value={result.myfxbookDiagnostic.communityOutlookSuccessful ? "Yes" : "No"}
                valueClassName={result.myfxbookDiagnostic.communityOutlookSuccessful ? "text-emerald-400" : "text-rose-400"}
              />
              <StatTile label="GBPUSD found" value={result.myfxbookDiagnostic.symbolFound ? "Yes" : "No"} valueClassName={result.myfxbookDiagnostic.symbolFound ? "text-emerald-400" : "text-rose-400"} />
            </div>
          )}
          {result.myfxbookDiagnostic?.error && <p className="text-xs text-rose-400">{result.myfxbookDiagnostic.error}</p>}
          {result.dbError && <p className="text-xs text-rose-400">Database: {result.dbError}</p>}
        </div>
      )}
    </Card>
  );
}
