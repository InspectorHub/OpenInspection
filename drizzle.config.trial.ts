import { defineConfig } from 'drizzle-kit';

// TRIAL config — generates into ./drizzle-tmp for diff verification only.
// The real config (drizzle.config.ts) writes to ./migrations.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle-tmp',
});
