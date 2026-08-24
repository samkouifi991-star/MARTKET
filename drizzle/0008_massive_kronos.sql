CREATE TABLE "auth_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" varchar(64) NOT NULL,
	"action" varchar(16) NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_attempts_identifier_action_idx" ON "auth_attempts" USING btree ("identifier","action","attempted_at");