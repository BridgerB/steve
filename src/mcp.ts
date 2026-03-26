/**
 * MCP server for Steve — live bot control via Claude Code.
 *
 * Connects a bot to an already-running Minecraft server, then exposes
 * tools over stdio for Claude Code to call: state, inventory, look, eval, chat.
 *
 * Usage:
 *   node src/mcp.ts                           # connects to localhost:25565
 *   MC_HOST=x MC_PORT=y node src/mcp.ts       # custom server
 *   claude mcp add steve -- node src/mcp.ts   # register with Claude Code
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Bot } from "typecraft";
import { createBot as createMcBot, vec3, windowItems } from "typecraft";
import { z } from "zod";
import {
	craftItem,
	equipItem,
	findBlock,
	findBlocks,
	getCraftingTable,
	getMemory,
	getRememberedResource,
	goTo,
	rememberResource,
} from "./lib/bot-utils.ts";
import { getDbPath } from "./lib/logger.ts";
import { getPhase, syncFromBot } from "./state.ts";

// ── stdio transport — NO console.log anywhere ──
const log = (...args: unknown[]) => console.error("[mcp]", ...args);

const HOST = process.env.MC_HOST ?? "localhost";
const PORT = parseInt(process.env.MC_PORT ?? "25565", 10);
const USERNAME = process.env.MC_USERNAME ?? "McpBot";
const VERSION = process.env.MC_VERSION ?? "1.21.11";

// ── Bot lifecycle ──

let bot: Bot | null = null;
let botReady = false;

const connectBot = async (): Promise<Bot> => {
	const maxRetries = 30; // retry for up to ~60s
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const b = await new Promise<Bot>((resolve, reject) => {
				log(
					`Connecting to ${HOST}:${PORT} as ${USERNAME} (attempt ${attempt})...`,
				);
				const b = createMcBot({
					host: HOST,
					port: PORT,
					username: USERNAME,
					version: VERSION,
					auth: "offline",
				});

				let settled = false;
				b.on("error", (err) => {
					if (err.message.includes("waypoint")) return; // known typecraft noise
					if (!settled) {
						settled = true;
						reject(err);
					} else log("Bot error:", err.message);
				});

				b.once("spawn", async () => {
					settled = true;
					await b.waitForChunksToLoad();
					resolve(b);
				});

				b.on("end", () => {
					if (!settled) {
						settled = true;
						reject(new Error("disconnected"));
					} else {
						log("Bot disconnected");
						botReady = false;
						bot = null;
					}
				});

				setTimeout(() => {
					if (!settled) {
						settled = true;
						reject(new Error("timeout"));
					}
				}, 15000);
			});

			const p = b.entity.position;
			log(
				`Bot ready at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(
					p.z,
				)}`,
			);

			// Auto-op for interactive testing (/give, /tp, etc.)
			b.chat(`/op ${USERNAME}`);

			// Passive memory — same setup as main.ts
			for (const name of [
				"oak_log",
				"birch_log",
				"spruce_log",
				"jungle_log",
				"acacia_log",
				"dark_oak_log",
				"coal_ore",
				"deepslate_coal_ore",
				"iron_ore",
				"deepslate_iron_ore",
			]) {
				b.watchBlocks.add(name);
			}
			b.on(
				"blockSeen",
				(name: string, pos: { x: number; y: number; z: number }) => {
					rememberResource(b, name, pos);
				},
			);

			b.on("kicked", (reason) => {
				log("Bot kicked:", reason);
				botReady = false;
				bot = null;
			});

			bot = b;
			botReady = true;
			return b;
		} catch (err) {
			log(
				`Attempt ${attempt} failed:`,
				err instanceof Error ? err.message : err,
			);
			if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 2000));
		}
	}
	throw new Error(`Failed to connect after ${maxRetries} attempts`);
};

const requireBot = async (): Promise<Bot> => {
	if (!bot || !botReady) {
		log("Bot not connected — auto-reconnecting...");
		return await connectBot();
	}
	return bot;
};

// ── MCP Server ──

const server = new McpServer({ name: "steve-minecraft", version: "0.1.0" });

// Tool 1: state
server.tool(
	"state",
	"Get the bot's full game state: inventory counts, equipment, world state, health, food, position.",
	{},
	async () => {
		const b = await requireBot();
		const state = syncFromBot(b);
		return {
			content: [
				{ type: "text" as const, text: JSON.stringify(state, null, 2) },
			],
		};
	},
);

// Tool 2: inventory
server.tool(
	"inventory",
	"List every item in the bot's inventory with slot numbers, names, and counts.",
	{},
	async () => {
		const b = await requireBot();
		const items = windowItems(b.inventory).map((item, idx) => ({
			slot: idx,
			name: item.name,
			count: item.count,
		}));
		const pos = b.entity.position;
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							position: {
								x: +pos.x.toFixed(1),
								y: +pos.y.toFixed(1),
								z: +pos.z.toFixed(1),
							},
							health: b.health,
							food: b.food,
							items: items.length > 0 ? items : "empty",
							heldItem: b.heldItem?.name ?? "nothing",
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 3: look
server.tool(
	"look",
	"Survey surroundings: block counts in radius, nearby entities, dimension.",
	{
		radius: z.number().optional().describe("Search radius (default 5, max 16)"),
	},
	async ({ radius = 5 }) => {
		const b = await requireBot();
		const r = Math.min(radius, 16);
		const pos = b.entity.position;

		const blocks: Record<string, number> = {};
		for (let dx = -r; dx <= r; dx++) {
			for (let dy = -r; dy <= r; dy++) {
				for (let dz = -r; dz <= r; dz++) {
					const block = b.blockAt(
						vec3(
							Math.floor(pos.x) + dx,
							Math.floor(pos.y) + dy,
							Math.floor(pos.z) + dz,
						),
					);
					if (block && block.name !== "air" && block.name !== "cave_air") {
						blocks[block.name] = (blocks[block.name] ?? 0) + 1;
					}
				}
			}
		}

		const entities = Object.values(b.entities)
			.filter((e) => e.id !== b.entity.id)
			.map((e) => ({
				name: e.name ?? String(e.type),
				position: {
					x: +e.position.x.toFixed(1),
					y: +e.position.y.toFixed(1),
					z: +e.position.z.toFixed(1),
				},
				distance: +Math.sqrt(
					(e.position.x - pos.x) ** 2 +
						(e.position.y - pos.y) ** 2 +
						(e.position.z - pos.z) ** 2,
				).toFixed(1),
			}))
			.filter((e) => e.distance <= r * 2)
			.sort((a, b) => a.distance - b.distance)
			.slice(0, 20);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							position: {
								x: +pos.x.toFixed(1),
								y: +pos.y.toFixed(1),
								z: +pos.z.toFixed(1),
							},
							blockCounts: Object.entries(blocks)
								.sort((a, b) => b[1] - a[1])
								.slice(0, 30),
							entities: entities.length > 0 ? entities : "none visible",
							dimension: String(b.game?.dimension ?? "overworld"),
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 4: eval
let evalBusy = false;
const srcDir = dirname(fileURLToPath(import.meta.url));
const evalTmpFile = join(srcDir, ".mcp-eval.ts");

server.tool(
	"eval",
	`Execute TypeScript code with full access to the bot and all steve utilities.

The code runs as the body of an async function with these in scope:
  - bot: Bot instance (typecraft)
  - state: GameState (from syncFromBot)

You can import any module. Examples:
  - return bot.entity.position
  - const { goTo } = await import("./src/lib/bot-utils.ts"); await goTo(bot, { x: 100, y: 64, z: 200 }); return "arrived";
  - const { mineBlock } = await import("./src/tasks/mining/main.ts"); return await mineBlock(bot, "stone", 8);
  - bot.chat("/give McpBot diamond_pickaxe 1"); return "gave item";

Long-running operations block until complete (mining ~30-60s, navigation ~10s).`,
	{
		code: z
			.string()
			.describe(
				"TypeScript code to execute. Runs as: async (bot, state) => { YOUR_CODE }",
			),
		timeout: z.number().optional().describe("Timeout in ms (default 120000)"),
	},
	async ({ code, timeout = 120000 }) => {
		if (evalBusy) {
			return {
				content: [
					{
						type: "text" as const,
						text: "ERROR: Another eval is already running",
					},
				],
				isError: true,
			};
		}
		evalBusy = true;

		try {
			const b = await requireBot();
			const state = syncFromBot(b);

			writeFileSync(
				evalTmpFile,
				`export default async function(bot: any, state: any) { ${code} }\n`,
			);

			const mod = await import(`${evalTmpFile}?t=${Date.now()}`);
			const result = await Promise.race([
				mod.default(b, state),
				new Promise((_, reject) =>
					setTimeout(
						() => reject(new Error(`Eval timed out (${timeout}ms)`)),
						timeout,
					),
				),
			]);

			const text =
				result === undefined
					? "(no return value)"
					: JSON.stringify(result, null, 2);
			const p = b.entity.position;
			const summary = `\n\n--- Post-execution ---\nPos: ${Math.floor(p.x)}, ${Math.floor(
				p.y,
			)}, ${Math.floor(p.z)} | HP: ${b.health}/20 | Food: ${b.food}/20`;

			return { content: [{ type: "text" as const, text: text + summary }] };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const stack =
				err instanceof Error && err.stack
					? `\n${err.stack.split("\n").slice(0, 5).join("\n")}`
					: "";
			return {
				content: [{ type: "text" as const, text: `ERROR: ${msg}${stack}` }],
				isError: true,
			};
		} finally {
			evalBusy = false;
		}
	},
);

// Tool 5: chat
server.tool(
	"chat",
	"Send a chat message or slash command (e.g. /give, /tp, /gamemode).",
	{ message: z.string().describe("Chat message or slash command") },
	async ({ message }) => {
		const b = await requireBot();
		b.chat(message);
		await new Promise((r) => setTimeout(r, 500));
		const pos = b.entity.position;
		return {
			content: [
				{
					type: "text" as const,
					text: `Sent: ${message}\nPos: ${Math.floor(pos.x)}, ${Math.floor(
						pos.y,
					)}, ${Math.floor(pos.z)} | HP: ${b.health}/20`,
				},
			],
		};
	},
);

// Tool 6: sniff
// Only filter truly spammy packets — keep entity/block events for debugging
const NOISE_PACKETS = new Set([
	"move_entity_pos",
	"move_entity_pos_rot",
	"move_entity_rot",
	"set_entity_motion",
	"rotate_head",
	"set_entity_data",
	"keepalive",
	"keep_alive",
	"teleport_entity",
	"bundle_delimiter",
	"level_particles",
	"entity_position_sync",
	"set_time",
	"update_time",
	"level_chunk_with_light",
	"chunk_batch_finished",
	"set_chunk_cache_center",
	"light_update",
	"forget_level_chunk",
]);

server.tool(
	"sniff",
	`Capture incoming packets for a duration. Filters out movement/chunk noise.
Use to debug protocol issues — see what the server sends in response to actions.
Run an action via eval BEFORE calling sniff, or use the action parameter to run code during capture.`,
	{
		duration: z
			.number()
			.optional()
			.describe("Capture duration in ms (default 3000, max 15000)"),
		action: z
			.string()
			.optional()
			.describe(
				"Optional TypeScript code to run during capture (same as eval)",
			),
		filter: z
			.string()
			.optional()
			.describe(
				"Only include packets whose name contains this string (e.g. 'slot', 'container')",
			),
	},
	async ({ duration = 3000, action, filter }) => {
		const b = await requireBot();
		const ms = Math.min(duration, 15000);
		const packets: { name: string; data: string }[] = [];

		const listener = (data: unknown, meta: { name?: string }) => {
			const name = meta?.name ?? "unknown";
			if (NOISE_PACKETS.has(name)) return;
			if (filter && !name.includes(filter)) return;
			packets.push({ name, data: JSON.stringify(data).slice(0, 400) });
		};

		b.client.on("packet", listener);

		if (action) {
			try {
				writeFileSync(
					evalTmpFile,
					`export default async function(bot: any, state: any) { ${action} }\n`,
				);
				const mod = await import(`${evalTmpFile}?t=${Date.now()}`);
				await Promise.race([
					mod.default(b, syncFromBot(b)),
					new Promise((r) => setTimeout(r, ms)),
				]);
			} catch {}
		} else {
			await new Promise((r) => setTimeout(r, ms));
		}

		b.client.removeListener("packet", listener);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{ captured: packets.length, packets: packets.slice(0, 50) },
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 7: craft
server.tool(
	"craft",
	"Craft an item by name. Handles crafting table placement and recipe tag resolution.",
	{
		item: z
			.string()
			.describe("Item name (e.g. 'stick', 'iron_pickaxe', 'furnace')"),
		count: z.number().optional().describe("How many to craft (default 1)"),
	},
	async ({ item, count = 1 }) => {
		const b = await requireBot();
		const needsTable = ![
			"stick",
			"oak_planks",
			"spruce_planks",
			"birch_planks",
			"jungle_planks",
			"acacia_planks",
			"dark_oak_planks",
		].includes(item);
		let table = null;
		if (needsTable) {
			table = await getCraftingTable(b);
			if (!table)
				return {
					content: [
						{
							type: "text" as const,
							text: "ERROR: Could not get crafting table",
						},
					],
					isError: true,
				};
		}
		const result = await craftItem(b, item, count, table);
		const inv = windowItems(b.inventory).map((i) => `${i.name}x${i.count}`);
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ ...result, inventory: inv }, null, 2),
				},
			],
		};
	},
);

// Tool 8: navigate
server.tool(
	"navigate",
	"Go to coordinates or nearest block of a type. Uses pathfinder with raw-walk fallback.",
	{
		x: z.number().optional().describe("X coordinate"),
		y: z.number().optional().describe("Y coordinate"),
		z: z.number().optional().describe("Z coordinate"),
		block: z
			.string()
			.optional()
			.describe(
				"Block name to find and navigate to (e.g. 'water', 'coal_ore')",
			),
		range: z.number().optional().describe("How close to get (default 2)"),
		timeout: z.number().optional().describe("Max time in ms (default 15000)"),
	},
	async ({ x, y, z: zCoord, block, range: r = 2, timeout: t = 15000 }) => {
		const b = await requireBot();
		let target: { x: number; y: number; z: number } | null = null;
		if (block) {
			const found = findBlock(b, block, 128);
			if (!found)
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									reached: false,
									error: `No ${block} found within 128 blocks`,
								},
								null,
								2,
							),
						},
					],
				};
			target = found.position;
		} else if (x != null && y != null && zCoord != null) {
			target = { x, y, z: zCoord };
		} else {
			return {
				content: [
					{
						type: "text" as const,
						text: "ERROR: Provide x/y/z coordinates or a block name",
					},
				],
				isError: true,
			};
		}
		const { distance: dist } = await import("typecraft");
		const before = dist(b.entity.position, vec3(target.x, target.y, target.z));
		const reached = await goTo(b, vec3(target.x, target.y, target.z), {
			range: r,
			timeout: t,
		});
		const after = dist(b.entity.position, vec3(target.x, target.y, target.z));
		const pos = b.entity.position;
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							reached,
							distBefore: +before.toFixed(1),
							distAfter: +after.toFixed(1),
							position: {
								x: +pos.x.toFixed(1),
								y: +pos.y.toFixed(1),
								z: +pos.z.toFixed(1),
							},
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 9: mine
server.tool(
	"mine",
	"Mine N blocks of a type. Returns what was mined and inventory delta.",
	{
		block: z
			.string()
			.describe("Block type (e.g. 'stone', 'coal_ore', 'iron_ore')"),
		count: z.number().optional().describe("How many to mine (default 1)"),
	},
	async ({ block, count = 1 }) => {
		const b = await requireBot();
		const invBefore = windowItems(b.inventory).map((i) => ({
			name: i.name,
			count: i.count,
		}));
		const { mineBlock } = await import("./tasks/mining/main.ts");
		const result = await mineBlock(b, block, count);
		const invAfter = windowItems(b.inventory).map((i) => ({
			name: i.name,
			count: i.count,
		}));
		// Compute delta
		const beforeMap = new Map<string, number>();
		for (const i of invBefore)
			beforeMap.set(i.name, (beforeMap.get(i.name) ?? 0) + i.count);
		const afterMap = new Map<string, number>();
		for (const i of invAfter)
			afterMap.set(i.name, (afterMap.get(i.name) ?? 0) + i.count);
		const delta: Record<string, number> = {};
		for (const [name, cnt] of afterMap) {
			const diff = cnt - (beforeMap.get(name) ?? 0);
			if (diff !== 0) delta[name] = diff;
		}
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							...result,
							delta,
							inventory: invAfter.map((i) => `${i.name}x${i.count}`),
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 10: recipe
server.tool(
	"recipe",
	"Look up a crafting recipe. Shows ingredients needed and whether the bot has them.",
	{
		item: z
			.string()
			.describe("Item name to look up (e.g. 'iron_pickaxe', 'bucket')"),
	},
	async ({ item }) => {
		const b = await requireBot();
		const itemId = b.registry?.itemsByName.get(item)?.id;
		if (!itemId)
			return {
				content: [{ type: "text" as const, text: `Unknown item: ${item}` }],
				isError: true,
			};
		const recipes2x2 = b.recipesFor(itemId, null, 1, null);
		const recipes3x3 = b.recipesFor(itemId, null, 1, true);
		const allRecipes = [...recipes2x2, ...recipes3x3];
		if (allRecipes.length === 0)
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{ item, recipes: 0, message: "No recipe found" },
							null,
							2,
						),
					},
				],
			};
		const inv = windowItems(b.inventory);
		const results = allRecipes.map((r) => {
			const ingredients: { id: number; name: string; have: number }[] = [];
			const addIngredient = (id: number) => {
				if (id === -1) return;
				const def = b.registry?.itemsArray.find(
					(i: { id: number }) => i.id === id,
				);
				const name = def?.name ?? `id:${id}`;
				const have = inv
					.filter((i) => i.type === id)
					.reduce((s, i) => s + i.count, 0);
				if (!ingredients.some((i) => i.id === id))
					ingredients.push({ id, name, have });
			};
			if (r.inShape)
				for (const row of r.inShape)
					for (const cell of row) addIngredient(cell.id);
			if (r.ingredients) for (const ing of r.ingredients) addIngredient(ing.id);
			const canCraft = ingredients.every((i) => i.have > 0);
			return {
				requiresTable: r.inShape
					? r.inShape.length > 2 || (r.inShape[0]?.length ?? 0) > 2
					: false,
				ingredients,
				canCraft,
			};
		});
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ item, recipes: results }, null, 2),
				},
			],
		};
	},
);

// Tool 11: nearby
server.tool(
	"nearby",
	"Find specific blocks with distances, sorted nearest first.",
	{
		block: z.string().describe("Block name to search for"),
		radius: z.number().optional().describe("Search radius (default 64)"),
		count: z.number().optional().describe("Max results (default 10)"),
	},
	async ({ block, radius = 64, count = 10 }) => {
		const b = await requireBot();
		const { distance: dist } = await import("typecraft");
		const positions = findBlocks(b, block, radius, count * 2);
		const results = positions
			.map((p) => ({
				x: p.x,
				y: p.y,
				z: p.z,
				distance: +dist(b.entity.position, p).toFixed(1),
			}))
			.sort((a, c) => a.distance - c.distance)
			.slice(0, count);
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{ block, found: results.length, positions: results },
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 12: memory
server.tool(
	"memory",
	"Query or manage the bot's blockSeen memory. Shows remembered resource locations.",
	{
		block: z
			.string()
			.optional()
			.describe("Block name to query (omit for stats)"),
		action: z
			.enum(["query", "clear", "stats"])
			.optional()
			.describe("Action: query (default), clear, or stats"),
	},
	async ({ block, action = "query" }) => {
		const b = await requireBot();
		const mem = getMemory(b);
		if (action === "stats" || !block) {
			const stats: Record<string, number> = {};
			for (const [name, list] of mem.resources) stats[name] = list.length;
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								craftingTable: mem.craftingTablePos,
								resources: stats,
								total: Object.values(stats).reduce((s, n) => s + n, 0),
							},
							null,
							2,
						),
					},
				],
			};
		}
		if (action === "clear") {
			const list = mem.resources.get(block);
			const count = list?.length ?? 0;
			mem.resources.delete(block);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ cleared: block, count }, null, 2),
					},
				],
			};
		}
		// query
		const { distance: dist } = await import("typecraft");
		const list = mem.resources.get(block) ?? [];
		const nearest = getRememberedResource(b, block);
		const sorted = list
			.map((p) => ({
				...p,
				distance: +dist(b.entity.position, vec3(p.x, p.y, p.z)).toFixed(1),
			}))
			.sort((a, c) => a.distance - c.distance)
			.slice(0, 20);
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{ block, total: list.length, nearest, positions: sorted },
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 13: health
server.tool(
	"health",
	"Detailed vitals: HP, food, water status, Y level, held item, armor.",
	{},
	async () => {
		const b = await requireBot();
		const pos = b.entity.position;
		const below = b.blockAt(
			vec3(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z)),
		);
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							health: b.health,
							maxHealth: 20,
							food: b.food,
							position: {
								x: +pos.x.toFixed(1),
								y: +pos.y.toFixed(1),
								z: +pos.z.toFixed(1),
							},
							dimension: String(b.game?.dimension ?? "overworld"),
							inWater: !!b.entity?.isInWater,
							onGround: !!b.entity?.onGround,
							heldItem: b.heldItem?.name ?? "nothing",
							blockBelow: below?.name ?? "unknown",
							yLevel: Math.floor(pos.y),
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 14: replay
server.tool(
	"replay",
	"Query recent events from SQLite logs. Shows step progression, errors, mining results.",
	{
		count: z.number().optional().describe("Number of events (default 20)"),
		category: z
			.string()
			.optional()
			.describe(
				"Filter by category (e.g. 'step', 'mine', 'craft', 'lifecycle')",
			),
	},
	async ({ count = 20, category }) => {
		await requireBot(); // ensure connected
		try {
			const dbPath = getDbPath();
			if (!dbPath)
				return {
					content: [{ type: "text" as const, text: "No database initialized" }],
					isError: true,
				};
			const Database = (await import("better-sqlite3")).default;
			const db = new Database(dbPath, { readonly: true });
			const query = category
				? db
						.prepare(
							"SELECT ts, category, event, detail FROM events WHERE category = ? ORDER BY id DESC LIMIT ?",
						)
						.all(category, count)
				: db
						.prepare(
							"SELECT ts, category, event, detail FROM events ORDER BY id DESC LIMIT ?",
						)
						.all(count);
			db.close();
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(query, null, 2) },
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `DB error: ${err instanceof Error ? err.message : err}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Tool 15: equip
server.tool(
	"equip",
	"Equip best tool for a job. 'pickaxe' equips highest tier, or pass exact item name.",
	{
		item: z
			.string()
			.describe(
				"Tool type ('pickaxe', 'sword', 'bucket') or exact name ('stone_pickaxe')",
			),
	},
	async ({ item }) => {
		const b = await requireBot();
		const tierPriority: Record<string, string[]> = {
			pickaxe: [
				"diamond_pickaxe",
				"iron_pickaxe",
				"stone_pickaxe",
				"wooden_pickaxe",
			],
			sword: ["diamond_sword", "iron_sword", "stone_sword", "wooden_sword"],
		};
		const tiers = tierPriority[item];
		if (tiers) {
			for (const tier of tiers) {
				const success = await equipItem(b, tier, "hand");
				if (success) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify(
									{ equipped: tier, held: b.heldItem?.name },
									null,
									2,
								),
							},
						],
					};
				}
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{ equipped: null, error: `No ${item} in inventory` },
							null,
							2,
						),
					},
				],
			};
		}
		const success = await equipItem(b, item, "hand");
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{ equipped: success ? item : null, held: b.heldItem?.name },
						null,
						2,
					),
				},
			],
		};
	},
);

// Tool 16: world
server.tool(
	"world",
	"World state: time, dimension, entity count, phase, spawn point.",
	{},
	async () => {
		const b = await requireBot();
		const state = syncFromBot(b);
		const phase = getPhase(state);
		const entityCount = Object.keys(b.entities).length;
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							dimension: String(b.game?.dimension ?? "overworld"),
							time: (b.game as Record<string, unknown>)?.time ?? "unknown",
							phase,
							entityCount,
							position: {
								x: +b.entity.position.x.toFixed(0),
								y: +b.entity.position.y.toFixed(0),
								z: +b.entity.position.z.toFixed(0),
							},
							world: state.world,
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// ── Bootstrap ──

const main = async () => {
	try {
		await connectBot();
	} catch (err) {
		log("Failed to connect bot:", err);
	}

	const transport = new StdioServerTransport();
	await server.connect(transport);
	log("MCP server running on stdio");
};

main().catch((err) => {
	log("Fatal:", err);
	process.exit(1);
});
