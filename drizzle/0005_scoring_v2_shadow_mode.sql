CREATE TABLE "current_factor_scores_v2" (
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
	"scoring_version_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "current_market_scores_v2" (
	"symbol" varchar(16) PRIMARY KEY NOT NULL,
	"total_score" double precision NOT NULL,
	"raw_score" double precision NOT NULL,
	"bias" varchar(16) NOT NULL,
	"confidence" integer NOT NULL,
	"change_24h" double precision NOT NULL,
	"scoring_version_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_release_surprises" (
	"id" serial PRIMARY KEY NOT NULL,
	"indicator_key" varchar(40) NOT NULL,
	"country" varchar(8) NOT NULL,
	"release_date_time" timestamp with time zone NOT NULL,
	"actual" double precision NOT NULL,
	"forecast" double precision,
	"previous" double precision,
	"revised_previous" double precision,
	"surprise" double precision,
	"surprise_z" double precision,
	"effective_surprise" double precision,
	"importance_tier" varchar(8) NOT NULL,
	"event_external_id" varchar(128),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_shocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"factor_key" varchar(32),
	"source_release_id" integer,
	"initial_contribution" double precision NOT NULL,
	"importance_tier" varchar(8) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factor_scores_v2" (
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
	"scoring_version_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_scores_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"total_score" double precision NOT NULL,
	"bias" varchar(16) NOT NULL,
	"confidence" integer NOT NULL,
	"scoring_version_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_integrity_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"errors" jsonb NOT NULL,
	"scoring_version_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_shadow_comparisons" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"v1_score" double precision NOT NULL,
	"v1_bias" varchar(16) NOT NULL,
	"v1_confidence" integer NOT NULL,
	"v2_score" double precision NOT NULL,
	"v2_bias" varchar(16) NOT NULL,
	"v2_confidence" integer NOT NULL,
	"trigger_release_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "indicator_key" varchar(40);--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "revised_previous" double precision;--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "importance_tier" varchar(8);--> statement-breakpoint
ALTER TABLE "scoring_configurations" ADD COLUMN "v2_settings" jsonb;--> statement-breakpoint
ALTER TABLE "current_factor_scores_v2" ADD CONSTRAINT "current_factor_scores_v2_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_market_scores_v2" ADD CONSTRAINT "current_market_scores_v2_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_shocks" ADD CONSTRAINT "event_shocks_source_release_id_economic_release_surprises_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."economic_release_surprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factor_scores_v2" ADD CONSTRAINT "factor_scores_v2_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_scores_v2" ADD CONSTRAINT "market_scores_v2_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_integrity_errors" ADD CONSTRAINT "scoring_integrity_errors_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_shadow_comparisons" ADD CONSTRAINT "scoring_shadow_comparisons_trigger_release_id_economic_release_surprises_id_fk" FOREIGN KEY ("trigger_release_id") REFERENCES "public"."economic_release_surprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "current_factor_scores_v2_symbol_factor" ON "current_factor_scores_v2" USING btree ("symbol","factor_key");--> statement-breakpoint
CREATE INDEX "economic_release_surprises_indicator_release" ON "economic_release_surprises" USING btree ("indicator_key","release_date_time");--> statement-breakpoint
CREATE INDEX "event_shocks_symbol_occurred" ON "event_shocks" USING btree ("symbol","occurred_at");--> statement-breakpoint
CREATE INDEX "factor_scores_v2_symbol_factor_computed" ON "factor_scores_v2" USING btree ("symbol","factor_key","computed_at");--> statement-breakpoint
CREATE INDEX "market_scores_v2_symbol_computed" ON "market_scores_v2" USING btree ("symbol","computed_at");--> statement-breakpoint
CREATE INDEX "scoring_integrity_errors_symbol_computed" ON "scoring_integrity_errors" USING btree ("symbol","computed_at");--> statement-breakpoint
CREATE INDEX "scoring_shadow_comparisons_symbol_computed" ON "scoring_shadow_comparisons" USING btree ("symbol","computed_at");