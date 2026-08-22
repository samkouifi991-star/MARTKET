import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { PricingCard } from "@/components/marketing/PricingCard";
import { verifySession } from "@/lib/auth/dal";

export const metadata = { title: "Pricing — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const sessionUser = await verifySession();
  const user = sessionUser ? { email: sessionUser.email } : null;

  return (
    <div className="min-h-dvh flex flex-col">
      <MarketingNav user={user} />

      <main className="flex-1">
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">One plan. Everything included.</h1>
          <p className="mt-3 text-(--text-dim)">No Free tier. No Professional tier. No annual plan — just one straightforward price.</p>

          <div className="mt-10">
            <PricingCard
              cta={
                <Link href="/signup" className="block w-full h-10 rounded-lg bg-(--accent) text-white text-sm font-semibold leading-10">
                  Start 3-Day Free Trial
                </Link>
              }
            />
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16">
          <h2 className="text-lg font-semibold text-center mb-6">Frequently asked questions</h2>
          <dl className="space-y-5">
            <Faq q="How long is the free trial?" a="3 days." />
            <Faq q="How much is it after the trial?" a="$39/month." />
            <Faq q="Can I cancel?" a="Yes, anytime — from Settings, with no retention flow to fight through." />
            <Faq q="Will I be charged today?" a="No, not when the trial starts. Billing begins after the 3-day trial according to the Stripe subscription terms." />
            <Faq q="Is this investment advice?" a="No. The platform provides informational and educational market intelligence, not investment advice." />
          </dl>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-medium text-sm">{q}</dt>
      <dd className="text-sm text-(--text-dim) mt-1">{a}</dd>
    </div>
  );
}
