/**
 * World state — time, weather, spawn point.
 * Combines upstream rain.js, time.js, spawn_point.js.
 */

import { vec3 } from "../vec3/index.ts";
import type { Bot, BotOptions } from "./types.ts";

export const initWorldState = (bot: Bot, _options: BotOptions): void => {
	// ── Time ──

	bot.client.on("set_time", (packet: Record<string, unknown>) => {
		// 26.1.2: { gameTime: i64, clocks: [{ clock, time(varlong), rate, phase }] }.
		// Game-time-only updates carry no clocks; day time lives in the clock.
		const gameTime = packet.gameTime as bigint | number | undefined;
		const bigAge =
			gameTime == null
				? (bot.time?.bigAge ?? 0n)
				: typeof gameTime === "bigint"
					? gameTime
					: BigInt(gameTime);

		const clocks = (packet.clocks as Array<Record<string, unknown>>) ?? [];
		const clock = clocks[0];

		if (clock) {
			const ct = clock.time as bigint | number | undefined;
			const bigTime = ct == null ? 0n : typeof ct === "bigint" ? ct : BigInt(ct);
			const doDaylightCycle = Number(clock.rate ?? 0) !== 0;
			const absTime = bigTime < 0n ? -bigTime : bigTime;

			bot.time = {
				doDaylightCycle,
				bigTime: absTime,
				time: Number(absTime),
				timeOfDay: Number(absTime % 24000n),
				day: Number(absTime / 24000n),
				isDay: Number(absTime % 24000n) < 13000,
				moonPhase: Number(absTime / 24000n) % 8,
				bigAge,
				age: Number(bigAge),
			};
		} else if (bot.time) {
			// Game-time-only tick: keep day time, refresh age.
			bot.time = { ...bot.time, bigAge, age: Number(bigAge) };
		} else {
			bot.time = {
				doDaylightCycle: true,
				bigTime: 0n,
				time: 0,
				timeOfDay: 0,
				day: 0,
				isDay: true,
				moonPhase: 0,
				bigAge,
				age: Number(bigAge),
			};
		}

		bot.emit("time");
	});

	// ── Rain / weather ──

	bot.client.on("game_event", (packet: Record<string, unknown>) => {
		const reason = packet.reason as number | string;
		const value = packet.gameMode as number;

		// Rain start
		if (reason === 1 || reason === "begin_raining") {
			bot.isRaining = true;
			bot.emit("rain");
		}
		// Rain stop
		if (reason === 2 || reason === "end_raining") {
			bot.isRaining = false;
			bot.emit("rain");
		}
		// Thunder level
		if (reason === 7 || reason === "thunder_level_change") {
			bot.thunderState = value;
			bot.emit("rain");
		}
		// Rain level
		if (reason === 8 || reason === "rain_level_change") {
			// Rain level, used for transition
		}
	});

	// ── Spawn point ──

	bot.client.on(
		"set_default_spawn_position",
		(packet: Record<string, unknown>) => {
			const loc = packet.location as Record<string, number>;
			if (loc) {
				bot.spawnPoint = vec3(loc.x!, loc.y!, loc.z!);
				bot.emit("spawnReset");
			}
		},
	);
};
