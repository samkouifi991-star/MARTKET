// Next.js 16 renamed `middleware.ts` to `proxy.ts` (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// middleware.md — "deprecated ... renamed to proxy.js", same behavior,
// new file/export name). This is the fast, optimistic first line of
// defense: it only ever checks whether a session cookie is present, never
// hits Neon (Proxy runs on every request, including prefetches, so a DB
// round trip here would be a real performance problem — see Next's own
// authentication guide). The real, DB-backed checks (a valid session, the
// right entitlement) live in lib/auth/dal.ts's requireSession/
// requireEntitlement/requireAdmin, called at the top of every protected
// page — this proxy is a UX shortcut on top of that, not a replacement
// for it.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

// Always reachable with no session: the marketing site, auth entry points,
// legal pages, and the integration endpoints that are never called by a
// logged-in browser (Stripe calls the webhook directly with no cookie at
// all; the cron routes authenticate via CRON_SECRET instead of a session;
// the high-frequency economic-release watch route — see
// app/api/watch/economic-releases/route.ts — is the same shape, called by
// GitHub Actions with EVENT_WATCH_SECRET/CRON_SECRET, never a browser).
// /diagnostics/ is the same shape too: read-only verification pages
// (app/diagnostics/**) that check their own EVENT_WATCH_SECRET/CRON_SECRET
// via a URL query param instead of a session — see that page's own header
// comment. Never linked from the product UI.
const PUBLIC_EXACT = new Set(["/", "/signup", "/signin", "/pricing"]);
const PUBLIC_PREFIXES = ["/legal", "/api/webhooks/", "/api/cron/", "/api/watch/", "/diagnostics/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!hasSession) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and image optimization — Proxy should still run on
  // every real page/API request, including auth-relevant ones.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
