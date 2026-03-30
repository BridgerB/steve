import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const racesDir = join(process.cwd(), "data", "races");

try {
	readdirSync(racesDir);
} catch {
	console.log("\n  No races yet. Start one from the race tab:");
	console.log("  nix run .#race -- 20 600\n");
	process.exit(0);
}

const dirs = readdirSync(racesDir)
	.map((d) => ({ name: d, mtime: statSync(join(racesDir, d)).mtimeMs }))
	.sort((a, b) => b.mtime - a.mtime)
	.map((d) => d.name);
if (dirs.length === 0) {
	console.log("\n  No races yet. Start one from the race tab:");
	console.log("  nix run .#race -- 20 600\n");
	process.exit(0);
}

const raceDir = dirs[0]!;
const dbPath = join(racesDir, raceDir, "race.db");

try {
	statSync(dbPath);
} catch {
	console.log(`  Race starting up... (${raceDir})`);
	process.exit(0);
}

const db = new Database(dbPath, { readonly: true });
db.pragma("journal_mode = WAL");

// Status
const dbMod = statSync(dbPath).mtimeMs;
const ageSec = Math.round((Date.now() - dbMod) / 1000);
const ageStr =
	ageSec < 60
		? `${ageSec}s ago`
		: ageSec < 3600
			? `${Math.floor(ageSec / 60)}m ago`
			: `${Math.floor(ageSec / 3600)}h ${Math.floor((ageSec % 3600) / 60)}m ago`;

// Check for active bot processes
let botsAlive = 0;
try {
	const { execSync } = await import("node:child_process");
	const out = execSync("pgrep -fc 'node.*src/main.ts'", {
		encoding: "utf-8",
	}).trim();
	const n = parseInt(out, 10) || 0;
	botsAlive = Math.max(0, n > 1 ? n - 1 : 0);
} catch {}

const status =
	botsAlive > 0
		? `🏁 RACING (${botsAlive} bots)`
		: ageSec < 30
			? "🏁 JUST FINISHED"
			: `⏹ FINISHED (${ageStr})`;

// Each milestone: [display name, step event pattern, inventory item pattern]
const milestones = [
	["wood", "Gather Wood:%", "%_log"],
	["planks", "Craft Planks:%", "%_planks"],
	["table", "Craft Crafting Table:%", "crafting_table"],
	["wood pick", "Craft Wooden Pickaxe:%", "wooden_pickaxe"],
	["cobblestone", "Mine Cobblestone:%", "cobblestone"],
	["stone pick", "Craft Stone Pickaxe:%", "stone_pickaxe"],
	["stone sword", "Craft Stone Sword:%", "stone_sword"],
	["furnace", "Craft Furnace:%", "furnace"],
	["coal", "Mine Coal:%", "coal"],
	["iron ore", "Mine Iron%", "raw_iron"],
	["smelt iron", "Smelt Iron:%", "iron_ingot"],
	["iron pick", "Craft Iron Pickaxe:%", "iron_pickaxe"],
	["bucket", "Craft Bucket%", "bucket"],
	["water bucket", "Fill Water%", "water_bucket"],
	["food", "Gather Food:%", null],
] as const;

// Fetch all data in bulk, then process in JS
const spawns = db
	.prepare(
		"SELECT bot_id, MIN(ts) as ts FROM events WHERE category = 'lifecycle' AND event = 'spawn' GROUP BY bot_id",
	)
	.all() as { bot_id: string; ts: string }[];

const successes = db
	.prepare("SELECT bot_id, detail, ts FROM events WHERE event = 'success'")
	.all() as { bot_id: string; detail: string; ts: string }[];

const invItems = db
	.prepare(
		"SELECT bot_id, item_name, MAX(count) as count FROM inventory_snapshots GROUP BY bot_id, item_name HAVING count > 0",
	)
	.all() as { bot_id: string; item_name: string; count: number }[];

// Build per-bot milestone data
type BotData = { done: boolean; timeSec: number | null }[];
const botResults = new Map<string, BotData>();

