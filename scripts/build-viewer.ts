import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build, context } from "esbuild";

// Bundle the vendored Babylon viewer client straight into static/web/.
//   viewer.js — mountViewer (src/lib/typecraft/web/embed.ts), SSE-based
//   worker.js — chunk-mesher web worker (src/lib/typecraft/web/clientWorker.ts)
const root = resolve(import.meta.dirname, "..");
const src = resolve(root, "src/lib/typecraft/web");
const outdir = resolve(root, "static/web");
const watch = process.argv.includes("--watch");

mkdirSync(outdir, { recursive: true });

const shared = {
	bundle: true,
	platform: "browser" as const,
	format: "esm" as const,
	sourcemap: true,
	treeShaking: true,
	inject: [resolve(root, "scripts/buffer-shim.ts")],
	define: { "process.env.NODE_ENV": '"production"' },
	loader: { ".ts": "ts" as const },
};

const buildAll = async () => {
	await Promise.all([
		build({ ...shared, entryPoints: [resolve(src, "embed.ts")], outfile: resolve(outdir, "viewer.js") }),
		build({ ...shared, entryPoints: [resolve(src, "clientWorker.ts")], outfile: resolve(outdir, "worker.js") }),
	]);
	console.log("Built static/web/ (viewer.js, worker.js)");
};

if (watch) {
	const ctx = await context({ ...shared, entryPoints: [resolve(src, "embed.ts"), resolve(src, "clientWorker.ts")], outdir, splitting: false });
	await ctx.watch();
	console.log("Watching for changes...");
} else {
	await buildAll();
}
