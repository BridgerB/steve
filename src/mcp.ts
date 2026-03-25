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
import { rememberResource } from "./lib/bot-utils.ts";
import { syncFromBot } from "./state.ts";

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