for (const { bot_id, ts: spawnTs } of spawns) {
	const spawnTime = new Date(spawnTs).getTime();
	const botSuccesses = successes.filter((s) => s.bot_id === bot_id);
	const botInv = invItems.filter((i) => i.bot_id === bot_id);

	const data: BotData = milestones.map(([, stepPattern, invPattern]) => {
		const likeMatch = (detail: string, pattern: string) => {
			const p = pattern.replace(/%/g, ".*").replace(/_/g, ".");
			return new RegExp(`^${p}$`).test(detail);
		};
		const stepHit = botSuccesses.find((s) => likeMatch(s.detail, stepPattern));
		const invHit = invPattern
			? botInv.some((i) => {
					const p = invPattern.replace(/%/g, ".*");
					return new RegExp(`^${p}$`).test(i.item_name);
				})
			: false;
		const done = !!stepHit || invHit;
		const timeSec = stepHit
			? Math.round((new Date(stepHit.ts).getTime() - spawnTime) / 1000)
			: null;
		return { done, timeSec };
	});
	botResults.set(bot_id, data);
}

// Sort bots naturally (Steve0, Steve1, ..., Steve19)
const botIds = [...botResults.keys()].sort((a, b) => {
	const na = parseInt(a.replace(/\D/g, "")) || 0;
	const nb = parseInt(b.replace(/\D/g, "")) || 0;
	return na - nb;
});

const rows = botIds.map((bot_id) => {
	const data = botResults.get(bot_id)!;
	const vals: Record<string, unknown> = { bot_id };
	for (let i = 0; i < milestones.length; i++) {
		vals[`col${i}`] = data[i]!.done ? 1 : 0;
		vals[`time${i}`] = data[i]!.timeSec;
	}
	return vals;
});

if (rows.length === 0) {
	console.log(`\n  ${status} — ${raceDir}`);
	console.log("  Waiting for first results...\n");
	process.exit(0);
}

console.log(`\n  ${status} — ${raceDir}\n`);

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const fmtTime = (secs: number | null): string => {
	if (secs == null) return "";
	if (secs < 60) return `${secs}s`;
	const m = Math.floor(secs / 60);
	const s = secs % 60;
	return s > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${m}m`;
};

// Build cell data: cellData[botIndex][milestoneIndex]
const cellData: { done: boolean; time: string }[][] = [];
for (const row of rows) {
	const vals = Object.values(row);
	const cells: { done: boolean; time: string }[] = [];
	for (let i = 0; i < milestones.length; i++) {
		const done = vals[1 + i * 2] === 1;
		const timeSec = vals[2 + i * 2] as number | null;
		cells.push({ done, time: done ? fmtTime(timeSec) : "" });
	}
	cellData.push(cells);
}

const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));

// Transposed: bots across top, milestones down left
const milestoneW = Math.max(14, ...milestones.map(([name]) => name.length));
const botNames = botIds;
const botW = Math.max(6, ...botNames.map((b) => b.length));

// Header row: milestone label column + bot names
const hdr =
	"  " +
	pad("", milestoneW + 2) +
	botNames.map((b) => dim(pad(b, botW))).join("  ");
const sep =
	"  " + dim("─".repeat(milestoneW + 2 + botNames.length * (botW + 2)));
console.log(hdr);
console.log(sep);

// One row per milestone
for (let mi = 0; mi < milestones.length; mi++) {
	const name = milestones[mi]![0];
	let line = "  " + bold(pad(name, milestoneW + 2));
	for (let bi = 0; bi < botNames.length; bi++) {
		const cell = cellData[bi]?.[mi];
		if (cell?.done) {
			const visual = cell.time ? `✔ ${cell.time}` : "✔";
			line +=
				green(visual) + " ".repeat(Math.max(0, botW - visual.length)) + "  ";
		} else {
			line += dim("·") + " ".repeat(Math.max(0, botW - 1)) + "  ";
		}
	}
	console.log(line);
}
console.log("");

db.close();
