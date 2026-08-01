# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`eye-of-steve` is the live web dashboard for **steve** races (the autonomous Ender-Dragon speedrun bot, a sibling submodule under `mc/upstream/`). It renders a grid of how far each racing bot has progressed through the 30-step speedrun chain, plus live 3D views of individual bots. It is read-only: the bots write race telemetry to a shared Postgres DB, and this app reads and shapes that data — it never controls the bots.

SvelteKit 5 (Svelte 5 runes, forced on for all non-`node_modules` files via `vite.config.ts`), `@sveltejs/adapter-node`, raw Postgres via the `postgres` driver.

## Commands

```bash
npm run dev            # vite dev server (binds 0.0.0.0 so it's tunnelable)
npm run build          # production build (adapter-node)
npm run preview        # preview the production build
npm run check          # svelte-kit sync && svelte-check (type-check)
npm run test           # vitest unit (--run) + playwright e2e
npm run test:unit      # vitest only; append `-- --run` for one-shot, or a path to scope
npm run test:e2e       # playwright (installs browsers first)
npm run sync-viewer    # rebuild the typecraft Babylon viewer bundle → static/web/
```

There is no `npm run lint`. Type-checking is `npm run check`.

`DATABASE_URL` (shared Postgres, see `.env.example`) is required — both `db/index.ts` and `race.ts` throw without it. `.env` is gitignored.

## Architecture

**The dashboard reads tables it does not own.** The Drizzle schema (`src/lib/server/db/schema.ts`) is a near-empty scaffolder stub (`task` table) and is **not** what the dashboard renders. The real data lives in tables written by the steve bots — `events`, `ticks`, `inventory_snapshots` — and is read with **raw tagged-template SQL** in `src/lib/server/race.ts`, not through Drizzle. `drizzle.config.ts` / `db:*` scripts exist but are essentially vestigial here; don't reach for Drizzle to add a dashboard query — extend the raw SQL in `race.ts`.

**Data flow:** `+page.server.ts` `load` → `getRaceData()` (`race.ts`) → the page polls `invalidateAll()` every ~5s, re-running `load` for live updates. `getRaceData` picks the latest non-`mcp%` `race_id`, then derives per-bot progress: `events` rows (`category='step'`, events `start`/`success`) map to step indices via `STEP_IDX`, the latest `ticks` row gives position/health/dimension, and the newest `inventory_snapshots` timestamp gives the current inventory. The interactive steve-mcp bot logs into the same DB under an `mcp-…` race_id and is deliberately excluded from the main dashboard (it has its own `/mcp` page).

**`src/lib/steps.ts` is a hand-mirrored copy** of steve's 30-step chain (names + order) plus per-step Minecraft icon paths. It is intentionally *not* imported across packages — kept as a stable flat list. If steve's step names/order change, this must be updated by hand or the grid mislabels. `STEP_IDX` maps name→index; `GOAL` (Enter Nether, 18) and `IRON` (Mine Iron Ore, 10) are highlighted milestones.

**Routes:**
- `/` — the race grid (`+page.svelte`): steps × bots table, elapsed timer, 🥇 leader highlight (earliest completion per step), plus a row of live `BotWindow` thumbnails.
- `/[slug]` — fullscreen single-bot view; `slug` is the bot id. Resolves the bot's index in the sorted race list to find its viewer stream.
- `/mcp` — dedicated fullscreen view of the steve-mcp bot.
- `/demo/*` — leftover scaffolder demo pages.

**3D viewer (the load-bearing, non-obvious part):**
- `static/web/viewer.js` + `worker.js` are a **prebuilt Babylon.js bundle** (~12 MB) copied from typecraft via `npm run sync-viewer`. They are committed binaries, not built by this app's vite. Re-sync them when typecraft's viewer changes.
- Each bot runs a `createWebViewer` WebSocket server on `localhost:(3001 + index)`. `vite.config.ts` sets up one ws-proxy per viewer — `/viewer/N` → `ws://127.0.0.1:(3001+N)` — so only the single dev port needs tunneling. `VIEWER_COUNT` (default 4) controls how many proxies/windows exist and **must match the bot count the race was launched with** (`STEVE_NUM_VIEWERS`). `MCP_VIEWER_PORT` adds the `/viewer/mcp` proxy.
- `BotWindow.svelte` / the fullscreen pages `import('/web/viewer.js')` at runtime and call `mountViewer(canvas, wsUrl, { workerUrl })`. The thumbnail canvas sets `pointer-events: none` and the link uses `data-sveltekit-reload` — both are deliberate fixes (Babylon swallowing clicks; SPA nav stalling under multiple live WebGL viewers). Don't "clean these up."

## Conventions

This submodule has its own scaffolder-default Biome/Prettier setup (tabs, single quotes). Match the existing functional Svelte-5-runes style (`$props`, `$derived`, `$state`). Per the monorepo root CLAUDE.md: conventional-commit prefixes, and never add AI attribution anywhere.
