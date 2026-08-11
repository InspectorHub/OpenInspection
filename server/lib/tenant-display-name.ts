import { sql } from 'drizzle-orm';
import { tenants, tenantConfigs } from './db/schema';

/**
 * The company name an AGENT or a CLIENT should see.
 *
 * Two columns hold a company name and they are allowed to differ:
 *
 *   tenants.name             the container's name. Written at provisioning from
 *                            whatever the signup form had — for one production
 *                            tenant that is literally the email local-part —
 *                            and kept current afterwards by portal's rename
 *                            sync (`portal.provider.ts` handleTenantUpdate).
 *   tenant_configs.company_name  the name the tenant typed into core's own
 *                            settings. Authoritative for display when set.
 *
 * The sync writes company_name only when it is EMPTY ("initialize-only, never
 * overwrite"), so once a tenant edits it in core the two diverge permanently and
 * by design. Display follows core's value; the container name is the fallback.
 *
 * ⚠️ The fallback is not decoration. Measured against production on 2026-08-11:
 * of 16 tenants, 11 match, 1 has diverged, and **4 have no company_name at all**.
 * Reading company_name without this COALESCE would render four companies with a
 * blank name in the agent directory, invite emails and public profiles — worse
 * than the stale name this change exists to fix.
 *
 * NULLIF(TRIM(...), '') because "set to whitespace" and "never set" are the same
 * thing to a reader, and only one of them is NULL.
 *
 * Every query using this must LEFT JOIN tenant_configs — LEFT, because a tenant
 * with no config row must still show its container name rather than vanish from
 * the result set.
 *
 * NOT for operational output. The M2M seeding route under `server/portal/`
 * reports the container name back to its caller; that is not a display surface
 * and deliberately stays on `tenants.name`.
 *
 * Named by ROLE rather than by path on purpose. `tests/unit/sync/portal-
 * isolation.spec.ts` greps `server/` for that route's path as a CONTENT string,
 * so a file that merely mentions it in a comment is indistinguishable from one
 * that imports it. This docblock spelled the path out and failed that gate; the
 * information is worth keeping, the exact string is not.
 */
export const tenantDisplayName = sql<string>`COALESCE(NULLIF(TRIM(${tenantConfigs.companyName}), ''), ${tenants.name})`;
