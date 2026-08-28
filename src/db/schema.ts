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
    // ---- Scoring V2 additions (nullable — backfilled going forward only,
    // never backfilled for old rows; the existing /economic-calendar page
    // and V1 scoring are unaffected by these being null). See
    // services/economic-calendar/indicator-taxonomy.ts for indicatorKey/
    // importanceTier derivation — indicatorKey is null when the free-text
    // `event` string didn't match any known taxonomy entry (never guessed).
    indicatorKey: varchar("indicator_key", { length: 40 }),
    revisedPrevious: doublePrecision("revised_previous"),
    importanceTier: varchar("importance_tier", { length: 8 }), // "HIGH" | "MEDIUM" | "LOW" | null
    // ---- Email/Zapier ingestion additions (nullable — never backfilled
    // for old FMP-sourced rows). Raw strings preserve exactly what the
    // source sent ("3.2%", "320K", "-15K") alongside the already-existing
    // parsed numeric columns above, so a normalization bug is visibly
    // diagnosable instead of silently lossy. See lib/normalization/
    // numeric-string.ts.
    actualRaw: varchar("actual_raw", { length: 32 }),
    previousRaw: varchar("previous_raw", { length: 32 }),
    forecastRaw: varchar("forecast_raw", { length: 32 }),
    revisedPreviousRaw: varchar("revised_previous_raw", { length: 32 }),
    // Broader DISPLAY-only categorizer (10 buckets) for the Calendar/Admin
    // UI — deliberately separate from indicator-taxonomy.ts's 4-bucket
    // indicatorCategory(), which feeds V2's scoring dispatch and must
    // never change as part of this migration. See
    // services/economic-calendar/display-category.ts.
    category: varchar("category", { length: 24 }),
    // "classified" once indicatorKey resolved, "unclassified" otherwise —
    // an event with no taxonomy match is still stored (visible in
    // Calendar/Admin) but never surprise-scored.
    processingStatus: varchar("processing_status", { length: 16 }).notNull().default("unclassified"),
    // Set only on first insert (excluded from the upsert's conflict-update
    // set) so it survives revisions as the true first-seen time, distinct
    // from fetchedAt (last-write time).
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (t) => [
    index("economic_events_date_time").on(t.dateTime),
    // Backs getLatestEconomicEventByIndicator (db/queries/market-data.ts) —
    // the market scorecard's Economic Growth/Inflation/Jobs Market rows run
    // this on every market-detail page render (force-dynamic), so a plain
    // date_time index alone would mean a full-table scan filtered by
    // country+indicatorKey on every visit.
    index("economic_events_country_indicator_datetime").on(t.country, t.indicatorKey, t.dateTime),
    // Backs the Admin Incoming Data page's most-recent-first listing.
    index("economic_events_received_at").on(t.receivedAt),
  ]
);

