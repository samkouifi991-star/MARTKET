// Phase 19 — automated public-launch readiness audit, exposed as a
// diagnostic route so it can be run against real production storage state
// from outside a browser session (this sandbox has no direct network path
// to production — see the diagnostics/scorecard/[symbol] page and the
// scorecard-diagnostic-screenshot GH Actions workflow for the same
// established pattern). Protected by EVENT_WATCH_SECRET/CRON_SECRET, same
// as the economic-release watch route — never session-gated only, since
// this is meant to be called by an external process, not a logged-in admin
// browsing the app.
import { NextRequest, NextResponse } from "next/server";
import { runLaunchAudit } from "@/lib/pipeline/launch-audit";
import { demoModeSkip, isDemoMode, unauthorized, verifyEventWatchAuth } from "../../cron/_shared";

export async function GET(req: NextRequest) {
  if (!verifyEventWatchAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const rows = await runLaunchAudit();
  const summary = {
    total: rows.length,
    pass: rows.filter((r) => r.verdict === "PASS").length,
    warning: rows.filter((r) => r.verdict === "WARNING").length,
    fail: rows.filter((r) => r.verdict === "FAIL").length,
  };
  return NextResponse.json({ summary, rows });
}
