import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { tenants, tenantConfigs } from '../db/schema';

/**
 * The company name for anything a carrier or a consent record will see.
 *
 * `tenants.name` is the REGISTRATION name: written once at provisioning
 * (`lib/integration/standalone.ts`, "initialize-only") and never updated
 * afterwards, because Settings writes `tenant_configs.company_name` and nothing
 * ever writes back. The two diverge permanently the moment a tenant edits its
 * name, and a TCPA consent record is the one place that must not carry a stale
 * entity.
 *
 * Falls back through the registration name to the platform name, so an
 * unconfigured or unknown tenant still yields something printable.
 *
 * Lives here rather than in `api/sms.ts` so both readers in that file share ONE
 * resolver — the whole reason spec 1.6 exists is that the original audit cited
 * a line range instead of the file, and the second reader survived the fix.
 */
export async function resolveSmsBrand(
    db: DrizzleD1Database,
    tenantId: string,
    platformFallback = 'Inspector Hub',
): Promise<string> {
    // try/catch, not `.get().catch()`: the better-sqlite3 driver the unit
    // suite runs on returns a plain value from `.get()`, so a `.catch` on it
    // throws "not a function" — and it would do so only under test.
    // One column, one fallback. This used to read `tenants.name` as a second
    // chance behind `company_name`; that column is gone, and every tenant was
    // backfilled into `company_name` before it went. The slug takes the middle
    // rung because it is NOT NULL — so an SMS brand name degrades to something
    // identifiable rather than jumping straight to the platform default, which
    // would tell the recipient they are hearing from Inspector Hub when they
    // are hearing from their inspector.
    let row: { configName: string | null; slug: string } | undefined;
    try {
        row = await db
            .select({ configName: tenantConfigs.companyName, slug: tenants.slug })
            .from(tenants)
            .leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, tenants.id))
            .where(eq(tenants.id, tenantId))
            .get();
    } catch {
        row = undefined;
    }
    return row?.configName?.trim() || row?.slug?.trim() || platformFallback;
}
