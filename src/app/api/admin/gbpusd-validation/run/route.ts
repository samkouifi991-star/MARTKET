// Manual "Run Live Validation" trigger for /admin/gbpusd-validation — the
// only place in the app allowed to call getGbpusdValidation() (the version
// that hits every real provider). Wrapped in request-cache's TTL +
// coalescing so:
//   - concurrent POSTs (double-click, two tabs) collapse into one in-flight
//     run instead of each independently hammering FMP/CFTC/FRED/Myfxbook
//   - repeated clicks within RUN_TTL_MS reuse the same result rather than
//     triggering a fresh provider round-trip every time
// This is what makes the button in item 6 "rate-limited" and "deduplicate
// calls" at the server layer — the client button disables itself too, but
// that's just UX; this is the real guarantee.
import { NextResponse } from "next/server";
import { getGbpusdValidation } from "@/lib/pipeline/gbpusd-validation";
import { cached } from "@/services/market-data/request-cache";
import { isDemoOnly } from "@/services/data-mode";
import { getSessionUser } from "@/lib/auth/session";
import { isAdminUser } from "@/lib/auth/dal";

const RUN_TTL_MS = 60_000;
const CACHE_KEY = "admin:gbpusd-validation:live-run";

// proxy.ts's optimistic gate only checks that SOME session cookie is
// present (never which user, see session.ts's hasSessionCookie docs) — it
// blocks anonymous requests but does not distinguish an admin from any
// other logged-in customer. Route Handlers aren't covered by page-level
// requireAdmin() guards (that's a Server Component/Server Action helper —
// it calls next/navigation's redirect(), which isn't meaningful here), so
// this route needs its own real, DB-backed admin check — otherwise any
// authenticated customer could trigger real FMP/CFTC/FRED/Myfxbook calls
// against this project's own provider credentials.
export async function POST() {
  const user = await getSessionUser();
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isDemoOnly()) {
    return NextResponse.json({ error: "DATA_MODE is demo — there are no live providers to validate." }, { status: 409 });
  }

  try {
    const result = await cached(CACHE_KEY, RUN_TTL_MS, () => getGbpusdValidation());
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
