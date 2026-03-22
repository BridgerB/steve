/**
 * SQLite logger for Steve bot.
 * Each run gets its own db file: data/{ISO-timestamp}.db
 * One session per file — no need for session_id columns.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Bot } from "typecraft";

let db: Database.Database | null = null;
let sessionId: string = "";
let dbPath: string = "";
let tickInterval: ReturnType<typeof setInterval> | null = null;

/** Initialize the database and start a new session */
export const initLogger = (): string => {
  const dataDir = join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });

  sessionId = new Date().toISOString();
  const safeId = sessionId.replace(/:/g, "-");
  dbPath = join(dataDir, `${safeId}.db`);

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      category TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT,
      x REAL, y REAL, z REAL
    );

    CREATE TABLE inventory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      slot INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      count INTEGER NOT NULL
    );

    CREATE INDEX idx_events_cat ON events(category);
  `);

  console.log(`[steve] session ${sessionId}`);
  console.log(`[steve] logging to ${dbPath}`);

  return sessionId;
};

const ts = () => new Date().toISOString();

let stmtTick: Database.Statement | null = null;
let stmtEvent: Database.Statement | null = null;
let stmtInv: Database.Statement | null = null;

const getTickStmt = () => {
  if (!stmtTick && db) {
    stmtTick = db.prepare(`INSERT INTO ticks (ts, x, y, z, yaw, pitch, health, food, dimension, block_below, block_at_cursor, is_in_water, on_ground) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  }
  return stmtTick;
};

const getEventStmt = () => {
  if (!stmtEvent && db) {
    stmtEvent = db.prepare(`INSERT INTO events (ts, category, event, detail, x, y, z) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  }
  return stmtEvent;
};

const getInvStmt = () => {
  if (!stmtInv && db) {
    stmtInv = db.prepare(`INSERT INTO inventory_snapshots (ts, slot, item_name, count) VALUES (?, ?, ?, ?)`);
  }
  return stmtInv;
};

/** Log a discrete event */
export const logEvent = (
  category: string,
  event: string,
  detail?: string,
  pos?: { x: number; y: number; z: number },
): void => {
  if (!db) return;
  const stmt = getEventStmt();
  if (!stmt) return;
  stmt.run(ts(), category, event, detail ?? null, pos?.x ?? null, pos?.y ?? null, pos?.z ?? null);
};

/** Log a full tick snapshot */
const logTick = (bot: Bot): void => {
  if (!db || !bot.entity?.position) return;

  const p = bot.entity.position;

  let blockBelow = "unknown";
  try {
    const below = bot.blockAt({ x: Math.floor(p.x), y: Math.floor(p.y) - 1, z: Math.floor(p.z) } as any) as any;
    if (below) blockBelow = below.name ?? "unknown";
  } catch { /* ignore */ }

  let blockCursor = "air";
  try {
    const cursor = bot.blockAtCursor?.(5) as any;
    if (cursor) blockCursor = cursor.name ?? "air";
  } catch { /* ignore */ }

  const dim = String(bot.game?.dimension ?? "overworld");

  const stmt = getTickStmt();
  if (!stmt) return;
  stmt.run(
    ts(),
    p.x, p.y, p.z,
    bot.entity.yaw, bot.entity.pitch,
    bot.health ?? 20, bot.food ?? 20,
    dim,
    blockBelow,
    blockCursor,
    bot.entity.isInWater ? 1 : 0,
    bot.entity.onGround ? 1 : 0,
  );

  const invStmt = getInvStmt();
  if (!invStmt) return;
  const t = ts();
  for (let i = 0; i < bot.inventory.slots.length; i++) {
    const item = bot.inventory.slots[i];
    if (item && item.count > 0) {
      invStmt.run(t, i, item.name, item.count);
    }
  }
};

/** Start the 1-second tick logger */
export const startTickLogger = (bot: Bot): void => {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    try { logTick(bot); } catch { /* don't crash */ }
  }, 1000);
};

/** Stop logging and close the database */
export const stopLogger = (): void => {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  if (db) {
    db.close();
    db = null;
    console.log("[steve] database closed");
  }
};

/** Get current session ID */
export const getSessionId = (): string => sessionId;

/** Get current db path */
export const getDbPath = (): string => dbPath;
