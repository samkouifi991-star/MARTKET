// Phase 19 — automated public-launch readiness audit, exposed as a
// diagnostic route so it can be run against real production storage state
// from outside a browser session (this sandbox has no direct network path
// to production — see the diagnostics/scorecard/[symbol] page and the
// scorecard-diagnostic-screenshot GH Actions workflow for the same
// established pattern). Lives under /api/watch/ — the SAME shape as
// api/watch/economic-releases (called by GitHub Actions with
// EVENT_WATCH_SECRET/CRON_SECRET, never a browser) — deliberately not
// under /api/admin/, since proxy.ts's optimistic session-cookie gate
// would redirect an unauthenticated (no-cookie) bearer-token request like
// this one to /signin before it ever reached this handler's own auth
// check; /api/watch/ is explicitly whitelisted in proxy.ts for exactly
// this case.
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
