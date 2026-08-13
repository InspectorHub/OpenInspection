import { sql } from 'drizzle-orm';
import { tenants, tenantConfigs } from './db/schema';

/**
 * The company name an AGENT or a CLIENT should see.
 *
 * There is ONE name now. `tenants.name` — the container name written at
 * provisioning and kept current by portal's rename sync — was dropped after
 * migration `0064` backfilled every tenant's `tenant_configs.company_name` from
 * it. Before that there were two columns for one fact, allowed to diverge, and
 * diverging in production: of 16 tenants, 11 matched, 1 had parted ways
 * permanently, and 4 had no settings name at all.
 *
 * The COALESCE stays, but it now falls back to something that CANNOT be missing.
 * `slug` is NOT NULL and unique, so this expression can never render empty —
 * which is the property the old fallback was really providing, and the reason a
 * plain `company_name` read would have been a regression rather than a
 * simplification. A slug is a poor name to show a client; it is a far better
 * one than nothing, and it means a config row that is somehow absent degrades
 * to something identifiable instead of a blank line in an invite email.
 *
 * NULLIF(TRIM(...), '') because "set to whitespace" and "never set" are the same
 * thing to a reader, and only one of them is NULL.
 *
 * Every query using this must LEFT JOIN tenant_configs — LEFT, because a tenant
 * with no config row must still resolve rather than vanish from the result set.
 * The backfill gave every existing tenant a row and both providers write one at
 * provisioning, so this is belt-and-braces; it costs nothing and the failure it
 * prevents is silent.
 *
 * NOT for operational output. The M2M seeding route under `server/portal/`
 * reports a tenant's name back to its caller, which is not a display surface.
 * Named by ROLE rather than by path on purpose: `tests/unit/sync/portal-
 * isolation.spec.ts` greps `server/` for that route's path as a CONTENT string,
 * so a file that merely mentions it in a comment is indistinguishable from one
 * that imports it.
 */
export const tenantDisplayName = sql<string>`COALESCE(NULLIF(TRIM(${tenantConfigs.companyName}), ''), ${tenants.slug})`;
