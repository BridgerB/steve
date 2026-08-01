import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { Client } from "../protocol/index.ts";
import {
	clamp,
	createBot,
	createDoneTask,
	createTask,
	fromNotchianPitch,
	fromNotchianYaw,
	fromNotchVelocity,
	once,
	sleep,
	toDegrees,
	toNotchianPitch,
	toNotchianYaw,
	toRadians,
	withTimeout,
} from "./index.ts";

// ── Mock client factory ──

const createMockClient = (): Client & { packets: [string, unknown][] } => {
	const emitter = new EventEmitter();
	const packets: [string, unknown][] = [];
	return Object.assign(emitter, {
		packets,
		write: (name: string, params: Record<string, unknown>) => {
			packets.push([name, params]);
		},
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
		username: "TestBot",
		uuid: "00000000-0000-0000-0000-000000000000",
		version: "1.20.4",
		protocolVersion: 765,
		socket: null,
	}) as unknown as Client & { packets: [string, unknown][] };
};

// ── Conversions ──

describe("conversions", () => {
	it("toRadians / toDegrees roundtrip", () => {
		expect(toDegrees(toRadians(90))).toBeCloseTo(90);
		expect(toDegrees(toRadians(180))).toBeCloseTo(180);
		expect(toDegrees(toRadians(360))).toBeCloseTo(360);
	});

	it("fromNotchianYaw / toNotchianYaw roundtrip", () => {
		const yawDeg = 45;
		const radians = fromNotchianYaw(yawDeg);
		const back = toNotchianYaw(radians);
		expect(back).toBeCloseTo(yawDeg);
	});

	it("fromNotchianPitch / toNotchianPitch roundtrip", () => {
		const pitchDeg = -30;
		const radians = fromNotchianPitch(pitchDeg);
		const back = toNotchianPitch(radians);
		expect(back).toBeCloseTo(pitchDeg);
	});

	it("fromNotchianYaw returns value in [0, 2π)", () => {
		const yaw = fromNotchianYaw(0);
		expect(yaw).toBeGreaterThanOrEqual(0);
		expect(yaw).toBeLessThan(2 * Math.PI);
	});

	it("fromNotchVelocity divides by 8000", () => {
		const vel = fromNotchVelocity({ x: 8000, y: -8000, z: 16000 });
		expect(vel.x).toBeCloseTo(1);
		expect(vel.y).toBeCloseTo(-1);
		expect(vel.z).toBeCloseTo(2);
	});

	it("fromNotchVelocity zero", () => {
		const vel = fromNotchVelocity({ x: 0, y: 0, z: 0 });
		expect(vel.x).toBe(0);
		expect(vel.y).toBe(0);
		expect(vel.z).toBe(0);
	});
});

// ── Utils ──

describe("utils", () => {
	describe("sleep", () => {
		it("resolves after delay", async () => {
			const start = Date.now();
			await sleep(50);
			expect(Date.now() - start).toBeGreaterThanOrEqual(40);
		});
	});

	describe("clamp", () => {
		it("clamps value below min", () => {
			expect(clamp(0, -5, 10)).toBe(0);
		});

		it("clamps value above max", () => {
			expect(clamp(0, 15, 10)).toBe(10);
		});

		it("returns value within range", () => {
			expect(clamp(0, 5, 10)).toBe(5);
		});
	});

	describe("createTask", () => {
		it("resolves when finish is called", async () => {
			const task = createTask<number>();
			task.finish(42);
			expect(await task.promise).toBe(42);
		});

		it("rejects when cancel is called", async () => {
			const task = createTask<number>();
			task.cancel(new Error("cancelled"));
			await expect(task.promise).rejects.toThrow("cancelled");
		});

		it("only resolves once", async () => {
			const task = createTask<number>();
			task.finish(1);
			task.finish(2);
			expect(await task.promise).toBe(1);
		});
	});

	describe("createDoneTask", () => {
		it("returns already-resolved task", async () => {
			const task = createDoneTask(42);
			expect(await task.promise).toBe(42);
		});
	});

	describe("once", () => {
		it("resolves on event", async () => {
			const emitter = new EventEmitter();
			const p = once(emitter, "test", 1000);
			emitter.emit("test", "hello", 42);
			const [a, b] = await p;
			expect(a).toBe("hello");
			expect(b).toBe(42);
		});

		it("rejects on timeout", async () => {
			const emitter = new EventEmitter();
			await expect(once(emitter, "test", 50)).rejects.toThrow("timeout");
		});

		it("cleans up listener after resolve", async () => {
			const emitter = new EventEmitter();
			const p = once(emitter, "test", 1000);
			emitter.emit("test", "data");
			await p;
			// .finally() cleanup runs in a microtask after resolve
			await new Promise((r) => setTimeout(r, 10));
			expect(emitter.listenerCount("test")).toBe(0);
		});
	});

	describe("withTimeout", () => {
		it("resolves if promise finishes in time", async () => {
			const result = await withTimeout(Promise.resolve(42), 1000);
			expect(result).toBe(42);
		});

		it("rejects if timeout expires", async () => {
			const slow = new Promise((resolve) => setTimeout(resolve, 1000));
			await expect(withTimeout(slow, 50)).rejects.toThrow("timed out");
		});
	});
});

