import { defineConfig } from 'drizzle-kit';

// PRE-LAUNCH POLICY: the Drizzle schema is the single source of truth. While
// pre-launch, schema changes REGENERATE the single migrations/0000_baseline.sql
// (`drizzle-kit generate --name baseline` after clearing migrations/) and the DB
// is reset via `npm run wipe:d1:*` + `db:migrate*` — there are no forward
// migrations. Forward-migration discipline resumes at launch (real data).
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
