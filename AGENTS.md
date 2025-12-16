# AGENTS.md

## Build/Run Commands

- **Run:** `deno task start` (runs `deno run main.ts`)
- **Lint:** `deno lint`
- **Format:** `deno fmt`
- **Type check:** `deno check <file.ts>`
- **Test:** `deno test` (single test: `deno test path/to/test.ts`)

## Code Style

- **Imports:** Use `import type { X }` for type-only imports; include `.ts`
  extension for relative imports
- **Formatting:** 2-space indent, double quotes, semicolons, trailing commas in
  multi-line
- **Functions:** camelCase, verb-prefixed (e.g., `initializeMovement`,
  `findNearestBlock`)
- **Interfaces/Types:** PascalCase (e.g., `BotOptions`, `MenuItem`)
- **Constants:** SCREAMING_SNAKE_CASE for config objects
- **Error handling:** Use `err instanceof Error ? err.message : "error"`
  pattern; suppress expected errors silently
- **Async:** Prefer `async/await`; use Promise wrappers with manual timeouts for
  callback APIs

## Project Structure

- `main.ts` - Bot entry point with menu system
- `steve/abilities/` - Bot capabilities as separate modules (chat, inventory,
  mine, move, navigate, etc.)
- `steve/debug/` - Debug bot for automated tests
