"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (query.trim()) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }
    router.push(`/?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSearch} className="flex-1 flex">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search listings…"
        className="w-full rounded-l-full border border-black/10 dark:border-white/15 bg-black/[.03] dark:bg-white/[.06] px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        className="rounded-r-full border border-l-0 border-black/10 dark:border-white/15 bg-black/[.03] dark:bg-white/[.06] px-4 text-sm font-medium hover:bg-black/[.06] dark:hover:bg-white/[.1] transition-colors"
      >
        Search
      </button>
    </form>
  );
}

export function Header() {
  return (
    <header className="border-b border-black/10 dark:border-white/10 sticky top-0 bg-background/90 backdrop-blur z-10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/" className="text-xl font-bold tracking-tight shrink-0">
          MART<span className="text-blue-600">KET</span>
        </Link>
        <Suspense fallback={<div className="flex-1" />}>
          <SearchForm />
        </Suspense>
        <Link
          href="/sell"
          className="shrink-0 rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          + Sell
        </Link>
      </div>
    </header>
  );
}
