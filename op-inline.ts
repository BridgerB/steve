import { connect } from "./src/lib/steve/lib/rcon.ts";

const client = await connect();
console.log("op InlineBot →", await client.command("op InlineBot"));
client.close();
process.exit(0);
