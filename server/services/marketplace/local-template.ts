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

import { and, eq } from 'drizzle-orm';
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

/**
 * Stop offering a local template for NEW inspections, and return how many rows
 * that changed (0 when there was no local row, or it belongs to someone else).
 *
 * ⚠️ NOT A DELETE, AND DELETING IS NOT AVAILABLE. `inspections.template_id`
 * carries a legacy foreign key to this table, so D1 refuses to remove a
 * referenced row — and the row has to survive regardless, because re-issuing a
 * delivered report reads the inspection's own snapshot rather than this row.
 *
 * Scoped by tenant as well as by id: the id arrives from an import marker, and
 * a write that trusted it alone would be a cross-tenant write the moment that
 * marker was ever wrong.
 */
export async function retireLocalTemplate(
    db: MarketplaceDb,
    tenantId: string,
    templateId: string | null,
    at: Date,
): Promise<number> {
    if (templateId === null) return 0;
    const rows = await db.update(templates)
        .set({ retiredAt: at })
        .where(and(eq(templates.id, templateId), eq(templates.tenantId, tenantId)))
        .returning({ id: templates.id });
    return rows.length;
}
