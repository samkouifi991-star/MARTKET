"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, Category } from "@/lib/listings";
import { useListings } from "@/lib/useListings";
import { ListingCard } from "@/components/ListingCard";
import Link from "next/link";

function HomeContent() {
  const searchParams = useSearchParams();
  const { listings, loaded } = useListings();
  const query = (searchParams.get("q") ?? "").toLowerCase();
  const category = searchParams.get("category") as Category | null;

  const filtered = useMemo(() => {
    return listings.filter((l) => {
      const matchesQuery =
        !query ||
        l.title.toLowerCase().includes(query) ||
        l.description.toLowerCase().includes(query);
      const matchesCategory = !category || l.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [listings, query, category]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 w-full">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {query ? `Results for "${searchParams.get("q")}"` : "Browse listings"}
        </h1>
        <p className="text-black/60 dark:text-white/50 mt-1">
          Find great deals from people near you.
        </p>
      </section>

      <div className="flex gap-2 flex-wrap mb-8">
        <Link
          href="/"
          className={`text-sm rounded-full px-3 py-1.5 border transition-colors ${
            !category
              ? "bg-blue-600 border-blue-600 text-white"
              : "border-black/10 dark:border-white/15 hover:bg-black/[.04] dark:hover:bg-white/[.06]"
          }`}
        >
          All
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/?category=${encodeURIComponent(c)}`}
            className={`text-sm rounded-full px-3 py-1.5 border transition-colors ${
              category === c
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-black/10 dark:border-white/15 hover:bg-black/[.04] dark:hover:bg-white/[.06]"
            }`}
          >
            {c}
          </Link>
        ))}
      </div>

      {!loaded ? (
        <p className="text-black/50 dark:text-white/40">Loading listings…</p>
      ) : filtered.length === 0 ? (
        <p className="text-black/50 dark:text-white/40">
          No listings match your search.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
