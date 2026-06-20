/**
 * RCON client — re-exports from typecraft with steve defaults.
 */

import { createRcon, type RconOptions } from "typecraft";

export const connect = (
	options: RconOptions = {},
): ReturnType<typeof createRcon> =>
	createRcon({
		// RCON is usually not exposed publicly, so it can target a different host
		// than the game connection (e.g. an SSH tunnel on 127.0.0.1) via
		// MC_RCON_HOST, falling back to MC_HOST then localhost.
		host:
			options.host ??
			process.env.MC_RCON_HOST ??
			process.env.MC_HOST ??
			"localhost",
		port: options.port ?? 25575,
		password: options.password ?? "minecraft-test-rcon",
		...options,
	});
