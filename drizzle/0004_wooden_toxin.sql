CREATE TABLE "scoring_configurations" (
	"id" serial PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"weights" jsonb NOT NULL,
	"bias_thresholds" jsonb NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "current_factor_scores" ADD COLUMN "scoring_version_id" integer;--> statement-breakpoint
ALTER TABLE "current_market_scores" ADD COLUMN "scoring_version_id" integer;--> statement-breakpoint
ALTER TABLE "factor_scores" ADD COLUMN "scoring_version_id" integer;--> statement-breakpoint
ALTER TABLE "market_scores" ADD COLUMN "scoring_version_id" integer;--> statement-breakpoint
ALTER TABLE "current_factor_scores" ADD CONSTRAINT "current_factor_scores_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_market_scores" ADD CONSTRAINT "current_market_scores_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factor_scores" ADD CONSTRAINT "factor_scores_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_scores" ADD CONSTRAINT "market_scores_scoring_version_id_scoring_configurations_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_configurations"("id") ON DELETE no action ON UPDATE no action;