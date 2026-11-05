# Migrations (OPS-07)

One file per change, named `NNN-short-name.js`, exporting `{ name, up(db) }`. The name must match the file name without `.js`.
Run with `npm run migrate -w @crm/server`. Each migration runs once and is recorded in the `migrations` collection
(`name` unique, `ran_at`). A failed migration is not recorded, so the next run retries it. Migrations must be
safe to re-run after a crash (use `$exists` checks, `createIndex` is idempotent).
