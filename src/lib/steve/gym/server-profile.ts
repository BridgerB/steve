/**
 * Gym server profiles (cycle 6, decision 4). GYM_SERVER picks where a gym connects:
 *   box-a    the shared box's Server A, as configured in .env (races only from cycle 6)
 *   local-1  local-server.sh 1 on this machine: game 25569, RCON 25579
 *   local-2  local-server.sh 2: game 25570, RCON 25580
 *   runner   a GitHub runner's own server: 127.0.0.1, RUNNER_MC_PORT / RUNNER_RCON_PORT, RUNNER_RCON_PASS
 * The profile overwrites MC_HOST / MC_PORT / MC_RCON_HOST / MC_RCON_PORT in process.env, so
 * the gym-cli children inherit it (node --env-file never overrides a variable already set).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROFILES: Record<string, { host: string; port: number; rconPort: number } | null> = {
	"box-a": null,
	"local-1": { host: "127.0.0.1", port: 25569, rconPort: 25579 },
	"local-2": { host: "127.0.0.1", port: 25570, rconPort: 25580 },
	runner: { host: "127.0.0.1", port: Number(process.env.RUNNER_MC_PORT ?? 25565), rconPort: Number(process.env.RUNNER_RCON_PORT ?? 25575) },
};

export const applyServerProfile = (): string => {
	const name = process.env.GYM_SERVER ?? "box-a";
	if (!(name in PROFILES)) throw new Error(`GYM_SERVER=${name}: unknown profile (${Object.keys(PROFILES).join(", ")})`);
	const p = PROFILES[name];
	if (p) {
		process.env.MC_HOST = p.host;
		process.env.MC_PORT = String(p.port);
		process.env.MC_RCON_HOST = p.host;
		process.env.MC_RCON_PORT = String(p.rconPort);
	}
	if (name === "runner" && process.env.RUNNER_RCON_PASS) process.env.MC_RCON_PASS = process.env.RUNNER_RCON_PASS;
	// A local server's password is the one local-server.sh generated (data/local-server/rcon-<n>.pass),
	// never the box password from .env.
	const local = /^local-(\d)$/.exec(name);
	if (local) {
		const file = new URL(`../../../../data/local-server/rcon-${local[1]}.pass`, import.meta.url);
		if (!existsSync(file)) throw new Error(`${fileURLToPath(file)} missing: start the server with ./local-server.sh ${local[1]}`);
		process.env.MC_RCON_PASS = readFileSync(file, "utf8").trim();
	}
	process.env.GYM_SERVER = name;
	return `${name} (${process.env.MC_HOST ?? "localhost"}:${process.env.MC_PORT ?? "25565"}, rcon ${process.env.MC_RCON_PORT ?? "25575"})`;
};

// Arena slugs build their own lava pool only when GYM_LAVA_D is set; without it they run as
// a single natural dispatch (cycle 5: s10a and s11a were launched that way and misread).
export const ARENA_SLUGS = new Set(["build-nether-portal"]);
export const NATURAL_SLUGS = new Set(["portal-natural"]);

/** The batch header check: an arena slug needs GYM_LAVA_D, a natural slug must not have it. */
export const headerError = (slug: string, lavaD: string | undefined): string | null => {
	const arena = Number(lavaD ?? 0) > 0;
	if (ARENA_SLUGS.has(slug) && !arena) return `${slug} is an arena slug but GYM_LAVA_D is not set`;
	if (NATURAL_SLUGS.has(slug) && arena) return `${slug} is a natural slug but GYM_LAVA_D=${lavaD} is set`;
	return null;
};
