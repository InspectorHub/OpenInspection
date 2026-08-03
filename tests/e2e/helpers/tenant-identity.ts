/**
 * The one workspace every e2e spec shares.
 *
 * `POST /api/auth/setup` is single-shot: server/api/auth.ts returns 409
 * `already_initialized` once any user carries a tenant_id. So the FIRST spec to
 * call it permanently decides the tenant's name — and therefore its slug — for
 * the entire run.
 *
 * That made the outcome depend on project declaration order. Five specs defined
 * their own `COMPANY_NAME` and a sixth inlined one, across three different
 * values, while four specs asserted on the slug `automation-test-corp`. It
 * passed only because `api` is declared first and workers were serialized;
 * reorder the projects, or run any of them in parallel, and whichever setup won
 * the race decided the slug and the other four failed.
 *
 * One name, defined once. The slug is DERIVED here by the same expression the
 * server applies rather than written out again, so the two cannot drift — the
 * repo's rule for a "must stay in sync" coupling is to make it executable
 * rather than to write it in a comment.
 */

/** Must match the company name the setup wizard is given, everywhere. */
export const COMPANY_NAME = process.env.COMPANY_NAME || 'Automation Test Corp';

/** Mirrors the slug derivation in server/api/auth.ts. Do not hand-write this. */
export const TENANT_SLUG = COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * The admin `POST /api/auth/setup` creates. Every spec that logs in as the
 * workspace admin uses these — which is also why the local `seedAdminPassword`
 * helpers were removable: they re-hashed this exact password onto the row that
 * already had it, at the cost of a `wrangler d1 execute --local` per spec.
 */
export const ADMIN_EMAIL = 'admin@autotest.com';
export const ADMIN_PASSWORD = 'Password123!';
