"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/dal";
import { createTrialCheckoutSession, createBillingPortalSession } from "@/lib/billing";
import { getSubscriptionByUserId } from "@/db/queries/users";

/** Used by the paywall/pricing "Start 3-Day Free Trial" button for a user
 * who is already logged in (e.g. abandoned checkout, or a trial that ended
 * unpaid) — creates a fresh Checkout Session and redirects to Stripe. */
export async function startTrialCheckout(): Promise<void> {
  const user = await requireSession();
  const url = await createTrialCheckoutSession(user);
  redirect(url);
}

/** Stripe's hosted billing portal — update payment method, view invoices,
 * cancel or resume. The Settings page's "Manage billing" button. */
export async function openBillingPortal(): Promise<void> {
  const user = await requireSession();
  const subscription = await getSubscriptionByUserId(user.id);
  if (!subscription?.stripeCustomerId) redirect("/paywall");
  const url = await createBillingPortalSession(subscription.stripeCustomerId);
  redirect(url);
}
