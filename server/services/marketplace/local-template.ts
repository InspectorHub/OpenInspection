/**
 * The local `templates` row a 1:1 catalogue kind produces, and what happens to
 * it afterwards.
 *
 * The counterpart of `library-insert.ts`, which is the same half for the 1:N
 * kind. Both are free functions so the import, update and un-import paths
 * provably write the same columns — a private method on the service is
 * reachable from one class only, which is how two paths for the same kind come
 * to disagree.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { templates } from '../../lib/db/schema';

/** The service's `drizzle(env.DB)` handle. Named so these signatures do not
 *  silently narrow to the schema-less default and reject their only caller. */
type MarketplaceDb = DrizzleD1Database<Record<string, unknown>>;

/**
 * Mint the one local template a 1:1 import creates, and return its id.
 *
 * The kinds differ in which validator gates them, not in what an import writes,
 * so they share this.
 */
export async function insertLocalTemplate(
    db: MarketplaceDb,
    tenantId: string,
    name: string,
    schema: unknown,
    now: Date,
): Promise<string> {
    const id = crypto.randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(templates as any).values({
        id,
        tenantId,
        name,
        schema,
        createdAt: now,
    });
    return id;
}
