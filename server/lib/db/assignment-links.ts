import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionInspectors } from './schema';

/**
 * DB-8 dual-write — replaces the inspection_inspectors rows for one
 * inspection so the link table mirrors the canonical columns on
 * `inspections` (inspectorId / leadInspectorId / helperInspectorIds JSON).
 *
 * Call this AFTER any write that changes who is assigned. Full-replace
 * semantics: rows not re-supplied are removed. Lead resolution mirrors
 * canEdit(): leadInspectorId ?? inspectorId. The helper never throws on an
 * unassigned inspection — it simply leaves zero rows.
 */
export async function syncInspectionAssignments(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    opts: {
        inspectorId?: string | null;
        leadInspectorId?: string | null;
        helperInspectorIds?: string[] | null;
    },
): Promise<void> {
    const lead = opts.leadInspectorId ?? opts.inspectorId ?? null;
    await db.delete(inspectionInspectors).where(and(
        eq(inspectionInspectors.inspectionId, inspectionId),
        eq(inspectionInspectors.tenantId, tenantId),
    ));
    const now = new Date();
    const rows: (typeof inspectionInspectors.$inferInsert)[] = [];
    if (lead) rows.push({ inspectionId, userId: lead, tenantId, role: 'lead', createdAt: now });
    for (const h of opts.helperInspectorIds ?? []) {
        if (h && h !== lead) rows.push({ inspectionId, userId: h, tenantId, role: 'helper', createdAt: now });
    }
    if (rows.length > 0) await db.insert(inspectionInspectors).values(rows);
}
