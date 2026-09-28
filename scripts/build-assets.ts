/**
 * Precompute the viewer `assets` blob (block states/models, textures as base64,
 * biome tints, entity models) and write it to static/web/assets.json.
 *
 * On Cloudflare the ~15MB assets message can't stream through the relay (WS 1MB
 * cap), so the browser fetches this file statically instead. It's derived from a
 * live bot's registry + the vendored typecraft data dir, so this connects a
 * throwaway bot once to generate it.
 *
 *   node --env-file=.env --import ./typecraft-resolve.mjs scripts/build-assets.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createBot } from "typecraft";
import { loadMcAssets } from "../src/lib/typecraft/web/serve.ts";

const bot = createBot({
	host: process.env.MC_HOST ?? "localhost",
	port: Number(process.env.MC_PORT ?? 25565),
	username: process.env.MC_USERNAME ?? "AssetGen",
	version: process.env.MC_VERSION ?? "1.21.11",
	auth: "offline",
	viewDistance: 6,
});

const done = (code: number) => {
	try {
		bot.end();
	} catch {}
	process.exit(code);
};

bot.once("spawn", () => {
	// Give the registry a beat to settle after spawn.
	setTimeout(() => {
		try {
			const assets = loadMcAssets(bot.version, bot);
			const json = JSON.stringify({ type: "assets", ...assets });
			mkdirSync("static/web", { recursive: true });
			writeFileSync("static/web/assets.json", json);
			console.log(`wrote static/web/assets.json (${(json.length / 1e6).toFixed(1)} MB)`);
			done(0);
		} catch (e) {
			console.error("asset build failed:", e instanceof Error ? e.message : e);
			done(1);
		}
	}, 2000);
});

setTimeout(() => {
	console.error("timed out waiting for spawn");
	done(1);
}, 30000);
