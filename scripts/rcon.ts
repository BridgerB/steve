/**
 * One-shot RCON: run each argument as a command against the GYM_SERVER profile, print the
 * replies, exit.
 *   GYM_SERVER=local-1 node --env-file=.env --import ./typecraft-resolve.mjs scripts/rcon.ts "list" "tick query"
 */
import { applyServerProfile } from "../src/lib/steve/gym/server-profile.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

applyServerProfile();
const rcon = await connect({ timeout: 30_000 });
for (const cmd of process.argv.slice(2)) console.log(`> ${cmd}\n${await rcon.command(cmd)}`);
process.exit(0);
