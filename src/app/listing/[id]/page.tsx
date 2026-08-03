"use client";

import { use } from "react";
import Link from "next/link";
import { useListings } from "@/lib/useListings";
import { CATEGORY_ICON } from "@/lib/listings";

export default function ListingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { listings, loaded } = useListings();
  const listing = listings.find((l) => l.id === id);

  if (!loaded) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 w-full">
        <p className="text-black/50 dark:text-white/40">Loading…</p>
      </main>
    );
  }

  if (!listing) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 w-full">
        <p className="text-black/60 dark:text-white/50">Listing not found.</p>
        <Link href="/" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          ← Back to listings
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 w-full">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back to listings
      </Link>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="aspect-[4/3] rounded-xl flex items-center justify-center text-9xl bg-gradient-to-br from-blue-50 to-slate-100 dark:from-white/[.06] dark:to-white/[.02]">
          {CATEGORY_ICON[listing.category]}
        </div>
        <div>
          <span className="text-xs rounded-full bg-black/[.05] dark:bg-white/[.08] px-2 py-1">
            {listing.category}
          </span>
          <h1 className="text-2xl font-bold mt-3">{listing.title}</h1>
          <p className="text-3xl font-bold mt-2">${listing.price.toLocaleString()}</p>
          <p className="text-black/60 dark:text-white/50 mt-1">{listing.location}</p>
          <p className="mt-6 leading-relaxed">{listing.description}</p>
          <div className="mt-6 border-t border-black/10 dark:border-white/10 pt-4 text-sm text-black/60 dark:text-white/50">
            <p>Listed by @{listing.seller}</p>
            <p>Posted {listing.createdAt}</p>
          </div>
          <button className="mt-6 w-full rounded-full bg-blue-600 text-white py-3 font-semibold hover:bg-blue-700 transition-colors">
            Contact seller
          </button>
        </div>
      </div>
    </main>
  );
}