// ---- News articles + analysis ----
export const newsArticles = pgTable(
  "news_articles",
  {
    id: serial("id").primaryKey(),
    headline: text("headline").notNull(),
    source: varchar("source", { length: 128 }).notNull(),
    // Nullable now — email-forwarded news (Zapier/Forex Factory) often has
    // no canonical URL. Postgres allows multiple NULLs under UNIQUE, so
    // real URLs still dedupe exactly as before; dedupKey below is the
    // real dedup mechanism for URL-less rows.
    url: text("url").unique(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    affectedMarkets: jsonb("affected_markets").$type<string[]>().notNull().default([]),
    interpretation: varchar("interpretation", { length: 16 }).notNull(), // "Bullish" | "Bearish" | "Mixed" | "Neutral" | "Unclear"
    importance: integer("importance").notNull(), // 0-100
    confidence: integer("confidence").notNull(), // 0-100
    urgency: integer("urgency"),
    reason: text("reason").notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("fmp"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    // ---- Email/Zapier ingestion additions (nullable — never backfilled
    // for legacy FMP rows) ----
    // url ?? sha256(normalizedHeadline+source+publishedAt-rounded-to-minute)
    // — see lib/normalization/dedup-key.ts. The real dedup key once url
    // may be absent.
    dedupKey: varchar("dedup_key", { length: 160 }).unique(),
    geopoliticalRelevance: integer("geopolitical_relevance"), // 0-100, null = not LLM-classified
    monetaryPolicyRelevance: integer("monetary_policy_relevance"), // 0-100
    riskSentiment: varchar("risk_sentiment", { length: 16 }), // "RiskOn" | "RiskOff" | "Neutral" | null
    // "war" | "sanctions" | "tariffs" | "election" | "energy" |
    // "central_bank" | "other" | null (not LLM-classified / keyword
    // fallback ran) — feeds the Geopolitical Risk Tracker's sub-scores
    // (see lib/pipeline/geopolitical-risk.ts). Same LLM call as the other
    // classification fields, just a richer structured output — never a
    // second classification pass.
    riskCategory: varchar("risk_category", { length: 16 }),
    // Which classifier actually produced interpretation/importance/
    // confidence for this row — null means the legacy keyword heuristic
    // (news-classifier.ts) ran, not the LLM. Auditable if the model/prompt
    // version ever changes.
    classifierModel: varchar("classifier_model", { length: 64 }),
  },
  (t) => [index("news_articles_published_at").on(t.publishedAt)]
);

// ---- Zapier ingestion audit log — one row per inbound call, including
// rejected/invalid ones, so the email/Zapier integration is fully
// traceable from the Admin "Incoming Data" page without needing to read
// server logs. Never the source of truth for economic_events/newsArticles
// themselves — those tables stay authoritative; this is provenance only.
export const zapierIngestLog = pgTable(
  "zapier_ingest_log",
  {
    id: serial("id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payloadType: varchar("payload_type", { length: 16 }).notNull(), // "economic_event" | "news" | "unknown"
    // Which entry point actually submitted this — "manual" (Admin data-entry
    // form) or "zapier" (the email/Zapier webhook). Both channels call the
    // same canonical ingestion functions (src/lib/ingestion/); this column
    // is provenance only, never used for dedup (see release-identity.ts's
    // channel-agnostic provider namespace).
    channel: varchar("channel", { length: 16 }).notNull().default("zapier"),
    rawPayload: jsonb("raw_payload").notNull(), // exact, unmodified body Zapier sent
    dedupKey: varchar("dedup_key", { length: 160 }), // releaseKey or news dedupKey; null if validation failed first
    outcome: varchar("outcome", { length: 24 }).notNull(),
    // "accepted_new" | "accepted_duplicate" | "accepted_revision" |
    // "accepted_unclassified" | "rejected_invalid_payload" |
    // "rejected_unauthorized" | "rejected_rate_limited" | "dry_run" | "error"
    economicEventId: integer("economic_event_id").references(() => economicEvents.id),
    newsArticleId: integer("news_article_id").references(() => newsArticles.id),
    recomputedMarkets: jsonb("recomputed_markets").$type<string[]>().notNull().default([]),
    errorDetail: text("error_detail"),
    // Which classifier produced a news row's interpretation — "claude-opus-5"
    // (or whichever model ran) for the AI path, null for the deterministic
    // keyword fallback (news-classifier.ts) or for non-news rows. Lets the
    // Admin Incoming Data page show "AI" vs "Rules" without joining to
    // news_articles — same "log carries everything the page needs" design
    // as every other column here.
    classifierModel: varchar("classifier_model", { length: 64 }),
  },
  (t) => [
    index("zapier_ingest_log_received_at").on(t.receivedAt),
    index("zapier_ingest_log_outcome").on(t.outcome),
    index("zapier_ingest_log_dedup_key").on(t.dedupKey),
  ]
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
  // Scoring V2's full behavior-tuning config (event-shock max/decay,
  // minimum confidence for an extreme label, hysteresis entry/exit per
  // bias, factor-family caps, smoothing coefficients) — versioned in the
  // SAME row as the v1 weights/thresholds above so one "Save & Version"
  // saves the complete scoring model (see lib/scoring-v2/config.ts for the
  // domain type this (de)serializes to/from). Null on every row saved
  // before V2 existed and on the bootstrap default — V2 falls back to its
  // own hardcoded defaults exactly like v1 already does for weights/
  // thresholds via lib/config.ts's DEFAULT_FACTOR_WEIGHTS.
  v2Settings: jsonb("v2_settings").$type<{
    eventShock: { maxContribution: number; decayHalfLifeHoursByTier: { HIGH: number; MEDIUM: number; LOW: number } };
    minConfidenceForExtreme: number;
    hysteresis: { bias: string; enter: number; exit: number }[];
    familyCaps: { family: string; maxContribution: number }[];
    smoothingAlpha: number;
    smoothingAlphaHighImpact: number;
  } | null>(),
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

// Rate-limiting for signin/signup (Phase 14 security audit) — a real DB
// table rather than an in-memory counter because this app runs on
// serverless (Vercel) instances with no shared in-process memory across
// requests; an in-memory limiter would silently do nothing under real
// traffic. One row per attempt (success or failure — the point is
// request VOLUME, not outcome); db/queries/rate-limit.ts counts rows
// within a window and prunes old ones on write so this table stays
// bounded without a separate cleanup job.
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: serial("id").primaryKey(),
    identifier: varchar("identifier", { length: 64 }).notNull(), // client IP (x-forwarded-for), or "unknown" if absent
    action: varchar("action", { length: 16 }).notNull(), // "signin" | "signup"
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_attempts_identifier_action_idx").on(t.identifier, t.action, t.attemptedAt)]
);

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

// =========================================================================
// ---- Scoring Engine V2 (shadow mode) -----------------------------------
// Everything below is part of "Scoring Engine V2" — an event-driven,
// asset-specific model computed ALONGSIDE the existing engine above, never
// replacing it. No user-facing page reads any table below; only
// /admin/scoring-v2 does. V1's tables above are never written to by V2 —
// see lib/scoring-v2/* for the engine itself.
// =========================================================================

// One row per normalized economic release — the rolling history
// lib/scoring-v2/economic-surprise.ts reads to compute each indicator's own
// historical mean/stdev for surpriseZ (bootstraps empty per indicator and
// improves honestly over time, same "thin sample -> low confidence"
// precedent as pipeline/types.ts's seasonalityDepthFreshness).
export const economicReleaseSurprises = pgTable(
  "economic_release_surprises",
  {
    id: serial("id").primaryKey(),
    indicatorKey: varchar("indicator_key", { length: 40 }).notNull(), // EconomicIndicatorKey
    country: varchar("country", { length: 8 }).notNull(),
    releaseDateTime: timestamp("release_date_time", { withTimezone: true }).notNull(),
    actual: doublePrecision("actual").notNull(),
    forecast: doublePrecision("forecast"),
    previous: doublePrecision("previous"),
    revisedPrevious: doublePrecision("revised_previous"),
    surprise: doublePrecision("surprise"), // null when no forecast exists to compare against
    surpriseZ: doublePrecision("surprise_z"), // null until enough per-indicator history exists to normalize
    effectiveSurprise: doublePrecision("effective_surprise"), // revision-adjusted (see economic-surprise.ts)
    importanceTier: varchar("importance_tier", { length: 8 }).notNull(), // "HIGH" | "MEDIUM" | "LOW"
    eventExternalId: varchar("event_external_id", { length: 128 }), // best-effort join back to economicEvents.externalId for display only — NOT the dedup key (see releaseKey)
    // The real, order-independent dedup identity (services/economic-calendar/
    // release-identity.ts: `${provider}:${country}:${indicatorKey}:${releaseDateTimeISO}`).
    // eventExternalId alone is unsafe at 5-minute polling cadence because
    // FMP's raw id is derived from that response's array index, which can
    // shift between calls. Nullable only so a pre-migration row (none exist
    // in any real deploy yet) wouldn't violate the unique constraint.
    releaseKey: varchar("release_key", { length: 160 }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("economic_release_surprises_indicator_release").on(t.indicatorKey, t.releaseDateTime), uniqueIndex("economic_release_surprises_release_key").on(t.releaseKey)]
);

// The release lifecycle (requirement #3): scheduled -> released -> processed
// -> revised. Unlike economicReleaseSurprises (which can only exist once
// `actual` is known), this row is created the moment a release first
// appears on the calendar — even before it's out — so latency
// (scheduledAt vs firstDetectedAt) and provider-quality diagnostics can be
// measured. Keyed by the same releaseKey identity as economicReleaseSurprises.
export const economicReleaseTracking = pgTable(
  "economic_release_tracking",
  {
    id: serial("id").primaryKey(),
    releaseKey: varchar("release_key", { length: 160 }).notNull().unique(),
    provider: varchar("provider", { length: 32 }).notNull(),
    country: varchar("country", { length: 8 }).notNull(),
    indicatorKey: varchar("indicator_key", { length: 40 }).notNull(),
    rawEvent: text("raw_event").notNull(), // the provider's free-text event name, for admin drill-down/debugging
    importanceTier: varchar("importance_tier", { length: 8 }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    state: varchar("state", { length: 16 }).notNull().default("scheduled"), // "scheduled" | "released" | "processed" | "revised"
    forecast: doublePrecision("forecast"),
    previous: doublePrecision("previous"),
    actual: doublePrecision("actual"),
    revisedPrevious: doublePrecision("revised_previous"),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }), // when a watcher run first saw `actual` become non-null
    processedAt: timestamp("processed_at", { withTimezone: true }), // when surprise+shock+targeted recompute completed for this release
    lastRevisedAt: timestamp("last_revised_at", { withTimezone: true }), // when actual/revisedPrevious changed after already being processed
    surpriseId: integer("surprise_id").references(() => economicReleaseSurprises.id),
    affectedMarkets: jsonb("affected_markets").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("economic_release_tracking_state").on(t.state), index("economic_release_tracking_scheduled").on(t.scheduledAt), index("economic_release_tracking_indicator_country").on(t.indicatorKey, t.country)]
);

// Append-only provider-quality anomaly log (requirement #10) — separate
// from providerHealth (which tracks up/down per data source) since these
// are per-RELEASE quality signals: a release with no forecast, a release
// whose free-text name didn't classify, a release that appeared to repeat.
export const economicWatchDiagnostics = pgTable(
  "economic_watch_diagnostics",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 24 }).notNull(), // "missing_forecast" | "missing_actual" | "duplicate_event" | "normalization_failure" | "missing_revision"
    releaseKey: varchar("release_key", { length: 160 }),
    rawEvent: text("raw_event"),
    country: varchar("country", { length: 8 }),
    detail: text("detail"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("economic_watch_diagnostics_kind_occurred").on(t.kind, t.occurredAt)]
);

// A temporary score boost/drag from a single economic release. Nothing
// decays in storage — event-shock.ts's decayedContribution(initial,
// hoursElapsed, tier) is a pure function recomputed fresh on every V2 run,
// since Vercel functions are stateless between invocations and decay must
// be derivable from a stored timestamp alone, never an in-memory timer.
export const eventShocks = pgTable(
  "event_shocks",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    factorKey: varchar("factor_key", { length: 32 }), // null = applies to the total score directly
    sourceReleaseId: integer("source_release_id").references(() => economicReleaseSurprises.id),
    initialContribution: doublePrecision("initial_contribution").notNull(),
    importanceTier: varchar("importance_tier", { length: 8 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_shocks_symbol_occurred").on(t.symbol, t.occurredAt)]
);

// V2's own current/history score tables — exact structural mirrors of
// current_market_scores/current_factor_scores/market_scores/factor_scores
// above, kept completely separate so V2 can never leak into a V1 read via a
// missed filter, and so the whole experiment is trivially reversible (drop
// these tables, V1 is untouched).
export const currentMarketScoresV2 = pgTable("current_market_scores_v2", {
  symbol: varchar("symbol", { length: 16 }).primaryKey(),
  totalScore: doublePrecision("total_score").notNull(), // smoothed + hysteresis-classified, the "public" V2 number
  rawScore: doublePrecision("raw_score").notNull(), // pre-smoothing — kept for Admin/debugging per requirement #16
  bias: varchar("bias", { length: 16 }).notNull(),
  confidence: integer("confidence").notNull(),
  change24h: doublePrecision("change_24h").notNull(),
  scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const currentFactorScoresV2 = pgTable(
  "current_factor_scores_v2",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    factorKey: varchar("factor_key", { length: 32 }).notNull(),
    rawScore: doublePrecision("raw_score").notNull(),
    weight: doublePrecision("weight").notNull(),
    weightedScore: doublePrecision("weighted_score").notNull(),
    explanation: text("explanation").notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    source: text("source").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    nextExpectedUpdate: timestamp("next_expected_update", { withTimezone: true }),
    scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("current_factor_scores_v2_symbol_factor").on(t.symbol, t.factorKey)]
);

export const marketScoresV2 = pgTable(
  "market_scores_v2",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    totalScore: doublePrecision("total_score").notNull(),
    bias: varchar("bias", { length: 16 }).notNull(),
    confidence: integer("confidence").notNull(),
    scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("market_scores_v2_symbol_computed").on(t.symbol, t.computedAt)]
);

export const factorScoresV2 = pgTable(
  "factor_scores_v2",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    factorKey: varchar("factor_key", { length: 32 }).notNull(),
    rawScore: doublePrecision("raw_score").notNull(),
    weight: doublePrecision("weight").notNull(),
    weightedScore: doublePrecision("weighted_score").notNull(),
    explanation: text("explanation").notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    source: text("source").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    nextExpectedUpdate: timestamp("next_expected_update", { withTimezone: true }),
    scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("factor_scores_v2_symbol_factor_computed").on(t.symbol, t.factorKey, t.computedAt)]
);

// Point-in-time V1-vs-V2 pairing — requirement #25's "for several weeks
// store: V1 score, V2 score, ..., confidence". Read by the Admin
// /admin/scoring-v2 comparison page; "future returns" (also requested by
// #25) are joined against market_candles at read time rather than
// duplicated here.
export const scoringShadowComparisons = pgTable(
  "scoring_shadow_comparisons",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    v1Score: doublePrecision("v1_score").notNull(),
    v1Bias: varchar("v1_bias", { length: 16 }).notNull(),
    v1Confidence: integer("v1_confidence").notNull(),
    v2Score: doublePrecision("v2_score").notNull(),
    v2Bias: varchar("v2_bias", { length: 16 }).notNull(),
    v2Confidence: integer("v2_confidence").notNull(),
    triggerReleaseId: integer("trigger_release_id").references(() => economicReleaseSurprises.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scoring_shadow_comparisons_symbol_computed").on(t.symbol, t.computedAt)]
);

// Written whenever lib/scoring-v2/integrity.ts rejects a computation before
// publish (requirement #19) — the previous canonical current_market_
// scores_v2 row is left untouched; this is purely a visibility/debugging
// record surfaced in Admin.
export const scoringIntegrityErrors = pgTable(
  "scoring_integrity_errors",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    errors: jsonb("errors").$type<string[]>().notNull(),
    scoringVersionId: integer("scoring_version_id").references(() => scoringConfigurations.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scoring_integrity_errors_symbol_computed").on(t.symbol, t.computedAt)]
);