// ── createBot ──

describe("createBot", () => {
	it("creates bot with mock client", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		expect(bot.username).toBe("TestBot");
		expect(bot.client).toBe(client);
		expect(bot.health).toBe(20);
		expect(bot.food).toBe(20);
		expect(bot.game.gameMode).toBe("survival");
		expect(bot.game.dimension).toBe("overworld");
		expect(bot.controlState.forward).toBe(false);
		expect(bot.quickBarSlot).toBe(0);
	});

	it("sets default settings", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		expect(bot.settings.chat).toBe("enabled");
		expect(bot.settings.colorsEnabled).toBe(true);
		expect(bot.settings.viewDistance).toBe("far");
		expect(bot.settings.mainHand).toBe("right");
	});

	it("respects custom settings", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
			chat: "commandsOnly",
			viewDistance: "short",
			mainHand: "left",
		} as never);

		expect(bot.settings.chat).toBe("commandsOnly");
		expect(bot.settings.viewDistance).toBe("short");
		expect(bot.settings.mainHand).toBe("left");
	});
});

// ── Game init ──

describe("initGame", () => {
	it("updates game state on login packet", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		const events: string[] = [];
		bot.on("login", () => events.push("login"));
		bot.on("game", () => events.push("game"));

		client.emit("login", {
			entityId: 42,
			gameMode: 1,
			dimension: 0,
			maxPlayers: 20,
			levelType: "default",
			difficulty: 2,
		});

		expect(events).toContain("login");
		expect(events).toContain("game");
		expect(bot.game.maxPlayers).toBe(20);
	});

	it("responds to ping with pong", () => {
		const client = createMockClient();
		createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("ping", { id: 12345 });

		const pong = (client as ReturnType<typeof createMockClient>).packets.find(
			([name]) => name === "pong",
		);
		expect(pong).toBeDefined();
		expect((pong![1] as Record<string, unknown>).id).toBe(12345);
	});
});

// ── Status ──

describe("initStatus", () => {
	it("updates health/food on set_health", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		let healthEmitted = false;
		bot.on("health", () => {
			healthEmitted = true;
		});

		client.emit("set_health", {
			health: 15,
			food: 18,
			foodSaturation: 3,
		});

		expect(bot.health).toBe(15);
		expect(bot.food).toBe(18);
		expect(bot.foodSaturation).toBe(3);
		expect(healthEmitted).toBe(true);
	});

	it("emits spawn on first health update if alive", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		let spawned = false;
		bot.on("spawn", () => {
			spawned = true;
		});

		client.emit("set_health", {
			health: 20,
			food: 20,
			foodSaturation: 5,
		});

		expect(spawned).toBe(true);
	});

	it("emits death when health drops to 0", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
			respawn: false,
		} as never);

		let died = false;
		bot.on("death", () => {
			died = true;
		});

		// First update alive
		client.emit("set_health", { health: 20, food: 20, foodSaturation: 5 });
		// Second update dead
		client.emit("set_health", { health: 0, food: 20, foodSaturation: 5 });

		expect(died).toBe(true);
	});

	it("updates experience", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("set_experience", {
			experienceBar: 0.5,
			level: 10,
			totalExperience: 1000,
		});

		expect(bot.experience.level).toBe(10);
		expect(bot.experience.points).toBe(1000);
		expect(bot.experience.progress).toBe(0.5);
	});
});

// ── Chat ──

