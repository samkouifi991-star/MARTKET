"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, Category } from "@/lib/listings";
import { useListings } from "@/lib/useListings";

export default function Sell() {
  const router = useRouter();
  const { addListing } = useListings();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [location, setLocation] = useState("");
  const [seller, setSeller] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const numericPrice = Number(price);
    if (!title.trim() || !description.trim() || !location.trim() || !seller.trim()) {
      setError("Please fill out every field.");
      return;
    }
    if (!numericPrice || numericPrice <= 0) {
      setError("Enter a valid price.");
      return;
    }

    const id = `u-${Date.now()}`;
    addListing({
      id,
      title: title.trim(),
      description: description.trim(),
      price: numericPrice,
      category,
      location: location.trim(),
      seller: seller.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
    });
    router.push(`/listing/${id}`);
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-8 w-full">
      <h1 className="text-2xl font-bold">Create a listing</h1>
      <p className="text-black/60 dark:text-white/50 mt-1">
        Fill in the details below to list an item for sale.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. iPhone 15 Pro, 256GB"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Condition, details, reason for selling…"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Price (USD)
            <input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="City, State"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Your username
          <input
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. jdoe"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          className="mt-2 rounded-full bg-blue-600 text-white py-3 font-semibold hover:bg-blue-700 transition-colors"
        >
          Publish listing
        </button>
      </form>
    </main>
  );
}
