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
    // Typed against the table's own insert shape rather than cast past it. The
    // `templates as any` this replaces disabled every column check on the one
    // write that creates a workspace's copy of a catalogue pack -- a misspelled
    // column would have compiled, and the standing rule against `as any` exists
    // for writes exactly like this one.
    const row: typeof templates.$inferInsert = {
        id,
        tenantId,
        name,
        schema,
        createdAt: now,
    };
    await db.insert(templates).values(row);
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

/**
 * Offer a retired local template again, and return how many rows that changed.
 *
 * The exact inverse of `retireLocalTemplate`, and it exists because un-installing
 * is a VISIBILITY change: it retired this row and destroyed nothing, so putting
 * the row back is all a reinstall of the same version has to undo. Anything more
 * would be a reinstall inventing state that the un-install never removed.
 *
 * ⚠️ It is deliberately NOT reached when the catalogue has moved on. Reinstalling
 * at the version the workspace left on would put a superseded statutory revision
 * back in the picker on purpose — see the reinstall path, which mints the current
 * revision instead and retires this row for good.
 *
 * Scoped by tenant for the same reason the retire half is.
 */
export async function unretireLocalTemplate(
    db: MarketplaceDb,
    tenantId: string,
    templateId: string | null,
): Promise<number> {
    if (templateId === null) return 0;
    const rows = await db.update(templates)
        .set({ retiredAt: null })
        .where(and(eq(templates.id, templateId), eq(templates.tenantId, tenantId)))
        .returning({ id: templates.id });
    return rows.length;
}
