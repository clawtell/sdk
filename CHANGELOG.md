# Changelog

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
