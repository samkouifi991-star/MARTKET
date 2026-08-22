// One-off: creates the "Market Intelligence Pro" Stripe product + its
// $39/month recurring price, if STRIPE_PRICE_ID isn't already set. Prints
// the resulting price id so it can be added as the STRIPE_PRICE_ID env var
// — this script never writes to Vercel itself, it only reports what to set.
// Idempotent-ish: re-running with STRIPE_PRICE_ID already set just verifies
// that price still exists rather than creating a duplicate.
//
// Usage: STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-setup.ts
import Stripe from "stripe";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.log("STRIPE_SETUP_RESULT: FAIL — STRIPE_SECRET_KEY is not set in this shell's environment");
    return;
  }
  const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

  const existingPriceId = process.env.STRIPE_PRICE_ID;
  if (existingPriceId) {
    try {
      const price = await stripe.prices.retrieve(existingPriceId, { expand: ["product"] });
      console.log(
        `STRIPE_SETUP_RESULT: SUCCESS (existing) — price ${price.id} amount=${price.unit_amount} currency=${price.currency} recurring=${price.recurring?.interval} product=${typeof price.product === "string" ? price.product : price.product.id}`
      );
      return;
    } catch (err) {
      console.log(`STRIPE_SETUP_STEP: STRIPE_PRICE_ID=${existingPriceId} could not be retrieved (${err instanceof Error ? err.message : String(err)}) — creating a fresh product/price`);
    }
  }

  const products = await stripe.products.search({ query: `name:"Market Intelligence Pro" AND active:"true"` });
  let product = products.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: "Market Intelligence Pro",
      description: "All supported markets, full score breakdowns, rankings, retail sentiment, institutional positioning, technical analysis, macro intelligence, seasonality, watchlists, alerts, and unlimited AI Analyst.",
    });
    console.log(`STRIPE_SETUP_STEP: created product ${product.id}`);
  } else {
    console.log(`STRIPE_SETUP_STEP: reusing existing product ${product.id}`);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true });
  let price = prices.data.find((p) => p.unit_amount === 3900 && p.currency === "usd" && p.recurring?.interval === "month");
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 3900,
      currency: "usd",
      recurring: { interval: "month" },
      nickname: "Pro monthly",
    });
    console.log(`STRIPE_SETUP_STEP: created price ${price.id}`);
  } else {
    console.log(`STRIPE_SETUP_STEP: reusing existing price ${price.id}`);
  }

  console.log(`STRIPE_SETUP_RESULT: SUCCESS — set STRIPE_PRICE_ID=${price.id}`);
}

main().catch((err) => console.log(`STRIPE_SETUP_RESULT: FAIL — ${err instanceof Error ? err.message : String(err)}`));
