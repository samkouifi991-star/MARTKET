CREATE TABLE "data_mode_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" varchar(16) NOT NULL,
	"note" text,
	"is_live_verified" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"country" varchar(64) NOT NULL,
	"event" text NOT NULL,
	"date_time" timestamp with time zone NOT NULL,
	"impact" varchar(8),
	"actual" double precision,
	"previous" double precision,
	"forecast" double precision,
	"affected_markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" varchar(32) DEFAULT 'fmp' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economic_events_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "economic_indicators" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" varchar(8) NOT NULL,
	"indicator" varchar(32) NOT NULL,
	"series_id" varchar(32) NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"provider" varchar(32) DEFAULT 'fred' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factor_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"factor_key" varchar(32) NOT NULL,
	"raw_score" double precision NOT NULL,
	"weight" double precision NOT NULL,
	"weighted_score" double precision NOT NULL,
	"explanation" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"source" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"source_updated_at" timestamp with time zone,
	"next_expected_update" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_positioning" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"classification" varchar(32) NOT NULL,
	"report_date" timestamp with time zone NOT NULL,
	"long_contracts" integer NOT NULL,
	"short_contracts" integer NOT NULL,
	"net_positioning" integer NOT NULL,
	"open_interest" integer NOT NULL,
	"pct_long" double precision NOT NULL,
	"pct_short" double precision NOT NULL,
	"net_weekly_change" integer NOT NULL,
	"percentile_1y" integer,
	"percentile_3y" integer,
	"direction" varchar(16) NOT NULL,
	"strength" varchar(16) NOT NULL,
	"provider" varchar(32) DEFAULT 'cftc' NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_candles" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"timeframe" varchar(8) NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision,
	"provider" varchar(32) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"price" double precision NOT NULL,
	"change_pct_24h" double precision NOT NULL,
	"provider" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_prices_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "market_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"total_score" double precision NOT NULL,
	"bias" varchar(16) NOT NULL,
	"confidence" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"headline" text NOT NULL,
	"source" varchar(128) NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"affected_markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interpretation" varchar(16) NOT NULL,
	"importance" integer NOT NULL,
	"confidence" integer NOT NULL,
	"urgency" integer,
	"reason" text NOT NULL,
	"provider" varchar(32) DEFAULT 'fmp' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_articles_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "provider_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"markets_covered" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"requests_today" integer DEFAULT 0 NOT NULL,
	"requests_day_reset_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_health_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "retail_sentiment" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"pct_long" double precision NOT NULL,
	"pct_short" double precision NOT NULL,
	"provider" varchar(32) DEFAULT 'ig' NOT NULL,
	"source" text DEFAULT 'IG Client Sentiment' NOT NULL,
	"status" varchar(16) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "economic_events_date_time" ON "economic_events" USING btree ("date_time");--> statement-breakpoint
CREATE UNIQUE INDEX "economic_indicators_country_indicator_date" ON "economic_indicators" USING btree ("country","indicator","date");--> statement-breakpoint
CREATE INDEX "factor_scores_symbol_factor_computed" ON "factor_scores" USING btree ("symbol","factor_key","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "institutional_positioning_symbol_class_date" ON "institutional_positioning" USING btree ("symbol","classification","report_date");--> statement-breakpoint
CREATE UNIQUE INDEX "market_candles_symbol_tf_date" ON "market_candles" USING btree ("symbol","timeframe","date");--> statement-breakpoint
CREATE INDEX "market_scores_symbol_computed" ON "market_scores" USING btree ("symbol","computed_at");--> statement-breakpoint
CREATE INDEX "news_articles_published_at" ON "news_articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "retail_sentiment_symbol_fetched" ON "retail_sentiment" USING btree ("symbol","fetched_at");