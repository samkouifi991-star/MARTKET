CREATE TABLE "zapier_ingest_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_type" varchar(16) NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"dedup_key" varchar(160),
	"outcome" varchar(24) NOT NULL,
	"economic_event_id" integer,
	"news_article_id" integer,
	"recomputed_markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_detail" text
);
--> statement-breakpoint
ALTER TABLE "news_articles" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "actual_raw" varchar(32);--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "previous_raw" varchar(32);--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "forecast_raw" varchar(32);--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "revised_previous_raw" varchar(32);--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "category" varchar(24);--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "processing_status" varchar(16) DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "economic_events" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN "dedup_key" varchar(160);--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN "geopolitical_relevance" integer;--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN "monetary_policy_relevance" integer;--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN "risk_sentiment" varchar(16);--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN "classifier_model" varchar(64);--> statement-breakpoint
ALTER TABLE "zapier_ingest_log" ADD CONSTRAINT "zapier_ingest_log_economic_event_id_economic_events_id_fk" FOREIGN KEY ("economic_event_id") REFERENCES "public"."economic_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zapier_ingest_log" ADD CONSTRAINT "zapier_ingest_log_news_article_id_news_articles_id_fk" FOREIGN KEY ("news_article_id") REFERENCES "public"."news_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zapier_ingest_log_received_at" ON "zapier_ingest_log" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "zapier_ingest_log_outcome" ON "zapier_ingest_log" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "zapier_ingest_log_dedup_key" ON "zapier_ingest_log" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "economic_events_received_at" ON "economic_events" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_dedup_key_unique" UNIQUE("dedup_key");