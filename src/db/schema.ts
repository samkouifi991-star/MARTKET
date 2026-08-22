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
    // The provider's own timestamp for this observation (e.g. OANDA
    // PositionBook's `time`) — distinct from fetchedAt (when WE wrote this
    // row). Freshness must be computed from this, not fetchedAt: a row read
    // back from storage isn't "less fresh" just because it came from Neon,
    // and a row written a second ago isn't fresh if the underlying
    // observation it carries is actually old. Nullable because IG/Myfxbook
    // don't return a genuine per-symbol timestamp (their providers set this
    // to the fetch time itself, an honest "this is a live snapshot, we have
    // no better timestamp" approximation) and because rows written before
    // this column existed have none.
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
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

// ---- Scoring configuration versions — the single source of truth for
// factor weights and bias thresholds. Admin's "Save & version" inserts a
// new row and flips it active; every other row's `active` is set false in
// the same request (app-level, not a DB constraint — matches this
// project's existing convention of no explicit transactions for simple
// sequential writes). The scoring engine reads the active row instead of
// the hardcoded DEFAULT_FACTOR_WEIGHTS/DEFAULT_BIAS_THRESHOLDS in
// lib/config.ts, which now serve only as the bootstrap fallback for before
// any configuration has ever been saved. ----
export const scoringConfigurations = pgTable("scoring_configurations", {
  id: serial("id").primaryKey(),
  active: boolean("active").notNull().default(false),
  weights: jsonb("weights").notNull().$type<Record<string, number>>(),
  // min is `number | "-Infinity"` on disk — jsonb can't hold a real
  // -Infinity (JSON.stringify coerces it to null), so the "Very Bearish"
  // floor threshold is stored as the literal string marker instead; see
  // db/queries/scoring-config.ts's (de)serializeThresholds.
  biasThresholds: jsonb("bias_thresholds").notNull().$type<{ bias: string; min: number | string }[]>(),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    // Nullable — rows written before this column existed have no recorded
    // version. Which scoring-configuration version produced this row.
    scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
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
    scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("market_scores_symbol_computed").on(t.symbol, t.computedAt)]
);

// ---- Current market score — one row per symbol, upserted on every real
// computation (a Market Detail render or the scores cron), never
// append-only. This is the single canonical "current score" record: Top
// Setups reads it directly instead of recomputing independently, so the
// two pages can never show two different numbers for the same market —
// they're reading the same row. Distinct from market_scores/factor_scores
// above, which stay a genuine append-only history (the 30-day chart's
// source), never used as a stand-in for "the current score". ----
export const currentMarketScores = pgTable("current_market_scores", {
  symbol: varchar("symbol", { length: 16 }).primaryKey(),
  totalScore: doublePrecision("total_score").notNull(),
  bias: varchar("bias", { length: 16 }).notNull(),
  confidence: integer("confidence").notNull(),
  change24h: doublePrecision("change_24h").notNull(),
  scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Current per-factor score — one row per symbol/factor, upserted alongside
// current_market_scores above; the factor-level half of the same "current"
// record (parallels factor_scores/market_scores' history-vs-total split) ----
export const currentFactorScores = pgTable(
  "current_factor_scores",
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
    scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("current_factor_scores_symbol_factor").on(t.symbol, t.factorKey)]
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

// ---- Accounts + billing. This is the only place password hashes and
// Stripe identifiers are stored — never raw card data (Stripe Checkout
// handles card entry; only Stripe customer/subscription IDs land here). ----
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Database-backed sessions (not pure stateless JWT) so a session can be
// revoked (logout, password change) without waiting for token expiry — the
// signed cookie only carries this row's id, per Next.js's own recommended
// "Database Sessions" pattern (see node_modules/next/dist/docs/01-app/
// 02-guides/authentication.md).
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // random opaque token, not auto-increment — unguessable
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per user — Stripe webhooks are the sole writer of status/period
// fields (see app/api/webhooks/stripe/route.ts); this table is the app's
// local cache of Stripe's billing state, read by the entitlement guard on
// every protected-page render. status mirrors Stripe's own subscription
// status vocabulary verbatim (trialing/active/canceled/past_due/unpaid/
// incomplete/incomplete_expired) rather than inventing a parallel one.
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  status: varchar("status", { length: 32 }).notNull().default("incomplete"),
  priceId: varchar("price_id", { length: 255 }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
