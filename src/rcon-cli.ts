/**
 * Interactive RCON CLI — connects to MC server and runs commands.
 * Retries connection until server is ready.
 * Usage: node src/rcon-cli.ts
 */

import { createInterface } from "node:readline";
import { connect } from "./lib/rcon.ts";

const tryConnect = async (): Promise<Awaited<ReturnType<typeof connect>>> => {
	for (let i = 1; ; i++) {
		try {
			return await connect({
				host: process.env.MC_HOST ?? "localhost",
				port: parseInt(process.env.MC_RCON_PORT ?? "25575", 10),
				password: process.env.MC_RCON_PASS ?? "minecraft-test-rcon",
			});
		} catch {
			process.stdout.write(`\rWaiting for RCON... (attempt ${i})`);
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
};

const rcon = await tryConnect();
console.log("\nConnected. Type commands, Ctrl+C to quit.\n");

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
