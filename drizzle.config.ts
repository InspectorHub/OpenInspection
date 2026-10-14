import { defineConfig } from 'drizzle-kit';

// MIGRATION POLICY: the Drizzle schema is the single source of truth, and
// migrations are forward-only. D1 has no rollback, so every change follows
// expand-migrate-contract: add the new column or table first, backfill in the same
// file, switch the code over, and only then retire the old structure. Do not
// regenerate migrations/0000_baseline.sql and do not wipe a database to apply a
// schema change; run `npm run db:generate` and commit the new incremental file.
// An ADD COLUMN goes in its own migration, and the column goes at the END of the
// table's definition in the schema.
//
// Schema-first source of truth. `npm run db:generate` diffs server/lib/db/schema
// against migrations/meta and emits a new SQL migration. Apply with
// `wrangler d1 migrations apply DB` (NOT drizzle-kit migrate — wrangler owns the
// d1_migrations tracking table). `npm run db:check` guards against drift.
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/lib/db/schema/index.ts',
  out: './migrations',
});
