# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

This is a SvelteKit application using:

- **SvelteKit 2.x** with Svelte 5 (using modern runes syntax like `$props()`)
- **Drizzle ORM** with PostgreSQL for database management
- **Vite 7** as the build tool
- **Playwright** for end-to-end testing
- **@sveltejs/adapter-node** for Node.js deployment
- **TypeScript** with strict mode enabled

## Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start dev server and open in browser
npm run dev -- --open

# Type checking
npm run check

# Type checking in watch mode
npm run check:watch

# Build for production
npm run build

# Preview production build
npm run preview

# Run e2e tests
npm run test:e2e
# or
npm run test
```

## Database Commands

The project uses Docker Compose for local PostgreSQL development and Drizzle ORM
for schema management.

```bash
# Start PostgreSQL database (via Docker)
npm run db:start

# Push schema changes to database (without migration files)
npm run db:push

# Generate migration files from schema
npm run db:generate

# Run migrations
npm run db:migrate

# Open Drizzle Studio (database GUI)
npm run db:studio
```

**Database Setup**:

1. Copy `.env.example` to `.env` (DATABASE_URL should already be configured for
   local Docker)
2. Start the database with `npm run db:start`
3. Push schema changes with `npm run db:push` or generate/run migrations

**Database Configuration**:

- Local database runs on `localhost:5432` via Docker
- Default credentials: user=`root`, password=`mysecretpassword`,
  database=`local`
- Connection string is loaded from `DATABASE_URL` environment variable

## Architecture

### Directory Structure

- `src/routes/` - SvelteKit file-based routing
  - `+page.svelte` - Page components
  - `+layout.svelte` - Layout wrapper (uses Svelte 5 snippets with
    `{@render children?.()}`)
- `src/lib/` - Reusable library code (aliased as `$lib`)
  - `src/lib/server/` - Server-only code (never sent to client)
  - `src/lib/server/db/` - Database configuration and schema
    - `index.ts` - Drizzle database client setup
    - `schema.ts` - Database schema definitions using Drizzle
- `static/` - Static assets served directly
- `e2e/` - Playwright end-to-end tests

### Database Layer

The database is configured using Drizzle ORM with PostgreSQL:

- Schema defined in `src/lib/server/db/schema.ts` using Drizzle's `pgTable` API
- Database client exported from `src/lib/server/db/index.ts` as `db`
- Uses `postgres` driver (not `pg`)
- Environment variables loaded via `$env/dynamic/private` in server code
- Drizzle config in `drizzle.config.ts` points to schema file

### Svelte 5 Usage

This project uses Svelte 5's modern syntax:

- Runes API: `$props()`, `$state()`, `$derived()`, `$effect()`
- Snippets instead of slots: `{@render children?.()}`
- No `export let` - use `let { propName } = $props()` instead

### Testing

- Playwright e2e tests in `e2e/` directory
- Tests run against production build (`npm run build` → `npm run preview`)
- Test server runs on port 4173

### Minecraft Bot Architecture

This project includes a functional Minecraft bot framework using Mineflayer:

**Location**: `src/lib/server/steve/`

**Key Dependencies**:

- **mineflayer** (4.33.0): Core Minecraft bot framework
- **mineflayer-pathfinder** (2.4.5): Pathfinding and navigation
- **minecrafthawkeye** (1.3.9): Line-of-sight and collision detection
- **vec3** (0.1.10): 3D vector mathematics

**Architecture**:

The bot system uses a **functional, modular** approach (not class-based). All
code is TypeScript with strict typing.

**Ability Modules** (`src/lib/server/steve/abilities/`):

- `movement.ts` - Basic locomotion and pathfinding
  - `initializeMovement()`, `walkTo()`, `startSprinting()`, `stopSprinting()`
- `mining.ts` - Block breaking functionality
  - `mineBlock()`, `canMineBlock()`
- `inventory.ts` - Item management with change tracking
  - `setupInventoryTracking()`, `getInventoryChanges()`, `dropItem()`,
    `hasItem()`, `countItem()`
- `navigation.ts` - Advanced pathfinding with 360° scanning
  - `initializeNavigation()`, `findNearestBlock()`, `scanAreaForBlock()`,
    `goTo()`, `followPlayer()`

**Examples** (`src/lib/server/steve/examples/`):

- `circle.ts` - 50 bots in synchronized choreography
- `olympics.ts` - Multi-bot formations (ceremonies, torch relay, wave)
- `stress.ts` - Server stress testing with random movement
- `village.ts` - Role-based bots (Guard, Farmer, Miner, Logger)
- `wood.ts` - Wood gathering worker with CLI args

**Usage Pattern**:

```typescript
import mineflayer from "mineflayer";
import {
  goTo,
  initializeNavigation,
} from "$lib/server/steve/abilities/navigation";
import { mineBlock } from "$lib/server/steve/abilities/mining";

const bot = mineflayer.createBot({
  host: "localhost",
  port: 25565,
  username: "Steve",
});

bot.once("spawn", () => {
  initializeNavigation(bot);

  // Use abilities
  const block = bot.findBlock({ matching: someBlockId, maxDistance: 32 });
  await goTo(bot, block.position);
  await mineBlock(bot, block);
});
```

**Design Philosophy**:

- Pure functions over classes
- Explicit bot parameter passing
- Composable abilities
- TypeScript strict mode
- No global state
