// One-off, run once from inside a Vercel Preview build (via a temporary
// vercel-build wiring) where the real STRIPE_SECRET_KEY is actually
// present — this sandbox cannot read it back once Vercel stores it as a
// "sensitive" (write-only) env var, by design.
//
// Does three things:
//   1. Creates (or reuses) the "Market Intelligence Pro" $39/month price —
//      prints the price id (not a secret, safe to log).
//   2. Creates (or reuses) a Stripe webhook endpoint for this deployment's
//      stable branch-alias URL, subscribed to exactly the events
//      api/webhooks/stripe/route.ts handles.
//   3. NEVER prints the resulting webhook signing secret. Instead it calls
//      the Vercel API directly (using SETUP_VERCEL_TOKEN, a temporary,
//      narrowly-scoped credential set only for this one run and removed
//      immediately after) to store it as STRIPE_WEBHOOK_SECRET, a
//      "sensitive" env var — the same write-only treatment
//      STRIPE_SECRET_KEY itself already has.
//
// Usage (inside vercel-build only): tsx scripts/stripe-full-setup.ts
import Stripe from "stripe";

const VERCEL_PROJECT_ID = "prj_KVsrHfXMUcSoNgzE9IgvULUFMFMr";
const VERCEL_TEAM_ID = "team_ivljqH57vkpDCysqNbYz7rw6";
const PREVIEW_BASE_URL = "https://market-intelligence-ai-git-c-7fdbff-samkouifi991-stars-projects.vercel.app";

const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

async function setVercelEnv(key: string, value: string, token: string, opts: { sensitive?: boolean } = {}): Promise<void> {
  const res = await fetch(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, target: ["preview"], type: opts.sensitive ? "sensitive" : "plain" }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Deliberately not including `value` in this error — only the API's
    // own response body (which never contains a value we sent) and status.
    throw new Error(`Vercel API set-env failed for ${key}: ${res.status} ${body}`);
  }
}

async function main() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.log("STRIPE_FULL_SETUP_RESULT: SKIPPED — STRIPE_SECRET_KEY is not set in this build environment");
    return;
  }
  const setupToken = process.env.SETUP_VERCEL_TOKEN;
  if (!setupToken) {
    console.log("STRIPE_FULL_SETUP_RESULT: FAIL — SETUP_VERCEL_TOKEN is not set (needed to store the webhook secret without ever printing it)");
    return;
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-07-29.dahlia" });

  // 1. Product + price.
  const products = await stripe.products.search({ query: `name:"Market Intelligence Pro" AND active:"true"` });
  let product = products.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: "Market Intelligence Pro",
      description:
        "All supported markets, full score breakdowns, rankings, retail sentiment, institutional positioning, technical analysis, macro intelligence, seasonality, watchlists, alerts, and unlimited AI Analyst.",
    });
  }
  const prices = await stripe.prices.list({ product: product.id, active: true });
  let price = prices.data.find((p) => p.unit_amount === 3900 && p.currency === "usd" && p.recurring?.interval === "month");
  if (!price) {
    price = await stripe.prices.create({ product: product.id, unit_amount: 3900, currency: "usd", recurring: { interval: "month" }, nickname: "Pro monthly" });
  }
  console.log(`STRIPE_FULL_SETUP_STEP: product=${product.id} price=${price.id}`);
  await setVercelEnv("STRIPE_PRICE_ID", price.id, setupToken);
  console.log("STRIPE_FULL_SETUP_STEP: STRIPE_PRICE_ID stored in Vercel (preview)");

  // 2. Webhook endpoint.
  const webhookUrl = `${PREVIEW_BASE_URL}/api/webhooks/stripe`;
  const existingEndpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = existingEndpoints.data.find((e) => e.url === webhookUrl);
  if (existing) {
    console.log(`STRIPE_FULL_SETUP_STEP: webhook endpoint already registered (${existing.id}) for ${webhookUrl} — its secret can't be re-read; delete it in the Stripe dashboard and re-run this script if STRIPE_WEBHOOK_SECRET is missing/wrong`);
  } else {
    const endpoint = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: WEBHOOK_EVENTS });
    console.log(`STRIPE_FULL_SETUP_STEP: created webhook endpoint ${endpoint.id} for ${webhookUrl}`);
    await setVercelEnv("STRIPE_WEBHOOK_SECRET", endpoint.secret!, setupToken, { sensitive: true });
    console.log("STRIPE_FULL_SETUP_STEP: STRIPE_WEBHOOK_SECRET stored in Vercel (preview, sensitive) — value never logged");
  }

  console.log("STRIPE_FULL_SETUP_RESULT: SUCCESS");
}

main().catch((err) => console.log(`STRIPE_FULL_SETUP_RESULT: FAIL — ${err instanceof Error ? err.message : String(err)}`));
