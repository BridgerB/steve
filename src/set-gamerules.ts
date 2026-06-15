/**
 * Apply server-level gamerules after a fresh world. Gamerules are per-world and
 * the world is wiped each launch, so this re-applies them. Run after the server
 * is ready (RCON up). NOTE: MC 26.x uses snake_case rule names — keep_inventory,
 * not keepInventory (the camelCase names are rejected by the command parser).
 */
import { connect } from "./lib/rcon.ts";

const RULES: ReadonlyArray<readonly [string, string]> = [
	["keep_inventory", "true"],
];

const r = await connect();
for (const [rule, value] of RULES) {
	console.log(await r.command(`gamerule ${rule} ${value}`));
}
r.close();
process.exit(0);
