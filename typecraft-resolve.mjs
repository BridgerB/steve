// Lets plain `node` resolve the bare `typecraft` specifier (vendored at
// src/lib/typecraft) — the node-side mirror of the vite alias in vite.config.ts.
// Use: node --import ./typecraft-resolve.mjs <script.ts>
import { registerHooks } from 'node:module';

const TYPECRAFT = new URL('./src/lib/typecraft/index.ts', import.meta.url).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'typecraft') return { url: TYPECRAFT, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
