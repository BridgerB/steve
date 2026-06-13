/**
 * SQLite logger for Steve bot.
 * Shared db: all bots write to one file with bot_id + race_id columns.
 * Uses WAL mode for safe concurrent writes.
 * Events are buffered in memory and flushed in a single transaction every 500ms.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Bot } from "typecraft";

let db: Database.Database | null = null;
let raceId: string = "";
let botId: string = "";
let tickInterval: ReturnType<typeof setInterval> | null = null;
let flushInterval: ReturnType<typeof setInterval> | null = null;

const DB_PATH = join(process.cwd(), "data", "steve.db");

/**
 * Debug categories too high-volume to persist (per-packet / per-entity spam).
 * `bot.on("debug")` loggers should skip these — otherwise the db balloons to
 * hundreds of MB of `packet_rx` rows and buries the useful events.
 */
export const NOISY_DEBUG = new Set([
	"packet_rx",
	"packet_tx",
	"entity",
	// High-volume per-tick debug that bloated the DB to ~700 MB in one race
	// (filling the disk). Lower-volume diagnostics (mine/step/wood/cast/safety/
	// nav/smelt/craft) are kept for debugging.
	"findBlocks",
	"dig",
	"inventory",
	"collect",
	"place",
	"click",
]);

// ── Write buffer ──────────────────────────────────────────────────
type EventRow = [
	string,
	string,
	string,
	string,
	string,
	string | null,
	number | null,
	number | null,
	number | null,
];
type TickRow = [
	string,
	string,
	string,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	string,
	string,
	string,
	number,
	number,
];
type InvRow = [string, string, string, number, string, number];

const eventBuf: EventRow[] = [];
const tickBuf: TickRow[] = [];
const invBuf: InvRow[] = [];

const FLUSH_INTERVAL_MS = 500;

/** Initialize the database and start a new session */
export const initLogger = (race: string): void => {
	mkdirSync(join(process.cwd(), "data"), { recursive: true });

	botId = process.env.MC_USERNAME ?? "Steve";
	raceId = race;

	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");

	db.exec(`
    CREATE TABLE IF NOT EXISTS races (
      race_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 1,
      timeout_sec INTEGER,
      goal TEXT
    );

    CREATE TABLE IF NOT EXISTS ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      x REAL, y REAL, z REAL,
      yaw REAL, pitch REAL,
      health REAL,
      food INTEGER,
      dimension TEXT,
      block_below TEXT,
      block_at_cursor TEXT,
      is_in_water INTEGER,
      on_ground INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      category TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT,
      x REAL, y REAL, z REAL
    );

    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      slot INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      count INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_race ON events(race_id);
    CREATE INDEX IF NOT EXISTS idx_events_cat ON events(category);
    CREATE INDEX IF NOT EXISTS idx_events_bot ON events(bot_id);
    CREATE INDEX IF NOT EXISTS idx_inv_race_bot ON inventory_snapshots(race_id, bot_id);
    CREATE INDEX IF NOT EXISTS idx_inv_bot ON inventory_snapshots(bot_id);
  `);

	flushInterval = setInterval(flushBuffers, FLUSH_INTERVAL_MS);
};

/** Register a race/session in the races table */
export const registerRace = (
	id: string,
	kind: string,
	botCount: number,
	timeoutSec?: number,
	goal?: string,
): void => {
	if (!db) return;
	db.prepare(
		"INSERT OR IGNORE INTO races (race_id, kind, started_at, bot_count, timeout_sec, goal) VALUES (?, ?, ?, ?, ?, ?)",
	).run(
		id,
		kind,
		new Date().toISOString(),
		botCount,
		timeoutSec ?? null,
		goal ?? null,
	);
};

const ts = () => new Date().toISOString();

let stmtTick: Database.Statement | null = null;
let stmtEvent: Database.Statement | null = null;
let stmtInv: Database.Statement | null = null;

