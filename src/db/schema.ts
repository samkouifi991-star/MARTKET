import { boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

// Provider/status vocabulary shared with src/lib/types.ts's DataFreshness —
// kept as plain text columns (not a pg enum) so new statuses don't require a
// migration, matching the ProviderName/DataFreshness unions in services/types.ts.

// ---- Market prices (latest snapshot per symbol; upserted on every fetch) ----
export const marketPrices = pgTable("market_prices", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 16 }).notNull().unique(),
  price: doublePrecision("price").notNull(),
  changePct24h: doublePrecision("change_pct_24h").notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Historical OHLC candles, append-only, one row per symbol/timeframe/date ----
export const marketCandles = pgTable(
  "market_candles",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    timeframe: varchar("timeframe", { length: 8 }).notNull(), // "1h" | "4h" | "1d"
    date: timestamp("date", { withTimezone: true }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume"),
    provider: varchar("provider", { length: 32 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("market_candles_symbol_tf_date").on(t.symbol, t.timeframe, t.date)]
);

// ---- CFTC institutional positioning — one row per symbol/classification/report week ----
export const institutionalPositioning = pgTable(
  "institutional_positioning",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    classification: varchar("classification", { length: 32 }).notNull(), // "Asset Manager" | "Leveraged Funds" | "Managed Money" | ...
    reportDate: timestamp("report_date", { withTimezone: true }).notNull(), // CFTC "as of" Tuesday
    longContracts: integer("long_contracts").notNull(),
    shortContracts: integer("short_contracts").notNull(),
    netPositioning: integer("net_positioning").notNull(),
    openInterest: integer("open_interest").notNull(),
    pctLong: doublePrecision("pct_long").notNull(),
    pctShort: doublePrecision("pct_short").notNull(),
    netWeeklyChange: integer("net_weekly_change").notNull(),
    percentile1y: integer("percentile_1y"),
    percentile3y: integer("percentile_3y"),
    direction: varchar("direction", { length: 16 }).notNull(), // "Bullish" | "Bearish" | "Neutral"
    strength: varchar("strength", { length: 16 }).notNull(), // "Extreme" | "Strong" | "Moderate" | "Light"
    provider: varchar("provider", { length: 32 }).notNull().default("cftc"),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("institutional_positioning_symbol_class_date").on(t.symbol, t.classification, t.reportDate)]
);

// ---- Retail sentiment — append-only snapshots so 24h/7d change is computable from history ----
export const retailSentiment = pgTable(
  "retail_sentiment",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    pctLong: doublePrecision("pct_long").notNull(),
    pctShort: doublePrecision("pct_short").notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("ig"),
    source: text("source").notNull().default("IG Client Sentiment"),
    status: varchar("status", { length: 16 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("retail_sentiment_symbol_fetched").on(t.symbol, t.fetchedAt)]
);

// ---- FRED macro observations — one row per country/indicator/date ----
export const economicIndicators = pgTable(
  "economic_indicators",
  {
    id: serial("id").primaryKey(),
    country: varchar("country", { length: 8 }).notNull(), // ISO-ish country code, e.g. "US", "EU", "GB"
    indicator: varchar("indicator", { length: 32 }).notNull(), // FredIndicatorKey, e.g. "cpi", "unemploymentRate"
    seriesId: varchar("series_id", { length: 32 }).notNull(), // FRED series ID actually used
    date: timestamp("date", { withTimezone: true }).notNull(),
    value: doublePrecision("value").notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("fred"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("economic_indicators_country_indicator_date").on(t.country, t.indicator, t.date)]
);

// ---- Economic calendar events ----
export const economicEvents = pgTable(
  "economic_events",
  {
    id: serial("id").primaryKey(),
    externalId: varchar("external_id", { length: 128 }).notNull().unique(),
    country: varchar("country", { length: 64 }).notNull(),
    event: text("event").notNull(),
    dateTime: timestamp("date_time", { withTimezone: true }).notNull(),
    impact: varchar("impact", { length: 8 }), // "Low" | "Medium" | "High" | null
    actual: doublePrecision("actual"),
    previous: doublePrecision("previous"),
    forecast: doublePrecision("forecast"),
    affectedMarkets: jsonb("affected_markets").$type<string[]>().notNull().default([]),
    provider: varchar("provider", { length: 32 }).notNull().default("fmp"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("economic_events_date_time").on(t.dateTime)]
);

// ---- News articles + analysis ----
export const newsArticles = pgTable(
  "news_articles",
  {
    id: serial("id").primaryKey(),
    headline: text("headline").notNull(),
    source: varchar("source", { length: 128 }).notNull(),
    url: text("url").notNull().unique(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    affectedMarkets: jsonb("affected_markets").$type<string[]>().notNull().default([]),
    interpretation: varchar("interpretation", { length: 16 }).notNull(), // "Bullish" | "Bearish" | "Mixed" | "Neutral" | "Unclear"
    importance: integer("importance").notNull(), // 0-100
    confidence: integer("confidence").notNull(), // 0-100
    urgency: integer("urgency"),
    reason: text("reason").notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("fmp"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("news_articles_published_at").on(t.publishedAt)]
);

// ---- Per-factor score history, append-only — the "what changed" record ----
export const factorScores = pgTable(
  "factor_scores",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    factorKey: varchar("factor_key", { length: 32 }).notNull(), // matches ScoreFactorKey
    rawScore: doublePrecision("raw_score").notNull(),
    weight: doublePrecision("weight").notNull(),
    weightedScore: doublePrecision("weighted_score").notNull(), // = contribution
    explanation: text("explanation").notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    source: text("source").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    nextExpectedUpdate: timestamp("next_expected_update", { withTimezone: true }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("factor_scores_symbol_factor_computed").on(t.symbol, t.factorKey, t.computedAt)]
);

// ---- Total market score history, append-only — never overwritten ----
export const marketScores = pgTable(
  "market_scores",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    totalScore: doublePrecision("total_score").notNull(),
    bias: varchar("bias", { length: 16 }).notNull(),
    confidence: integer("confidence").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("market_scores_symbol_computed").on(t.symbol, t.computedAt)]
);

// ---- Provider health — current state per provider, upserted on every check ----
export const providerHealth = pgTable("provider_health", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 32 }).notNull().unique(),
  status: varchar("status", { length: 16 }).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
  marketsCovered: integer("markets_covered").notNull().default(0),
  latencyMs: integer("latency_ms"),
  requestsToday: integer("requests_today").notNull().default(0),
  requestsDayResetAt: timestamp("requests_day_reset_at", { withTimezone: true }).notNull().defaultNow(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Simple flag so a scheduled job can tell "did anything meaningful
// change since the last score computation" without recomputing everything ----
export const dataModeAudit = pgTable("data_mode_audit", {
  id: serial("id").primaryKey(),
  mode: varchar("mode", { length: 16 }).notNull(),
  note: text("note"),
  isLiveVerified: boolean("is_live_verified").notNull().default(false),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});
