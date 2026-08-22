// One-off: registers (or reuses) a Stripe webhook endpoint pointing at
// this deployment's /api/webhooks/stripe, subscribed to exactly the events
// api/webhooks/stripe/route.ts handles. Prints the signing secret ONCE —
// Stripe only returns it at creation time — so it can be set as
// STRIPE_WEBHOOK_SECRET immediately after this runs.
//
// Usage: STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-webhook-setup.ts https://your-deployment.vercel.app
import Stripe from "stripe";

const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.log("STRIPE_WEBHOOK_SETUP_RESULT: FAIL — STRIPE_SECRET_KEY is not set");
    return;
  }
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.log("STRIPE_WEBHOOK_SETUP_RESULT: FAIL — pass the deployment base URL as the first argument");
    return;
  }
  const url = `${baseUrl.replace(/\/$/, "")}/api/webhooks/stripe`;
  const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = existing.data.find((e) => e.url === url);
  if (match) {
    console.log(`STRIPE_WEBHOOK_SETUP_STEP: endpoint already registered (${match.id}) for ${url}`);
    console.log("STRIPE_WEBHOOK_SETUP_RESULT: SUCCESS (existing) — signing secret was only shown at creation time; delete and re-run this script if it's been lost");
    return;
  }

  const endpoint = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS });
  console.log(`STRIPE_WEBHOOK_SETUP_STEP: created endpoint ${endpoint.id} for ${url}`);
  console.log(`STRIPE_WEBHOOK_SETUP_RESULT: SUCCESS — set STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
}

main().catch((err) => console.log(`STRIPE_WEBHOOK_SETUP_RESULT: FAIL — ${err instanceof Error ? err.message : String(err)}`));
