CREATE TABLE "economic_release_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"release_key" varchar(160) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"country" varchar(8) NOT NULL,
	"indicator_key" varchar(40) NOT NULL,
	"raw_event" text NOT NULL,
	"importance_tier" varchar(8) NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"state" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"forecast" double precision,
	"previous" double precision,
	"actual" double precision,
	"revised_previous" double precision,
	"first_detected_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_revised_at" timestamp with time zone,
	"surprise_id" integer,
	"affected_markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economic_release_tracking_release_key_unique" UNIQUE("release_key")
);
--> statement-breakpoint
CREATE TABLE "economic_watch_diagnostics" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(24) NOT NULL,
	"release_key" varchar(160),
	"raw_event" text,
	"country" varchar(8),
	"detail" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "economic_release_surprises" ADD COLUMN "release_key" varchar(160);--> statement-breakpoint
ALTER TABLE "economic_release_tracking" ADD CONSTRAINT "economic_release_tracking_surprise_id_economic_release_surprises_id_fk" FOREIGN KEY ("surprise_id") REFERENCES "public"."economic_release_surprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "economic_release_tracking_state" ON "economic_release_tracking" USING btree ("state");--> statement-breakpoint
CREATE INDEX "economic_release_tracking_scheduled" ON "economic_release_tracking" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "economic_release_tracking_indicator_country" ON "economic_release_tracking" USING btree ("indicator_key","country");--> statement-breakpoint
CREATE INDEX "economic_watch_diagnostics_kind_occurred" ON "economic_watch_diagnostics" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "economic_release_surprises_release_key" ON "economic_release_surprises" USING btree ("release_key");