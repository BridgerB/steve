/**
 * Cycle 6, decision 6: the 2×2 craft against a scripted server that applies vanilla's
 * container rules to the packets the bot writes:
 *  - a click is applied only when its windowId is the container the server has open
 *    (otherwise it is ignored with no reply, as ServerGamePacketListenerImpl does);
 *  - after a click the server sends container_set_slot for every slot where its own state
 *    differs from what the client claimed (broadcastChanges), with a new stateId;
 *  - a login or respawn gives the player a fresh menu: nothing is open on the server.
 * Recipes are the two the race needs here: 1 log → 4 planks, 2 planks stacked → 4 sticks.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createItem, fromNotch, type Item, toNotch } from "../item/index.ts";
import type { Client } from "../protocol/index.ts";
import { createRegistry } from "../registry/index.ts";
import { acceptClick, createWindowFromType, type Window } from "../window/index.ts";
import { createBot } from "./index.ts";

const VERSION = "1.21.11";
const reg = createRegistry(VERSION);
const id = (name: string): number => reg.itemsByName.get(name)!.id;

type Packet = [string, Record<string, unknown>];

const scripted = () => {
	const emitter = new EventEmitter();
	const packets: Packet[] = [];
	const inv = createWindowFromType(reg, 0, "minecraft:inventory", "Inventory")!;
	let open: Window = inv; // the server's open menu
	let table: Window | null = null;
	let stateId = 1;
	const remote = new Map<Window, (Item | null)[]>(); // what the client was last told / claimed

	const send = (name: string, params: Record<string, unknown>) => queueMicrotask(() => emitter.emit(name, params));
	const result = (w: Window, n: number): Item | null => {
		const cells = Array.from({ length: n }, (_, i) => w.slots[i + 1] ?? null);
		const filled = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
		const side = Math.sqrt(n);
		if (filled.length === 1 && cells[filled[0]!]!.name.endsWith("_log")) return createItem(reg, id("oak_planks"), 4);
		if (
			filled.length === 2 &&
			filled.every((i) => cells[i]!.name.endsWith("_planks")) &&
			filled[1]! - filled[0]! === side
		)
			return createItem(reg, id("stick"), 4);
		return null;
	};
	const gridN = (w: Window): number => (w === inv ? 4 : 9);
	const sync = (w: Window) => {
		w.slots[0] = result(w, gridN(w));
		const r = remote.get(w) ?? [];
		stateId++;
		for (let i = 0; i < w.slots.length; i++) {
			const a = w.slots[i] ?? null;
			const b = r[i] ?? null;
			if (a?.type !== b?.type || a?.count !== b?.count) {
				send("container_set_slot", { windowId: w.id, stateId, slot: i, item: toNotch(reg, a) });
			}
		}
		remote.set(w, w.slots.map((s) => (s ? { ...s } : null)));
	};
	const fullState = (w: Window) => {
		w.slots[0] = result(w, gridN(w));
		stateId++;
		send("container_set_content", { windowId: w.id, stateId, items: w.slots.map((s) => toNotch(reg, s ?? null)), carriedItem: toNotch(reg, null) });
		remote.set(w, w.slots.map((s) => (s ? { ...s } : null)));
	};

	const write = (name: string, params: Record<string, unknown>) => {
		packets.push([name, params]);
		if (name === "container_close") {
			if (params.windowId === open.id && open !== inv) {
				// Closing a table returns its grid to the player (vanilla clearContainer).
				for (let s = 1; s <= 9; s++) {
					const it = open.slots[s];
					if (it) {
						const free = inv.slots.findIndex((x, i) => i >= 9 && i < 45 && !x);
						inv.slots[free] = it;
						open.slots[s] = null;
					}
				}
				open = inv;
			}
			return;
		}
		if (name !== "container_click") return;
		const w = params.windowId === open.id ? open : null;
		if (!w) return; // vanilla: a click for a menu that is not open is dropped, no reply
		// Apply the click to the server's own state. The result slot is special: taking it
		// consumes one item from every grid cell.
		const slot = params.slot as number;
		const before = w.slots[0];
		const claimed = new Map<number, Item | null>();
		for (const c of (params.changedSlots as { location: number; item: unknown }[]) ?? [])
			claimed.set(c.location, fromNotch(reg, c.item as never));
		if (slot === 0 && params.mode === 0) {
			if (before && !w.selectedItem) {
				w.selectedItem = before;
				for (let s = 1; s <= gridN(w); s++) {
					const it = w.slots[s];
					if (it) w.slots[s] = it.count > 1 ? { ...it, count: it.count - 1 } : null;
				}
			}
		} else {
			acceptClick(w, reg, { slot, mouseButton: params.mouseButton as number, mode: params.mode as number });
		}
		const r = remote.get(w) ?? w.slots.map(() => null);
		for (const [loc, item] of claimed) r[loc] = item;
		remote.set(w, r);
		sync(w);
	};

	const client = Object.assign(emitter, {
		packets,
		write,
		writeRaw: () => {},
		end: () => {},
		setSocket: () => {},
		setEncryption: () => {},
		setCompressionThreshold: () => {},
		registerChannel: () => {},
		writeChannel: () => {},
		unregisterChannel: () => {},
		autoVersionHooks: [],
		state: "play",
		username: "Gym_craft",
		uuid: "00000000-0000-0000-0000-000000000000",
		version: VERSION,
		protocolVersion: reg.version.version,
		socket: null,
	}) as unknown as Client & { packets: Packet[] };

	return {
		client,
		inv,
		give: (slot: number, name: string, count: number) => {
			inv.slots[slot] = createItem(reg, id(name), count);
		},
		/** Server-side state pushed to the client (login / resync). */
		pushInventory: () => fullState(inv),
		openTable: () => {
			table = createWindowFromType(reg, 7, "minecraft:crafting", "Crafting")!;
			for (let i = 9; i < 45; i++) table.slots[i + 1] = inv.slots[i] ?? null; // player rows follow the 3×3 grid
			open = table;
			send("open_screen", { windowId: 7, inventoryType: "minecraft:crafting", windowTitle: "Crafting" });
			fullState(table);
		},
		/** The player died and respawned: the server's menu is the inventory again. */
		respawn: () => {
			if (table) for (let i = 9; i < 45; i++) inv.slots[i] = table.slots[i + 1] ?? null;
			open = inv;
			send("respawn", {});
		},
		count: (name: string): number =>
			inv.slots.slice(9, 45).reduce((n, s) => n + (s && s.name === name ? s.count : 0), 0),
		gridEmpty: (): boolean => [1, 2, 3, 4].every((s) => !inv.slots[s]),
		clicksTo: (windowId: number): number =>
			packets.filter(([n, p]) => n === "container_click" && p.windowId === windowId).length,
	};
};

