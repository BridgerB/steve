CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"race_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"ts" text NOT NULL,
	"category" text NOT NULL,
	"event" text NOT NULL,
	"detail" text,
	"x" double precision,
	"y" double precision,
	"z" double precision
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"race_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"ts" text NOT NULL,
	"slot" integer NOT NULL,
	"item_name" text NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"race_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"started_at" text NOT NULL,
	"bot_count" integer DEFAULT 1 NOT NULL,
	"timeout_sec" integer,
	"goal" text
);
--> statement-breakpoint
CREATE TABLE "ticks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"race_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"ts" text NOT NULL,
	"x" double precision,
	"y" double precision,
	"z" double precision,
	"yaw" double precision,
	"pitch" double precision,
	"health" double precision,
	"food" integer,
	"dimension" text,
	"block_below" text,
	"block_at_cursor" text,
	"is_in_water" integer,
	"on_ground" integer
);
--> statement-breakpoint
CREATE INDEX "idx_events_race" ON "events" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "idx_events_cat" ON "events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_events_bot" ON "events" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "idx_inv_race_bot" ON "inventory_snapshots" USING btree ("race_id","bot_id");--> statement-breakpoint
CREATE INDEX "idx_inv_bot" ON "inventory_snapshots" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "idx_ticks_race_bot" ON "ticks" USING btree ("race_id","bot_id");