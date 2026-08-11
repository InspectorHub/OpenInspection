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
    let row: { configName: string | null; registrationName: string | null } | undefined;
    try {
        row = await db
            .select({ configName: tenantConfigs.companyName, registrationName: tenants.name })
            .from(tenants)
            .leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, tenants.id))
            .where(eq(tenants.id, tenantId))
            .get();
    } catch {
        row = undefined;
    }
    return row?.configName?.trim() || row?.registrationName?.trim() || platformFallback;
}
