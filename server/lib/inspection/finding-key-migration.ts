/**
 * The legacy finding-key migration over a tenant's results rows.
 *
 * Old results were keyed by the bare item id; today's key is
 * `_default:<sectionId>:<itemId>`. When collaborative editing is on, the results
 * document held by a Durable Object is the only writer of result content: its
 * next persist replaces the blob with the document's projection, so a blob
 * rewritten behind its back is undone (or never seen). The rule here:
 *
 *   - A row WITH collab state (`ydoc_state` is not null) is always handed to its
 *     document (`/rename-legacy-keys`), whatever the blob looks like. The blob
 *     cannot say what the document holds; an older, D1-only migration may have
 *     made the blob composite while the document kept the bare keys.
 *   - A row without collab state is also handed to the document when the tenant
 *     has collaboration on, the binding exists, the inspection has one results
 *     row, and the blob holds a key the template names. The object imports the
 *     blob when it has no state of its own, renames and persists, which also
 *     removes the race with unflushed edits.
 *   - Everything else (no binding, collaboration off, or several results rows,
 *     where the object's blob import cannot tell the reports apart) is rewritten
 *     in D1.
 *   - A row with collab state and no binding to ask is a failure, not a D1 write.
 *
 * Underscore-prefixed keys (the inspector signature and friends) are meta data,
 * not findings, and are never rewritten. Every query and the document's id
 * derive from the verified tenant, never from input.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionResults, tenantConfigs } from '../db/schema';
import { collabDocName } from '../collab/doc-name';
import { isMetaKey } from '../finding-key';
import { logger } from '../logger';
import { templateSnapshotSectionsOrNone } from '../../services/inspection/shared';
import { LegacyRenameCountsSchema, type FindingKeyMigrationResult, type LegacyRenameCounts } from '../validations/admin/finding-keys';
import { resolvePrimaryReportId } from './reports';

export type { FindingKeyMigrationResult };

/** Ask the results document of `reportId` to rename its legacy keys and say what it did. Throws on failure. */
export type RenameInDocument = (reportId: string, inspectionId: string) => Promise<LegacyRenameCounts>;

/**
 * The Worker-side caller: a stub whose id is derived from the verified tenant and
 * the report. `null` when the deployment has no `INSPECTION_DOC` binding.
 */
export function renameThroughDurableObject(ns: DurableObjectNamespace | undefined, tenantId: string): RenameInDocument | null {
    if (!ns) return null;
    return async (reportId, inspectionId) => {
        const stub = ns.get(ns.idFromName(collabDocName(tenantId, reportId)));
        const res = await stub.fetch(new Request('https://do.local/rename-legacy-keys', {
            method:  'POST',
            headers: { 'x-tenant-id': tenantId, 'x-inspection-id': inspectionId, 'x-report-id': reportId },
        }));
        if (!res.ok) throw new Error(`rename-legacy-keys returned ${res.status}`);
        return LegacyRenameCountsSchema.parse(await res.json());
    };
}

/**
 * Whether collaborative editing is on for the tenant, read the way the session
 * does (`session-context.ts`): a missing row or null is ON, only an explicit
 * false is an opt-out.
 */
async function isCollabOn(db: DrizzleD1Database, tenantId: string): Promise<boolean> {
    const cfg = await db.select({ collabEditing: tenantConfigs.collabEditing }).from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId)).get();
    return cfg?.collabEditing !== false;
}

/** A legacy key has fewer than three colon-separated parts. */
const isLegacyShaped = (key: string): boolean => key.split(':').length < 3;

/** An entry that holds something: not `{}`, not null, not an empty value. */
function hasContent(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.some(hasContent);
    if (typeof value === 'object') return Object.values(value).some(hasContent);
    return true;
}

/**
 * Rewrite the legacy keys of a blob to composite keys. Composite keys and meta
 * keys are kept as they are; a legacy key naming no template item is filed under
 * `_unknown` so it stays findable.
 *
 * A legacy entry is never allowed to replace a composite entry that holds
 * content, and an empty composite entry (the template seed) never wins over a
 * legacy one. When both hold content the legacy key is left where it is, so
 * nothing is overwritten and nothing is lost.
 */
