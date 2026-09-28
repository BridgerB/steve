CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`race_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`ts` text NOT NULL,
	`category` text NOT NULL,
	`event` text NOT NULL,
	`detail` text,
	`x` real,
	`y` real,
	`z` real,
	`yaw` real,
	`pitch` real
);
--> statement-breakpoint
CREATE INDEX `idx_events_race` ON `events` (`race_id`);--> statement-breakpoint
CREATE INDEX `idx_events_cat` ON `events` (`category`);--> statement-breakpoint
CREATE INDEX `idx_events_bot` ON `events` (`bot_id`);--> statement-breakpoint
CREATE TABLE `inventory_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`race_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`ts` text NOT NULL,
	`slot` integer NOT NULL,
	`item_name` text NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inv_race_bot` ON `inventory_snapshots` (`race_id`,`bot_id`);--> statement-breakpoint
CREATE INDEX `idx_inv_bot` ON `inventory_snapshots` (`bot_id`);--> statement-breakpoint
CREATE TABLE `races` (
	`race_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`bot_count` integer DEFAULT 1 NOT NULL,
	`timeout_sec` integer,
	`goal` text
);
--> statement-breakpoint
CREATE TABLE `ticks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`race_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`ts` text NOT NULL,
	`x` real,
	`y` real,
	`z` real,
	`yaw` real,
	`pitch` real,
	`health` real,
	`food` integer,
	`dimension` text,
	`block_below` text,
	`block_at_cursor` text,
	`is_in_water` integer,
	`on_ground` integer
);
--> statement-breakpoint
CREATE INDEX `idx_ticks_race_bot` ON `ticks` (`race_id`,`bot_id`);