import { eq, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { templates } from '../../lib/db/schema';

/**
 * How many templates the company has, by the same rule as `meta.total` of the list: every row of the
 * company, retired ones included. One statement that reads no template body, which is the point:
 * the list reads and parses each page row's schema to count its items.
 */
export async function countTemplates(db: Pick<DrizzleD1Database<Record<string, unknown>>, 'select'>, tenantId: string): Promise<number> {
    const row = await db.select({ c: sql<number>`count(*)` }).from(templates).where(eq(templates.tenantId, tenantId)).get();
    return row?.c ?? 0;
}
