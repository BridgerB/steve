import {
	pgTable,
	bigserial,
	integer,
	text,
	doublePrecision,
	index
} from 'drizzle-orm/pg-core';

// One database for everything: the steve bot writes here (logger) and the
// dashboard reads here (race.ts). This schema is the single source of truth —
// `npm run db:push` creates these tables in the local Postgres (docker compose).
// Timestamps are ISO-8601 TEXT (the bot Date.parse()s them); ids are bigserial.

export const races = pgTable('races', {
	raceId: text('race_id').primaryKey(),
	kind: text('kind').notNull(),
	startedAt: text('started_at').notNull(),
	botCount: integer('bot_count').notNull().default(1),
	timeoutSec: integer('timeout_sec'),
	goal: text('goal')
});

export const ticks = pgTable(
	'ticks',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		raceId: text('race_id').notNull(),
		botId: text('bot_id').notNull(),
		ts: text('ts').notNull(),
		x: doublePrecision('x'),
		y: doublePrecision('y'),
		z: doublePrecision('z'),
		yaw: doublePrecision('yaw'),
		pitch: doublePrecision('pitch'),
		health: doublePrecision('health'),
		food: integer('food'),
		dimension: text('dimension'),
		blockBelow: text('block_below'),
		blockAtCursor: text('block_at_cursor'),
		isInWater: integer('is_in_water'),
		onGround: integer('on_ground')
	},
	(t) => [index('idx_ticks_race_bot').on(t.raceId, t.botId)]
);

export const events = pgTable(
	'events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		raceId: text('race_id').notNull(),
		botId: text('bot_id').notNull(),
		ts: text('ts').notNull(),
		category: text('category').notNull(),
		event: text('event').notNull(),
		detail: text('detail'),
		x: doublePrecision('x'),
		y: doublePrecision('y'),
		z: doublePrecision('z'),
		yaw: doublePrecision('yaw'),
		pitch: doublePrecision('pitch')
	},
	(t) => [
		index('idx_events_race').on(t.raceId),
		index('idx_events_cat').on(t.category),
		index('idx_events_bot').on(t.botId)
	]
);

export const inventorySnapshots = pgTable(
	'inventory_snapshots',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
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
