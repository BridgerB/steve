/**
 * RCON client — re-exports from typecraft with steve defaults.
 */

import { createRcon, type RconOptions } from "typecraft";

/** The RCON password from MC_RCON_PASS. No fallback: a known default was public for months. */
export const rconPassword = (): string => {
	const p = process.env.MC_RCON_PASS;
	if (!p) throw new Error("MC_RCON_PASS is not set (put it in .env; local servers write theirs to data/local-server/rcon-<n>.pass)");
	return p;
};

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
		port: options.port ?? parseInt(process.env.MC_RCON_PORT ?? "25575", 10),
		password: options.password ?? rconPassword(),
		...options,
	});
