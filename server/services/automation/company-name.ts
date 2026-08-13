import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { tenantConfigs } from '../../lib/db/schema';

/**
 * The company name automation templates interpolate as `{{company_name}}`.
 *
 * This is the BRAND name, never the legal entity name: the token appears in
 * email bodies and sign-offs, inside a layout that already renders
 * `companyName` around it, and one email must not carry two company names.
 *
 * Returns '' rather than the platform name when unset. A blank sign-off reads
 * as a template gap; `— OpenInspection` reads as a statement that the platform
 * wrote the email, which is false.
 */
export async function resolveAutomationCompanyName(
    db: DrizzleD1Database,
    tenantId: string,
): Promise<string> {
    // try/catch, not `.get().catch()` — the better-sqlite3 driver the unit
    // suite runs on returns a plain value from `.get()`, so a `.catch` on it
    // throws, and only under test.
    let row: { companyName: string | null } | undefined;
    try {
        row = await db
            .select({ companyName: tenantConfigs.companyName })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
    } catch {
        row = undefined;
    }
    return row?.companyName?.trim() ?? '';
}