export function rewriteLegacyKeys(
    data: Record<string, unknown>,
    itemToSection: ReadonlyMap<string, string>,
): { data: Record<string, unknown>; changed: boolean } {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (!isLegacyShaped(key) || isMetaKey(key)) next[key] = value;
    }
    for (const [key, value] of Object.entries(data)) {
        if (!isLegacyShaped(key) || isMetaKey(key)) continue;
        const composite = `_default:${itemToSection.get(key) ?? '_unknown'}:${key}`;
        if (composite in next && hasContent(next[composite])) {
            next[key] = value;
            continue;
        }
        next[composite] = value;
        changed = true;
    }
    return { data: next, changed };
}

function parseBlob(raw: unknown): Record<string, unknown> | null {
    try {
        const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value))
            : null;
    } catch {
        return null;
    }
}

const BATCH_SIZE = 50;

export async function migrateFindingKeys(
    db: DrizzleD1Database,
    tenantId: string,
    renameInDocument: RenameInDocument | null,
): Promise<FindingKeyMigrationResult> {
    const out: FindingKeyMigrationResult = {
        processed: 0, migrated: 0, skipped: 0, delegated: 0, failed: 0, failedIds: [], renamedInDocuments: 0, conflicts: 0,
    };
    const preferDocument = renameInDocument !== null && await isCollabOn(db, tenantId);
    let offset = 0;

    while (true) {
        // Ordered, so the pages of an offset walk cannot overlap or skip.
        const batch = await db.select({
            id:               inspections.id,
            templateId:       inspections.templateId,
            templateSnapshot: inspections.templateSnapshot,
        })
            .from(inspections)
            .where(eq(inspections.tenantId, tenantId))
            .orderBy(inspections.id)
            .limit(BATCH_SIZE)
            .offset(offset);
        if (batch.length === 0) break;
        offset += batch.length;

        for (const insp of batch) {
            // One results row per report. The blob is read here; the collab-state
            // flag is read separately so the (large) document binary is never loaded.
            const rows = await db.select({ id: inspectionResults.id, reportId: inspectionResults.reportId, data: inspectionResults.data })
                .from(inspectionResults)
                .where(and(eq(inspectionResults.inspectionId, insp.id), eq(inspectionResults.tenantId, tenantId)));
            const withState = new Set((await db.select({ id: inspectionResults.id }).from(inspectionResults)
                .where(and(
                    eq(inspectionResults.inspectionId, insp.id),
                    eq(inspectionResults.tenantId, tenantId),
                    isNotNull(inspectionResults.ydocState),
                ))).map((r) => r.id));

            // #307: the item -> section map comes from the inspection's own snapshot and from
            // nothing else; with no snapshot the map is empty and the keys are left alone.
            interface SectionLite { id: string; items?: Array<{ id: string }> }
            const itemToSection = new Map<string, string>();
            for (const sec of templateSnapshotSectionsOrNone<SectionLite>(insp, tenantId)) {
                for (const item of (sec.items ?? [])) itemToSection.set(item.id, sec.id);
            }

            for (const row of rows) {
                out.processed++;
                const data = row.data ? parseBlob(row.data) : null;
                const namesATemplateItem = data !== null
                    && Object.keys(data).some((k) => isLegacyShaped(k) && !isMetaKey(k) && itemToSection.has(k));

                const viaDocument = withState.has(row.id) || (preferDocument && rows.length === 1 && namesATemplateItem);
                if (viaDocument) {
                    try {
                        if (!renameInDocument) throw new Error('INSPECTION_DOC binding missing');
                        const reportId = row.reportId ?? await resolvePrimaryReportId(db, tenantId, insp.id);
                        if (!reportId) throw new Error('no report to address the results document by');
                        const counts = await renameInDocument(reportId, insp.id);
                        out.delegated++;
                        out.renamedInDocuments += counts.renamed;
                        out.conflicts += counts.conflicts;
                    } catch (err) {
                        out.failed++;
                        out.failedIds.push(insp.id);
                        logger.error('finding-key migration: results document rename failed', { inspectionId: insp.id }, err instanceof Error ? err : undefined);
                    }
                    continue;
                }

                const rewritten = data ? rewriteLegacyKeys(data, itemToSection) : null;
                if (!rewritten?.changed) {
                    out.skipped++;
                    continue;
                }
                await db.update(inspectionResults)
                    .set({ data: rewritten.data as unknown as object, lastSyncedAt: new Date() })
                    // Scoped by tenant as well as by id: the write states its own scope
                    // rather than inheriting it from the read above.
                    .where(and(eq(inspectionResults.id, row.id), eq(inspectionResults.tenantId, tenantId)));
                out.migrated++;
            }
        }
    }

    return out;
}
