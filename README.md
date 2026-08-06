# Market Intelligence AI

A browser-based market-intelligence platform that turns fundamental, sentiment, positioning, seasonality and technical data into one transparent, explainable scoring system — built with Next.js (App Router), TypeScript, and Tailwind CSS.

This is an **analysis and market-scanning tool only**. It does not execute trades, promise profits, or provide financial advice. See the disclaimer in the app footer and `/settings`.

## Demo data mode

This build runs entirely on deterministic, clearly-labeled **demo data** (see "Demo Data Mode" in the top bar). There is no live market-data provider, database, or billing backend wired up — everything in `src/lib/demo/` is a seeded, reproducible generator standing in for what would otherwise be ingestion pipelines and third-party feeds. The scoring engine itself (`src/lib/scoring.ts`) is real: it's a pure, transparent function of that demo data, structured so a production data layer could be swapped in without touching the scoring or UI logic.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

- `src/lib/types.ts` — shared domain types (instruments, scores, positioning, sentiment, news, calendar, etc.)
- `src/lib/instruments.ts` — the supported instrument list (Forex, Indices, Commodities, Crypto); add instruments here without touching the scoring engine
- `src/lib/config.ts` — admin-configurable factor weights, bias thresholds, retail-sentiment thresholds, risk-gauge bands, subscription plans
- `src/lib/scoring.ts` — the transparent scoring engine: computes each factor's raw score, weight, contribution, explanation, source and freshness, then the total score, bias, confidence and history
- `src/lib/demo/` — seeded demo-data generators (price/technicals, institutional positioning, retail sentiment, smart-money divergence, economies, central banks, seasonality, options sentiment, investor sentiment, news, economic calendar, risk gauge, backtesting, alerts, watchlists, admin data)
- `src/lib/aiAnalyst.ts` — the rule-based "Market Analyst AI" responder: answers only from platform data and cites the factors it used
- `src/components/` — shared layout (`Sidebar`, `Topbar`, `AppShell`), UI primitives (`BiasBadge`, `ScoreGauge`, `ConfidenceBar`, `DataFreshnessTag`), and charts (Recharts-based price/score-history charts, heatmap grid)
- `src/app/` — one route per nav item (Dashboard, Top Setups, Markets, Watchlists, Institutional Positioning, Retail Sentiment, Smart Money, Technical Trends, Seasonality, Economic Growth, Inflation, Labor Market, Interest Rates, Options Sentiment, News Intelligence, Economic Calendar, Market Heatmap, Risk Gauge, Alerts, Backtesting, AI Analyst, Settings, Admin)

## Deploying to Vercel

This is a standard Next.js app, so it deploys to [Vercel](https://vercel.com/new) with zero configuration: import the repository and Vercel auto-detects the build.
