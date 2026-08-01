import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { autoPort } from '@bridgerb/port-from-name';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	// Vendored steve imports `typecraft` as a bare specifier (33 files); map it to
	// the copy now living in src/lib/typecraft so we don't rewrite every import.
	resolve: {
		alias: {
			typecraft: fileURLToPath(new URL('./src/lib/typecraft/index.ts', import.meta.url))
		}
	},
	server: {
		host: '0.0.0.0'
		// Per-bot 3D streams are now served by the SvelteKit route /viewer/[id]
		// (Server-Sent Events) — no port proxy, no separate viewer servers.
	},
	plugins: [
		// Stable, name-derived dev/preview port (eye-of-steve → 4558) so it never
		// collides with the other vite projects on this machine.
		autoPort({ strictPort: true }),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			typescript: {
				config: (config) => ({
					...config,
					include: [...config.include, '../drizzle.config.ts']
				})
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
