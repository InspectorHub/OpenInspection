import { defineConfig } from 'drizzle-kit';

// Schema-first source of truth. `npm run db:generate` diffs src/lib/db/schema
// against migrations/meta and emits a new SQL migration. Apply with
// `wrangler d1 migrations apply DB` (NOT drizzle-kit migrate — wrangler owns the
// d1_migrations tracking table). `npm run db:check` guards against drift.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema/index.ts',
  out: './migrations',
});
