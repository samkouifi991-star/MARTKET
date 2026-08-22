CREATE TABLE "current_factor_scores" (
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
CREATE TABLE "current_market_scores" (
	"symbol" varchar(16) PRIMARY KEY NOT NULL,
	"total_score" double precision NOT NULL,
	"bias" varchar(16) NOT NULL,
	"confidence" integer NOT NULL,
	"change_24h" double precision NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "current_factor_scores_symbol_factor" ON "current_factor_scores" USING btree ("symbol","factor_key");