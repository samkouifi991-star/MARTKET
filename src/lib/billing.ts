import "server-only";
import Stripe from "stripe";
import { getStripe, PRO_PRICE_ID, TRIAL_DAYS } from "./stripe";
import { createPendingSubscription, getSubscriptionByUserId, upsertSubscriptionByStripeCustomerId, type SubscriptionUpsert } from "@/db/queries/users";
import type { User } from "@/db/queries/users";

function absoluteUrl(path: string): string {
  // VERCEL_PROJECT_PRODUCTION_URL is present on every deployment (preview
  // included) but always names the PRODUCTION domain — preferring it here
  // would send a preview deployment's Stripe redirects to production. Only
  // trust it when this build's own target actually is production;
  // otherwise fall back to this deployment's own URL.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");
  return `${base}${path}`;
}

async function getOrCreateStripeCustomer(user: User): Promise<string> {
  const existing = await getSubscriptionByUserId(user.id);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: String(user.id) },
  });
  await createPendingSubscription(user.id, customer.id);
  return customer.id;
}

/** Creates a Stripe Checkout Session for the 3-day-trial Pro subscription
 * and returns its hosted URL — the browser is redirected there so card
 * entry happens entirely on Stripe's page (this app never sees or stores
 * card data). success_url points at /api/checkout/sync, which reconciles
 * this app's subscription row synchronously before the user ever reaches
 * the dashboard, so there's no race with the (still-authoritative) webhook. */
export async function createTrialCheckoutSession(user: User): Promise<string> {
  if (!PRO_PRICE_ID) {
    throw new Error("STRIPE_PRICE_ID is not configured. Run scripts/stripe-setup.ts once to create the Pro product/price.");
  }
  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: String(user.id),
    line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
    subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { userId: String(user.id) } },
    success_url: absoluteUrl("/api/checkout/sync?session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: absoluteUrl("/paywall?checkout=canceled"),
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout Session URL.");
  return session.url;
}

/** Stripe's hosted self-service portal — update payment method, view
 * invoices, cancel or reactivate. The one Stripe-recommended way to let a
 * customer manage billing without this app ever touching card data. */
export async function createBillingPortalSession(stripeCustomerId: string): Promise<string> {
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: absoluteUrl("/settings"),
  });
  return portal.url;
}

/** Maps a Stripe Subscription object to this app's subscriptions-table
 * shape. `current_period_end`/`current_period_start` live on the
 * subscription's first item, not the subscription itself, in this SDK's
 * pinned API version (see node_modules/stripe/esm/resources/
 * SubscriptionItems.d.ts) — a real, documented Stripe API change, not an
 * oversight here. */
export function subscriptionToUpsert(subscription: Stripe.Subscription): SubscriptionUpsert {
  const item = subscription.items.data[0];
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  return {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    priceId: item?.price.id ?? null,
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  await upsertSubscriptionByStripeCustomerId(subscriptionToUpsert(subscription));
}