describe("initChat", () => {
	it("emits message on chat packet", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		// Simulate login to set registry
		client.emit("login", {
			entityId: 1,
			gameMode: 0,
			dimension: 0,
			maxPlayers: 20,
		});

		let messageText = "";
		bot.on("messagestr", (text: string) => {
			messageText = text;
		});

		client.emit("chat", {
			message: JSON.stringify({ text: "Hello world" }),
			position: "0",
		});

		expect(messageText).toBe("Hello world");
	});

	it("sends chat message via bot.chat()", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		bot.chat("Hello server!");

		// 1.20.4 (protocol 765) uses chat for regular messages
		const chatPacket = (
			client as ReturnType<typeof createMockClient>
		).packets.find(([name]) => name === "chat");
		expect(chatPacket).toBeDefined();
		expect((chatPacket![1] as Record<string, unknown>).message).toBe(
			"Hello server!",
		);
	});

	it("sends whisper via /tell", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		bot.whisper("OtherPlayer", "secret message");

		// Whisper uses /tell which is a command → chat_command
		const chatPacket = (
			client as ReturnType<typeof createMockClient>
		).packets.find(([name]) => name === "chat_command");
		expect(chatPacket).toBeDefined();
		expect((chatPacket![1] as Record<string, unknown>).command).toBe(
			"tell OtherPlayer secret message",
		);
	});

	it("matches default chat patterns", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		// Set registry
		client.emit("login", {
			entityId: 1,
			gameMode: 0,
			dimension: 0,
			maxPlayers: 20,
		});

		let chatUsername = "";
		let chatMessage = "";
		bot.on("chat", (username: string, message: string) => {
			chatUsername = username;
			chatMessage = message;
		});

		client.emit("chat", {
			message: JSON.stringify({ text: "<Player1> Hello everyone" }),
			position: "0",
		});

		expect(chatUsername).toBe("Player1");
		expect(chatMessage).toBe("Hello everyone");
	});
});

// ── World state ──

describe("initWorldState", () => {
	it("updates time on set_time", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("set_time", {
			gameTime: 24000n,
			clocks: [{ clock: 0, time: 6000n, rate: 1, phase: 0 }],
		});

		expect(bot.time.age).toBe(24000);
		expect(bot.time.timeOfDay).toBe(6000);
		expect(bot.time.isDay).toBe(true);
	});

	it("detects night time", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("set_time", {
			gameTime: 48000n,
			clocks: [{ clock: 0, time: 18000n, rate: 1, phase: 0 }],
		});

		expect(bot.time.timeOfDay).toBe(18000);
		expect(bot.time.isDay).toBe(false);
	});

	it("updates spawn point", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("set_default_spawn_position", {
			location: { x: 100, y: 64, z: 200 },
		});

		expect(bot.spawnPoint.x).toBe(100);
		expect(bot.spawnPoint.y).toBe(64);
		expect(bot.spawnPoint.z).toBe(200);
	});
});

// ── Social ──

describe("initSocial", () => {
	it("creates scoreboard on set_objective", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		let created = false;
		bot.on("scoreboardCreated", () => {
			created = true;
		});

		client.emit("set_objective", {
			name: "kills",
			action: 0,
			displayText: "Kills",
		});

		expect(bot.scoreboards.kills).toBeDefined();
		expect(bot.scoreboards.kills.title).toBe("Kills");
		expect(created).toBe(true);
	});

	it("creates and removes teams", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		// Create team
		client.emit("set_player_team", {
			team: "red",
			mode: 0,
			players: ["Player1", "Player2"],
		});

		expect(bot.teams.red).toBeDefined();
		expect(bot.teams.red.members).toContain("Player1");
		expect(bot.teamMap.Player1).toBe(bot.teams.red);

		// Remove team
		client.emit("set_player_team", { team: "red", mode: 1 });

		expect(bot.teams.red).toBeUndefined();
		expect(bot.teamMap.Player1).toBeUndefined();
	});

	it("handles boss bar create and update", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("boss_event", {
			entityUUID: "uuid-123",
			action: 0,
			title: JSON.stringify({ text: "Ender Dragon" }),
			health: 1.0,
			color: 0,
			dividers: 0,
			flags: 0,
		});

		expect(bot.bossBars["uuid-123"]).toBeDefined();
		expect(bot.bossBars["uuid-123"].health).toBe(1.0);

		// Update health
		client.emit("boss_event", {
			entityUUID: "uuid-123",
			action: 2,
			health: 0.5,
		});

		expect(bot.bossBars["uuid-123"].health).toBe(0.5);
	});
});

// ── Inventory ──

describe("initInventory", () => {
	it("creates inventory on login", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("login", {
			entityId: 1,
			gameMode: 0,
			dimension: 0,
			maxPlayers: 20,
		});

		expect(bot.inventory).toBeDefined();
		expect(bot.inventory.id).toBe(0);
	});

	it("updates held item on set_held_slot", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		client.emit("set_held_slot", { slot: 3 });

		expect(bot.quickBarSlot).toBe(3);
	});

	it("sends set_carried_item on setQuickBarSlot", () => {
		const client = createMockClient();
		const bot = createBot({
			username: "TestBot",
			version: "1.20.4",
			client,
		} as never);

		bot.setQuickBarSlot(5);

		expect(bot.quickBarSlot).toBe(5);
		const packet = (client as ReturnType<typeof createMockClient>).packets.find(
			([name]) => name === "set_carried_item",
		);
		expect(packet).toBeDefined();
	});
});
