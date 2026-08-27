import Link from "next/link";
import { signout } from "@/lib/auth/actions";

export function MarketingNav({ user }: { user: { email: string } | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-(--border) bg-(--bg)/85 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-(--accent) to-cyan-400 text-white font-bold text-sm">
            MI
          </span>
          <span className="font-semibold tracking-tight text-(--text)">Market Intelligence AI</span>
        </Link>

        <nav className="hidden md:flex items-center gap-5 text-sm text-(--text-dim)">
          <Link href="/#product" className="hover:text-(--text)">Product</Link>
          <Link href="/features" className="hover:text-(--text)">Features</Link>
          <Link href="/#how-it-works" className="hover:text-(--text)">How It Works</Link>
          <Link href="/#markets" className="hover:text-(--text)">Markets</Link>
          <Link href="/pricing" className="hover:text-(--text)">Pricing</Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <Link href="/dashboard" className="h-9 px-4 rounded-lg bg-(--accent) text-white text-sm font-medium inline-flex items-center">
                Dashboard
              </Link>
              <form action={signout}>
                <button type="submit" className="h-9 px-4 rounded-lg border border-(--border) text-sm font-medium text-(--text-dim) hover:text-(--text) hover:border-(--border-strong)">
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/signin" className="text-sm text-(--text-dim) hover:text-(--text)">Sign In</Link>
              <Link href="/signup" className="h-9 px-4 rounded-lg bg-(--accent) text-white text-sm font-medium inline-flex items-center">
                Start Free Trial
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
