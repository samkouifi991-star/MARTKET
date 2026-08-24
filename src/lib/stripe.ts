import "server-only";
import Stripe from "stripe";

// Pinned to the API version this exact `stripe` SDK release's TypeScript
// types were generated against (see node_modules/stripe/esm/apiVersion.d.ts)
// — never left implicit, so a Stripe dashboard-side default-version change
// can't silently reshape the webhook payloads this app parses.
const API_VERSION = "2026-07-29.dahlia";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Add a Stripe secret key (test or live) as a Vercel env var before any billing route can run."
    );
  }
  cached = new Stripe(key, { apiVersion: API_VERSION });
  return cached;
}

// The one product this app sells — see Settings/Pricing pages for the
// user-facing copy. The price id is created once (scripts/stripe-setup.ts)
// and referenced by id from then on, never re-derived from a name/amount
// match at request time.
export const PRO_PRICE_ID = process.env.STRIPE_PRICE_ID;
export const TRIAL_DAYS = 3;
export const PRO_MONTHLY_PRICE_USD = 39;
