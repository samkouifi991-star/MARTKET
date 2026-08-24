import Link from "next/link";
import { SignupForm } from "@/components/marketing/SignupForm";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const metadata = { title: "Start Your Free Trial — Market Intelligence AI" };

export default function SignupPage() {
  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="flex items-center gap-2 justify-center mb-6">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-(--accent) to-cyan-400 text-white font-bold text-sm">
              MI
            </span>
            <span className="font-semibold tracking-tight text-(--text)">Market Intelligence AI</span>
          </Link>
          <div className="card p-6">
            <h1 className="text-lg font-semibold text-center">Start your 3-day free trial</h1>
            <p className="text-xs text-(--text-faint) text-center mt-1 mb-5">
              Then $39/month. Cancel anytime.
            </p>
            <SignupForm />
          </div>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
