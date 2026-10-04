// Run one RCON command against Server A (env from the gym's .env): node --env-file=.env rcon-cmd.ts "<cmd>"
import { connect } from "../../src/lib/steve/lib/rcon.ts";
const rcon = await connect({ timeout: 30_000 });
console.log(await rcon.command(process.argv.slice(2).join(" ")));
await rcon.close?.();
