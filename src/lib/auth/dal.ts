import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "./session";
import { getSubscriptionByUserId } from "@/db/queries/users";
import type { User, Subscription } from "@/db/queries/users";

// The approved owner/admin identity — bypasses the SUBSCRIPTION/paywall
// check only (see requireEntitlement/requireAdmin below), in every
// environment including production. This is deliberate: it's the site
// owner's own real account, not a dev/test-only backdoor, so it must work
// wherever they actually use the product. It never bypasses
// authentication itself — every call site below still requires a real,
// valid session (requireSession) before this is even consulted, and it
// never touches Stripe/subscription state (no fake subscription is
// created, no checkout is triggered) — it just short-circuits the
// entitlement check to true for this one email.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "samkouifi991@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminUser(user: User | undefined): boolean {
  return Boolean(user && ADMIN_EMAILS.includes(user.email.toLowerCase()));
}

// Statuses that grant access to the paid product, mirroring Stripe's own
// subscription-status vocabulary — see schema.ts's subscriptions.status.
const ENTITLED_STATUSES = new Set(["trialing", "active"]);

export function isEntitled(subscription: Subscription | undefined): boolean {
  return Boolean(subscription && ENTITLED_STATUSES.has(subscription.status));
}

// Memoized per request so multiple guards/components calling this during
// one render don't each round-trip to Neon.
export const verifySession = cache(async (): Promise<User | null> => {
  const user = await getSessionUser();
  return user ?? null;
});

export const getEntitlement = cache(async (userId: number): Promise<Subscription | null> => {
  const sub = await getSubscriptionByUserId(userId);
  return sub ?? null;
});

/** Any logged-in user, regardless of subscription status — for pages like
 * /settings and /paywall that a canceled/past-due user must still reach to
 * manage or reactivate billing. Redirects to sign-in otherwise. */
export async function requireSession(): Promise<User> {
  const user = await verifySession();
  if (!user) redirect("/signin");
  return user;
}

/** The real gate for the paid product: logged in AND (the approved admin/
 * owner account, OR a trialing/active subscription). Redirects to
 * /paywall otherwise — never silently renders paid content for an
 * unentitled user. requireSession() below still runs first in every case,
 * so this never bypasses authentication itself, only the subscription
 * check. */
export async function requireEntitlement(): Promise<{ user: User; subscription: Subscription | null }> {
  const user = await requireSession();
  if (isAdminUser(user)) return { user, subscription: null };

  const subscription = await getEntitlement(user.id);
  if (!isEntitled(subscription ?? undefined)) redirect("/paywall");
  return { user, subscription };
}

/** /admin is an internal operational page, not part of the paid product —
 * gated to the approved admin bypass identity only, never to any paying
 * customer. */
export async function requireAdmin(): Promise<User> {
  const user = await requireSession();
  if (!isAdminUser(user)) redirect("/paywall");
  return user;
}
