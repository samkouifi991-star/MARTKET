import Link from "next/link";
import { CATEGORY_ICON, Listing } from "@/lib/listings";

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Link
      href={`/listing/${listing.id}`}
      className="group rounded-xl border border-black/10 dark:border-white/10 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all bg-white dark:bg-white/[.03]"
    >
      <div className="aspect-[4/3] flex items-center justify-center text-6xl bg-gradient-to-br from-blue-50 to-slate-100 dark:from-white/[.06] dark:to-white/[.02]">
        {CATEGORY_ICON[listing.category]}
      </div>
      <div className="p-4">
        <p className="font-semibold truncate group-hover:text-blue-600 transition-colors">
          {listing.title}
        </p>
        <p className="text-lg font-bold mt-1">${listing.price.toLocaleString()}</p>
        <p className="text-sm text-black/60 dark:text-white/50 mt-1 truncate">
          {listing.location}
        </p>
        <span className="inline-block mt-2 text-xs rounded-full bg-black/[.05] dark:bg-white/[.08] px-2 py-1">
          {listing.category}
        </span>
      </div>
    </Link>
  );
}
