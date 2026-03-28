/**
 * RCON client — re-exports from typecraft with steve defaults.
 */

import { createRcon, type RconOptions } from "typecraft";

export const connect = (
	options: RconOptions = {},
): ReturnType<typeof createRcon> =>
	createRcon({
		host: options.host ?? "localhost",
		port: options.port ?? 25575,
		password: options.password ?? "minecraft-test-rcon",
		...options,
	});
