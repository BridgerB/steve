/**
 * Interactive RCON CLI — connects to MC server and runs commands.
 * Usage: node src/rcon-cli.ts
 */

import { createInterface } from "node:readline";
import { connect } from "./lib/rcon.ts";

const rcon = await connect({
	host: process.env.MC_HOST ?? "localhost",
	port: parseInt(process.env.MC_RCON_PORT ?? "25575", 10),
	password: process.env.MC_RCON_PASS ?? "minecraft-test-rcon",
});

console.log("Connected. Type commands, Ctrl+C to quit.\n");

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
	prompt: "> ",
});
rl.prompt();

rl.on("line", async (line) => {
	const cmd = line.trim();
	if (!cmd) {
		rl.prompt();
		return;
	}
	const result = await rcon.command(cmd);
	if (result) console.log(result);
	rl.prompt();
});

rl.on("close", () => {
	rcon.close();
	process.exit(0);
});