const flush = () => new Promise((r) => setTimeout(r, 5));

const setup = async () => {
	const srv = scripted();
	const bot = createBot({ username: "Gym_craft", version: VERSION, client: srv.client } as never);
	srv.client.emit("login", { entityId: 1, gameMode: 0, dimension: 0, maxPlayers: 20 });
	if (!bot.inventory) srv.client.emit("login", { entityId: 1, gameMode: 0, dimension: 0, maxPlayers: 20 });
	await flush();
	return { srv, bot };
};

const stickRecipe = (bot: ReturnType<typeof createBot>) => bot.recipesFor(id("stick"), null, 1, null)[0]!;

describe("2×2 craft (decision 6)", { timeout: 60_000 }, () => {
	it("crafts sticks into the server's inventory when nothing is open", async () => {
		const { srv, bot } = await setup();
		srv.give(36, "oak_planks", 8);
		srv.pushInventory();
		await flush();
		await bot.craft(stickRecipe(bot), 1);
		await flush();
		expect(srv.count("stick")).toBe(4);
		expect(srv.count("oak_planks")).toBe(6);
	});

	it("after walking away from an open table and dying, clicks go to window 0 and sticks are made", async () => {
		const { srv, bot } = await setup();
		srv.give(36, "oak_planks", 8);
		srv.pushInventory();
		await flush();
		srv.openTable();
		await flush();
		expect(bot.currentWindow?.id).toBe(7);
		srv.respawn(); // the server dropped the table; no container_close is sent
		await flush();
		srv.pushInventory();
		await flush();
		await bot.craft(stickRecipe(bot), 1);
		await flush();
		expect(srv.clicksTo(7)).toBe(0);
		expect(srv.count("stick")).toBe(4);
	});

	it("closes a still-open table before a 2×2 craft instead of clicking its 3×3 slots", async () => {
		const { srv, bot } = await setup();
		srv.give(36, "oak_planks", 8);
		srv.pushInventory();
		await flush();
		srv.openTable();
		await flush();
		await bot.craft(stickRecipe(bot), 1);
		await flush();
		expect(srv.clicksTo(7)).toBe(0);
		expect(srv.client.packets.some(([n, p]) => n === "container_close" && p.windowId === 7)).toBe(true);
		expect(srv.count("stick")).toBe(4);
	});

	it("keeps planks the server holds in the grid visible and reclaims them (race c5 808)", async () => {
		const { srv, bot } = await setup();
		srv.give(36, "oak_planks", 7);
		srv.inv.slots[2] = createItem(reg, id("oak_planks"), 1); // left by an interrupted craft
		srv.pushInventory();
		await flush();
		expect(bot.inventory.slots[2]?.name).toBe("oak_planks");
		await bot.craft(stickRecipe(bot), 1);
		await flush();
		expect(srv.count("stick")).toBe(4);
		expect(srv.gridEmpty()).toBe(true);
	});

	it("serializes two crafts started at once (no interleaved clicks, no junk results)", async () => {
		const { srv, bot } = await setup();
		srv.give(36, "oak_log", 2);
		srv.pushInventory();
		await flush();
		const planks = bot.recipesFor(id("oak_planks"), null, 1, null).find((r) => r.ingredients?.some((i) => i.id === id("oak_log") || i.choices?.includes(id("oak_log"))))!;
		await Promise.all([bot.craft(planks, 1), bot.craft(planks, 1)]);
		await flush();
		expect(srv.count("oak_planks")).toBe(8);
		expect(srv.count("oak_log")).toBe(0);
		expect(srv.gridEmpty()).toBe(true);
	});
});