const getTickStmt = () => {
	if (!stmtTick && db) {
		stmtTick = db.prepare(
			`INSERT INTO ticks (race_id, bot_id, ts, x, y, z, yaw, pitch, health, food, dimension, block_below, block_at_cursor, is_in_water, on_ground) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
	}
	return stmtTick;
};

const getEventStmt = () => {
	if (!stmtEvent && db) {
		stmtEvent = db.prepare(
			`INSERT INTO events (race_id, bot_id, ts, category, event, detail, x, y, z) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
	}
	return stmtEvent;
};

const getInvStmt = () => {
	if (!stmtInv && db) {
		stmtInv = db.prepare(
			`INSERT INTO inventory_snapshots (race_id, bot_id, ts, slot, item_name, count) VALUES (?, ?, ?, ?, ?, ?)`,
		);
	}
	return stmtInv;
};

// ── Flush: write all buffered rows in one transaction ─────────────
const flushBuffers = (): void => {
	if (!db) return;
	if (eventBuf.length === 0 && tickBuf.length === 0 && invBuf.length === 0)
		return;

	const events = eventBuf.splice(0);
	const ticks = tickBuf.splice(0);
	const inv = invBuf.splice(0);

	const eventStmt = getEventStmt();
	const tickStmt = getTickStmt();
	const invStmt = getInvStmt();

	db.transaction(() => {
		if (eventStmt) for (const row of events) eventStmt.run(...row);
		if (tickStmt) for (const row of ticks) tickStmt.run(...row);
		if (invStmt) for (const row of inv) invStmt.run(...row);
	})();
};

/** Log a discrete event */
export const logEvent = (
	category: string,
	event: string,
	detail?: string,
	pos?: { x: number; y: number; z: number },
): void => {
	if (!db) return;
	eventBuf.push([
		raceId,
		botId,
		ts(),
		category,
		event,
		detail ?? null,
		pos?.x ?? null,
		pos?.y ?? null,
		pos?.z ?? null,
	]);
};

/** Log a full tick snapshot */
const logTick = (bot: Bot): void => {
	if (!db || !bot.entity?.position) return;

	const p = bot.entity.position;

	let blockBelow = "unknown";
	try {
		const below = bot.blockAt({
			x: Math.floor(p.x),
			y: Math.floor(p.y) - 1,
			z: Math.floor(p.z),
		} as { x: number; y: number; z: number }) as { name?: string } | null;
		if (below) blockBelow = below.name ?? "unknown";
	} catch {
		/* ignore */
	}

	let blockCursor = "air";
	try {
		const cursor = bot.blockAtCursor?.(5) as { name?: string } | null;
		if (cursor) blockCursor = cursor.name ?? "air";
	} catch {
		/* ignore */
	}

	const dim = String(bot.game?.dimension ?? "overworld");
	const t = ts();

	tickBuf.push([
		raceId,
		botId,
		t,
		p.x,
		p.y,
		p.z,
		bot.entity.yaw,
		bot.entity.pitch,
		bot.health ?? 20,
		bot.food ?? 20,
		dim,
		blockBelow,
		blockCursor,
		bot.entity.isInWater ? 1 : 0,
		bot.entity.onGround ? 1 : 0,
	]);

	const registry = bot.registry;
	for (let i = 0; i < bot.inventory.slots.length; i++) {
		const item = bot.inventory.slots[i];
		if (item && item.count > 0) {
			let name = item.name;
			if (name === "unknown" && registry) {
				const def = registry.itemsById.get(item.type);
				if (def) name = def.name;
			}
			invBuf.push([raceId, botId, t, i, name, item.count]);
		}
	}
};

/** Start the 1-second tick logger */
export const startTickLogger = (bot: Bot): void => {
	if (tickInterval) clearInterval(tickInterval);
	tickInterval = setInterval(() => {
		try {
			logTick(bot);
		} catch {
			/* don't crash */
		}
	}, 1000);
};

const HOSTILE_MOBS = new Set([
	"zombie",
	"zombie_villager",
	"husk",
	"drowned",
	"skeleton",
	"stray",
	"wither_skeleton",
	"bogged",
	"creeper",
	"spider",
	"cave_spider",
	"enderman",
	"witch",
	"slime",
	"magma_cube",
	"silverfish",
	"phantom",
	"pillager",
	"vindicator",
	"evoker",
	"ravager",
	"blaze",
	"ghast",
	"piglin",
	"piglin_brute",
	"zombified_piglin",
	"hoglin",
	"zoglin",
	"warden",
	"breeze",
	"shulker",
	"guardian",
	"elder_guardian",
	"vex",
	"endermite",
]);

type Entityish = {
	id?: number;
	name?: string;
	position?: { x: number; y: number; z: number };
};

/** Best-effort readable text from a chat-component NBT (death messages etc.). */
const componentText = (v: unknown, depth = 0): string => {
	if (v == null || depth > 8) return "";
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return v.map((x) => componentText(x, depth + 1)).join(" ");
	if (typeof v === "object") {
		const o = v as Record<string, unknown>;
		// Unwrap typecraft's tagged NBT ({ type, value })
		if ("value" in o && "type" in o) return componentText(o.value, depth + 1);
		const parts: string[] = [];
		if (o.translate != null) parts.push(`[${componentText(o.translate, depth + 1)}]`);
		if (o.text != null) parts.push(componentText(o.text, depth + 1));
		if (o.with != null) parts.push(componentText(o.with, depth + 1));
		if (o.extra != null) parts.push(componentText(o.extra, depth + 1));
		if (parts.length === 0) {
			// plain map of named entries (NBT compound) — recurse values
			for (const val of Object.values(o)) parts.push(componentText(val, depth + 1));
		}
		return parts.filter(Boolean).join(" ").trim();
	}
	return "";
};

/**
 * Attach rich diagnostics to a bot: logs death cause (combat-kill message +
 * damage source), damage events, health drops, nearby hostile mobs, and starts
 * the per-second tick logger. Call this for every bot so there are no blind
 * spots — including the REPL/MCP bots, not just races.
 */
export const attachDiagnostics = (bot: Bot): void => {
	let lastDamage: string | null = null;
	let lastDeathMsg: string | null = null;
	let lastHealth = bot.health ?? 20;

	const posOf = () => {
		const p = bot.entity?.position;
		return p ? { x: p.x, y: p.y, z: p.z } : undefined;
	};
	const entities = () => bot.entities as unknown as Record<number, Entityish>;
	const nearbyHostiles = (radius = 20): { name: string; d: number }[] => {
		const p = bot.entity?.position;
		if (!p) return [];
		return Object.values(entities())
			.filter((e) => e?.name && HOSTILE_MOBS.has(e.name) && e.position)
			.map((e) => ({
				name: e.name as string,
				d: +Math.hypot(
					(e.position as { x: number }).x - p.x,
					(e.position as { y: number }).y - p.y,
					(e.position as { z: number }).z - p.z,
				).toFixed(1),
			}))
			.filter((e) => e.d <= radius)
			.sort((a, b) => a.d - b.d)
			.slice(0, 8);
	};
	const blockName = (dx: number, dy: number, dz: number): string => {
		const p = bot.entity?.position;
		if (!p) return "?";
		try {
			const b = bot.blockAt({
				x: Math.floor(p.x) + dx,
				y: Math.floor(p.y) + dy,
				z: Math.floor(p.z) + dz,
			} as { x: number; y: number; z: number }) as { name?: string } | null;
			return b?.name ?? "?";
		} catch {
			return "?";
		}
	};

	bot.client.on("damage_event", (pkt: Record<string, unknown>) => {
		if (!bot.entity || pkt.entityId !== bot.entity.id) return;
		const causeId = pkt.sourceCauseId as number | undefined;
		const directId = pkt.sourceDirectId as number | undefined;
		const cause = causeId ? entities()[causeId]?.name : null;
		const direct = directId ? entities()[directId]?.name : null;
		lastDamage = JSON.stringify({
			damageTypeId: pkt.sourceTypeId,
			cause: cause ?? null,
			direct: direct ?? null,
			srcPos: pkt.sourcePosition ?? null,
			hp: bot.health,
		});
		logEvent("damage", "hit", lastDamage, posOf());
	});

	bot.client.on("player_combat_kill", (pkt: Record<string, unknown>) => {
		if (bot.entity && pkt.playerId !== bot.entity.id) return;
		const text = componentText(pkt.message);
		lastDeathMsg = JSON.stringify({
			text,
			raw: JSON.stringify(pkt.message).slice(0, 300),
		});
		logEvent("death", "message", lastDeathMsg, posOf());
	});

	bot.on("death", () => {
		logEvent(
			"death",
			"died",
			JSON.stringify({
				message: lastDeathMsg,
				lastDamage,
				y: bot.entity ? Math.floor(bot.entity.position.y) : null,
				blockFeet: blockName(0, 0, 0),
				blockBelow: blockName(0, -1, 0),
				dimension: String(bot.game?.dimension ?? "overworld"),
				hostiles: nearbyHostiles(),
			}),
			posOf(),
		);
		lastDamage = null;
		lastDeathMsg = null;
	});

	bot.on("health", () => {
		const h = bot.health ?? 20;
		if (h < lastHealth - 0.01) {
			logEvent(
				"health",
				"drop",
				JSON.stringify({
					from: +lastHealth.toFixed(1),
					to: +h.toFixed(1),
					dmg: +(lastHealth - h).toFixed(1),
					food: bot.food,
					lastDamage,
					y: bot.entity ? Math.floor(bot.entity.position.y) : null,
					blockFeet: blockName(0, 0, 0),
					hostiles: nearbyHostiles(12),
				}),
				posOf(),
			);
		}
		lastHealth = h;
	});

	bot.on("respawn", () => {
		lastHealth = bot.health ?? 20;
		logEvent("lifecycle", "respawn", undefined, posOf());
	});

	// Periodic threat scan — see mob buildup even when not taking damage yet.
	const threatTimer = setInterval(() => {
		const near = nearbyHostiles(14);
		if (near.length > 0) {
			logEvent(
				"threat",
				"hostiles",
				JSON.stringify({ y: bot.entity ? Math.floor(bot.entity.position.y) : null, light: blockName(0, 0, 0), mobs: near }),
				posOf(),
			);
		}
	}, 3000);
	bot.on("end", () => clearInterval(threatTimer));

	startTickLogger(bot);
};

/** Stop logging and close the database */
export const stopLogger = (): void => {
	if (tickInterval) {
		clearInterval(tickInterval);
		tickInterval = null;
	}
	if (flushInterval) {
		clearInterval(flushInterval);
		flushInterval = null;
	}
	// Flush remaining buffered data before closing
	if (db) {
		try {
			flushBuffers();
		} catch {
			/* closing anyway */
		}
		db.close();
		db = null;
	}
};

/** Get current race ID */
export const getRaceId = (): string => raceId;

/** Get db path (always data/steve.db) */
export const getDbPath = (): string => DB_PATH;
