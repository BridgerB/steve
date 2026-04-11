import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const dbPath = join(process.cwd(), "data", "steve.db");

if (!existsSync(dbPath)) {
	console.log("\n  No races yet. Start one from the race tab:");
	console.log("  nix run .#race -- 20 600\n");
	process.exit(0);
}

const db = new Database(dbPath, { readonly: true });
db.pragma("journal_mode = WAL");

const latestRace = db
	.prepare(
		"SELECT race_id, started_at, bot_count FROM races WHERE kind = 'race' ORDER BY started_at DESC LIMIT 1",
	)
	.get() as
	| { race_id: string; started_at: string; bot_count: number }
	| undefined;

if (!latestRace) {
	console.log("\n  No races yet. Start one from the race tab:");
	console.log("  nix run .#race -- 20 600\n");
	db.close();
	process.exit(0);
}

const raceId = latestRace.race_id;

// Status — use latest event timestamp for age
const lastEvent = db
	.prepare("SELECT MAX(ts) as ts FROM events WHERE race_id = ?")
	.get(raceId) as { ts: string | null } | undefined;
const lastTs = lastEvent?.ts ? new Date(lastEvent.ts).getTime() : Date.now();
const ageSec = Math.round((Date.now() - lastTs) / 1000);
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

// Each milestone: [display name, SQL LIKE pattern for item_name]
const milestones = [
	["wood", "%_log"],
	["planks", "%_planks"],
	["table", "crafting_table"],
	["wood pick", "wooden_pickaxe"],
	["cobblestone", "cobblestone"],
	["stone pick", "stone_pickaxe"],
	["stone sword", "stone_sword"],
	["food", "cooked_%"],
	["furnace", "furnace"],
	["coal", "coal"],
	["iron ore", "raw_iron"],
	["iron ingot", "iron_ingot"],
	["iron pick", "iron_pickaxe"],
	["bucket", "bucket"],
	["water bucket", "water_bucket"],
	["flint&steel", "flint_and_steel"],
	["blaze rod", "blaze_rod"],
	["ender pearl", "ender_pearl"],
	["eye of ender", "ender_eye"],
] as const;

// Fetch spawn times and first-seen inventory timestamps
const spawns = db
	.prepare(
		"SELECT bot_id, MIN(ts) as ts FROM events WHERE race_id = ? AND category = 'lifecycle' AND event = 'spawn' GROUP BY bot_id",
	)
	.all(raceId) as { bot_id: string; ts: string }[];

const invFirstSeen = db
	.prepare(
		"SELECT bot_id, item_name, MIN(ts) as ts FROM inventory_snapshots WHERE race_id = ? AND count > 0 GROUP BY bot_id, item_name",
	)
	.all(raceId) as { bot_id: string; item_name: string; ts: string }[];

// Build per-bot milestone data
type BotData = { done: boolean; timeSec: number | null }[];
const botResults = new Map<string, BotData>();

const likeToRegex = (pattern: string) =>
	new RegExp(`^${pattern.replace(/%/g, ".*")}$`);

for (const { bot_id, ts: spawnTs } of spawns) {
	const spawnTime = new Date(spawnTs).getTime();
	const botInv = invFirstSeen.filter((i) => i.bot_id === bot_id);

	const data: BotData = milestones.map(([, itemPattern]) => {
		const re = likeToRegex(itemPattern);
		const hit = botInv.find((i) => re.test(i.item_name));
		if (!hit) return { done: false, timeSec: null };
		const timeSec = Math.round((new Date(hit.ts).getTime() - spawnTime) / 1000);
		return { done: true, timeSec };
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
	console.log(`\n  ${status} — ${raceId}`);
	console.log("  Waiting for first results...\n");
	process.exit(0);
}

console.log(`\n  ${status} — ${raceId}\n`);

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
