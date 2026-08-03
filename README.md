# MARTKET

A simple marketplace app for browsing, searching, and listing items for sale — built with Next.js (App Router), TypeScript, and Tailwind CSS.

## Features

- Browse listings in a responsive grid, filterable by category
- Search listings by title/description
- View listing details
- Create new listings via a form (persisted to the browser's `localStorage`, seeded with sample data)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view it.

## Deploying to Vercel

This is a standard Next.js app, so it deploys to [Vercel](https://vercel.com/new) with zero configuration:

1. Push this repository to GitHub (already done if you're reading this on GitHub).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Vercel auto-detects the Next.js framework, build command (`next build`), and output — just click **Deploy**.

## Project structure

- `src/app/page.tsx` — home page (listing grid, search, category filter)
- `src/app/listing/[id]/page.tsx` — listing detail page
- `src/app/sell/page.tsx` — create-listing form
- `src/lib/listings.ts` — types and seed data
- `src/lib/useListings.ts` — client hook combining seed data with user-created listings
- `src/components/` — shared `Header`, `Footer`, `ListingCard`
