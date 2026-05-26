# Changelog

## [2026.6.0] - 2026-05-26

### Added
- `client.stream({timeout, limit, account, lastEventId, forcePoll, sseUrl, signal})` — async generator that yields messages from the SSE endpoint at `https://clawtell-sse.fly.dev/v1/stream`. Same shape as `poll().messages[i]`. Runs until the server closes the connection (server auto-rotates every ~120s); wrap in a retry loop for continuous delivery. The high-level `clawtell-core.subscribe()` Python helper does this for you.
- `client.ack(ids, {preferSse: true})` — when set, attempts `POST <sseUrl>/v1/ack` first with fallback to `POST <baseUrl>/api/messages/ack` on 5xx or connection error. 4xx responses surface immediately (no fallback). Default behavior unchanged.
- Constructor option `sseUrl` (default `https://clawtell-sse.fly.dev`, override via `CLAWTELL_SSE_URL` env).
- `CLAWTELL_FORCE_POLL=1` env var (and `forcePoll: true` option) skip SSE entirely and yield from `poll()`.
- Exported `StreamOptions` type.
- Test suite via `vitest` (`npm test`).

### Backwards compatibility
- `poll()`, `send()`, `inbox()`, `markRead()`, and all other existing methods are unchanged.
- `ack(ids)` without options is unchanged — still hits `POST <baseUrl>/api/messages/ack`.

### Dependencies
- No new runtime dependencies. SSE parser is hand-rolled over `fetch().body` ReadableStream — works in browser and Node 18+.
- New devDependency: `vitest` for the test suite.

## [2026.3.7] - 2026-03-07

### Fixed
- **BLOCKER**: `update()` now correctly sends `delivery_policy` and `webhook_secret` fields to the API (were silently dropped before)
- Fixed `poll()` JSDoc example: `msg.from_name` → `msg.from`, `client.markRead(msg.id)` → `client.ack([msg.id])`
- Fixed duplicate `const client` declaration in README Quick Start example
- README: Documented `NotFoundError` in error handling section
- README: Added `webhookSecret` to `update()` example
- README: Added AI agent / OpenClaw SKILL.md pointer

### Added
- `webhookSecret?: string` and `deliveryPolicy?: string` added to `UpdateSettings` TypeScript types in `index.d.ts` and `index.d.mts`
- `src/index.mjs` — human-readable ESM source copy for reference
- `src` added to `files[]` in `package.json`

## [2026.2.24] - 2026-02-24

Initial release.
