import { integer, real, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

// One database (Cloudflare D1 / SQLite) for everything: the steve bot writes here
// (src/lib/steve/lib/logger.ts, via node:sqlite locally or the D1 HTTP API in
// prod) and the dashboard reads here (src/lib/server/race.ts, via the D1 binding).
// This schema is the single source of truth — `npm run db:generate` emits the
// SQLite DDL into ./drizzle, applied with `wrangler d1 migrations apply`.
// Timestamps are ISO-8601 TEXT (sort lexicographically); ids autoincrement.

export const races = sqliteTable('races', {
	raceId: text('race_id').primaryKey(),
	kind: text('kind').notNull(),
	startedAt: text('started_at').notNull(),
	botCount: integer('bot_count').notNull().default(1),
	timeoutSec: integer('timeout_sec'),
	goal: text('goal')
});

export const ticks = sqliteTable(
	'ticks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		raceId: text('race_id').notNull(),
		botId: text('bot_id').notNull(),
		ts: text('ts').notNull(),
		x: real('x'),
		y: real('y'),
		z: real('z'),
		yaw: real('yaw'),
		pitch: real('pitch'),
		health: real('health'),
		food: integer('food'),
		dimension: text('dimension'),
		blockBelow: text('block_below'),
		blockAtCursor: text('block_at_cursor'),
		isInWater: integer('is_in_water'),
		onGround: integer('on_ground')
	},
	(t) => [index('idx_ticks_race_bot').on(t.raceId, t.botId)]
);

export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		raceId: text('race_id').notNull(),
		botId: text('bot_id').notNull(),
		ts: text('ts').notNull(),
		category: text('category').notNull(),
		event: text('event').notNull(),
		detail: text('detail'),
		x: real('x'),
		y: real('y'),
		z: real('z'),
		yaw: real('yaw'),
		pitch: real('pitch')
	},
	(t) => [
		index('idx_events_race').on(t.raceId),
		index('idx_events_cat').on(t.category),
		index('idx_events_bot').on(t.botId)
	]
);

export const inventorySnapshots = sqliteTable(
	'inventory_snapshots',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		raceId: text('race_id').notNull(),
		botId: text('bot_id').notNull(),
		ts: text('ts').notNull(),
		slot: integer('slot').notNull(),
		itemName: text('item_name').notNull(),
		count: integer('count').notNull()
	},
	(t) => [
		index('idx_inv_race_bot').on(t.raceId, t.botId),
		index('idx_inv_bot').on(t.botId)
	]
);
