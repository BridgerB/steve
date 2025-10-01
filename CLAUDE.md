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
