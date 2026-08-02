/**
 * Deterministic water-escape harness. Connects InlineBot, builds a water arena
 * via RCON (reliable + op-level, unlike bot.chat commands which 26.1.2 no longer
 * runs), teleports the bot in, verifies it is ACTUALLY submerged, then runs
 * escapeWater and prints PASS/FAIL. RCON tunnel required:
 *   ssh -fN -L 25575:127.0.0.1:25575 bridger@144.24.32.76
 *
 *   node --env-file=.env --import ./typecraft-resolve.mjs water-harness.ts pocket
 *   modes: tunnel | capped | deep | pocket   (default pocket)
 */
import { createBot, vec3 } from "typecraft";
import { escapeWater } from "./src/lib/steve/lib/bot-utils.ts";
import { initLogger } from "./src/lib/steve/lib/logger.ts";
import { connect } from "./src/lib/steve/lib/rcon.ts";

const MODE = process.argv[2] ?? "pocket";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Arena anchored far from spawn + the race/ruststeve action (they run near 0,0).
const BX = 320;
const BZ = 320;

// Each mode: `build` = RCON commands (bottom-up), `dest` = tp target (in water),
// `retreat` = optional known-safe shore for escapeWater (undefined = must self-find).
type Arena = { build: string[]; dest: [number, number, number]; retreat?: [number, number, number] };
const arenas: Record<string, Arena> = {
	// Flooded horizontal tunnel: dry on the near end, flooded on the far end.
	tunnel: {
		build: [
			`fill ${BX - 2} 72 ${BZ} ${BX + 12} 78 ${BZ} stone`,
			`fill ${BX} 75 ${BZ} ${BX + 10} 76 ${BZ} air`,
			`fill ${BX + 5} 75 ${BZ} ${BX + 10} 76 ${BZ} water`,
		],
		dest: [BX + 10, 75, BZ],
		retreat: [BX + 1, 75, BZ],
	},
	// Capped water column: solid ceiling above the head → must dig UP to surface.
	capped: {
		build: [
			`fill ${BX - 3} 70 ${BZ - 3} ${BX + 3} 90 ${BZ + 3} stone`,
			`fill ${BX} 72 ${BZ} ${BX} 86 ${BZ} water`,
		],
		dest: [BX, 73, BZ],
	},
	// 16-deep open pool, dry shore up at y80: swim up + reach a distant bank.
	deep: {
		build: [
			`fill ${BX - 2} 60 ${BZ - 2} ${BX + 12} 79 ${BZ + 12} stone`,
			`fill ${BX} 64 ${BZ} ${BX + 10} 79 ${BZ + 10} water`,
		],
		dest: [BX + 5, 64, BZ + 5],
		retreat: [BX - 1, 80, BZ + 5],
	},
	// THE failure I keep hitting: a small water pocket boxed by dirt walls that
	// rise 2 above the water surface. Bot bobs at the surface but can't hop the
	// 2-high lip on the 0.3 impulse alone — it must notch-dig a wall to climb out.
	// 3x3 water floor (room to maneuver), 1-deep, dirt walls to y65, no retreat.
	pocket: {
		build: [
			`fill ${BX - 4} 58 ${BZ - 4} ${BX + 4} 65 ${BZ + 4} dirt`,
			`fill ${BX - 1} 63 ${BZ - 1} ${BX + 1} 65 ${BZ + 1} air`,
			`fill ${BX - 1} 63 ${BZ - 1} ${BX + 1} 63 ${BZ + 1} water`,
		],
		dest: [BX, 63, BZ],
	},
	// The SteveRun8 killer: a lake meeting a TALL (~3-block) dirt bank. Bot floats in
	// the water at the edge, bobs onto a 1-block nub, false-"escapes", reset, repeat.
	// Water on the −x half (surface y64), solid dirt bank on the +x half up to y66
	// (walkable y67, 3 above the surface). Must staircase up the bank to escape.
	lakeedge: {
		build: [
			`fill ${BX - 10} 55 ${BZ - 6} ${BX + 8} 60 ${BZ + 6} dirt`,
			`fill ${BX - 10} 61 ${BZ - 6} ${BX - 1} 64 ${BZ + 6} water`,
			`fill ${BX} 61 ${BZ - 6} ${BX + 8} 66 ${BZ + 6} dirt`,
		],
		dest: [BX - 3, 62, BZ],
	},
};

const arena = arenas[MODE];
if (!arena) {
	console.log(`unknown mode ${MODE} — use tunnel|capped|deep|pocket`);
	process.exit(1);
}

const rcon = await connect();
const cmd = (c: string) => rcon.command(c);

const bot = createBot({
	host: process.env.MC_HOST ?? "localhost",
	port: parseInt(process.env.MC_PORT ?? "25565", 10),
	username: "InlineBot",
	version: process.env.MC_VERSION ?? "1.21.11",
	auth: "offline",
});
bot.on("error", (e) => {
	if (!e.message.includes("waypoint")) console.log("ERR", e.message);
});
initLogger(`waterharness-${MODE}-${new Date().toISOString()}`);

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);

	// Force-load the arena so /fill applies even though no player is near it.
	await cmd(`forceload add ${BX} ${BZ}`);
	// Clear the whole arena volume to air FIRST so leftovers from a previous mode/run
	// (dug staircases, another mode's stone tower) never pollute the test.
	await cmd(`fill ${BX - 14} 50 ${BZ - 12} ${BX + 18} 95 ${BZ + 12} air`);
	await sleep(400);
	for (const c of arena.build) await cmd(c);
	await sleep(1500);

	// Teleport in and WAIT for the bot to actually arrive submerged (RCON tp is
	// async from the bot's POV — poll its position rather than trust a fixed sleep).
	const [dx, dy, dz] = arena.dest;
	let arrived = false;
	for (let i = 0; i < 20; i++) {
		await cmd(`tp InlineBot ${dx} ${dy} ${dz}`);
		await sleep(400);
		const p = bot.entity?.position;
		if (p && Math.abs(p.x - dx) < 2 && Math.abs(p.z - dz) < 2) {
			arrived = true;
			break;
		}
	}
	await sleep(600);

	const s = bot.entity.position;
	const submerged = bot.entity.isInWater;
	console.log(
		`START mode=${MODE} arrived=${arrived} x=${Math.round(s.x)} y=${Math.round(s.y * 10) / 10} z=${Math.round(s.z)} inWater=${submerged} hp=${bot.health}`,
	);
	if (!arrived || !submerged) {
		console.log("SETUP_FAIL — bot not submerged in the arena; escapeWater result would be meaningless");
		await cmd(`forceload remove ${BX} ${BZ}`);
		process.exit(2);
	}

	const retreat = arena.retreat ? vec3(...arena.retreat) : undefined;
	const t0 = Date.now();
	const ok = await escapeWater(bot, retreat);
	const p = bot.entity.position;
	const dry = !bot.entity.isInWater;
	console.log(
		`RESULT ${ok && dry ? "PASS" : "FAIL"} ok=${ok} took=${Date.now() - t0}ms x=${Math.round(p.x)} y=${Math.round(p.y * 10) / 10} z=${Math.round(p.z)} inWater=${bot.entity.isInWater} hp=${bot.health}`,
	);
	await cmd(`forceload remove ${BX} ${BZ}`);
	await sleep(300);
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT — never reached spawn/finish");
	process.exit(1);
}, 90000);
