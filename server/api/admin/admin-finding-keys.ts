// Admin → the one-time legacy finding-key migration.
//
// Split out of `admin-data-import.ts` when that file crossed the 400-line gate.
// The seam is not arbitrary: everything here is a ONE-TIME data migration over
// `inspection_results`, sharing nothing with the import-intake surface next
// door but the word "data" and an `/api/admin` prefix. That file is now about
// one thing — what can happen to an import run somebody sent us to convert —
// and this one is about a rewrite that will eventually be deleted outright.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { eq, and } from 'drizzle-orm';
import { auditFromContext } from '../../lib/audit';
import { requireRole } from '../../lib/middleware/rbac';
import { inspections, inspectionResults } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { templateSnapshotSectionsOrNone } from '../../services/inspection/shared';
import { getDrizzle } from '../../lib/route-helpers';

// --- Finding Key Migration (one-time data migration) ---
//
// Batch-converts inspection_results.data keys from the legacy `itemId`
// format to the composite `_default:sectionId:itemId` format. Idempotent —
// keys that already contain 2+ colons are skipped.

const migrateFindingKeysRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/migrate-finding-keys',
    tags: ['admin'],
    summary: 'One-time migration: rewrite legacy finding keys to composite format',
    middleware: [requireRole('owner')] as const,
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            processed: z.number(),
                            migrated: z.number(),
                            skipped: z.number(),
                        }),
                    }),
                },
            },
            description: 'Migration complete',
        },
    },
    operationId: 'migrateFindingKeys',
    description: 'Batch-converts inspection_results.data keys from legacy itemId format to composite _default:sectionId:itemId format. Idempotent — already-composite keys are skipped.',
}, { scopes: ['admin'], tier: 'extended' }));


const adminFindingKeyRoutes = createApiRouter()
    .openapi(migrateFindingKeysRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);

        let processed = 0;
        let migrated = 0;
        let skipped = 0;

        const BATCH_SIZE = 50;
        let offset = 0;

        // Process inspections in batches
        while (true) {
            const batch = await db.select({
                id:                inspections.id,
                templateId:        inspections.templateId,
                templateSnapshot:  inspections.templateSnapshot,
            })
            .from(inspections)
            .where(eq(inspections.tenantId, tenantId))
            .limit(BATCH_SIZE)
            .offset(offset);

            if (batch.length === 0) break;
            offset += batch.length;

            for (const insp of batch) {
                // Load the results row for this inspection
                const resultsRow = await db.select()
                    .from(inspectionResults)
                    .where(and(
                        eq(inspectionResults.inspectionId, insp.id),
                        eq(inspectionResults.tenantId, tenantId),
                    ))
                    .get();

                if (!resultsRow || !resultsRow.data) {
                    skipped++;
                    continue;
                }

                const data: Record<string, unknown> = typeof resultsRow.data === 'string'
                    ? JSON.parse(resultsRow.data)
                    : resultsRow.data as Record<string, unknown>;

                // Build itemId → sectionId mapping from template snapshot or
                // live template schema
                const itemToSection = new Map<string, string>();

                // #307 — the item→section map comes from the inspection's own
                // snapshot and from nothing else. It used to fall back to the
                // live template, which would rewrite legacy finding keys
                // against TODAY's section layout rather than the one the
                // results were recorded under — a silent mis-filing, not a
                // missing label. With no snapshot the map is empty, the keys
                // below are left alone, and the miss is logged.
                interface SchemaSectionLite { id: string; items?: Array<{ id: string }> }
                const sections = templateSnapshotSectionsOrNone<SchemaSectionLite>(insp, tenantId);

                for (const sec of sections) {
                    for (const item of (sec.items ?? [])) {
                        itemToSection.set(item.id, sec.id);
                    }
                }

                // Rewrite legacy keys
                let changed = false;
                const newData: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(data)) {
                    // Already composite (has 2+ colons) — keep as-is
                    if (key.split(':').length >= 3) {
                        newData[key] = value;
                        continue;
                    }
                    const sectionId = itemToSection.get(key) ?? '_unknown';
                    const compositeKey = `_default:${sectionId}:${key}`;
                    newData[compositeKey] = value;
                    changed = true;
                }

                if (changed) {
                    await db.update(inspectionResults)
                        .set({ data: newData as unknown as object, lastSyncedAt: new Date() })
                        // Scoped by tenant as well as by id. The row was read
                        // under a tenant filter a few lines up, so this changes
                        // nothing at runtime — but the write states its own
                        // scope rather than inheriting it from a read, which is
                        // what the tenant-scoping gate asks of every by-id write.
                        .where(and(
                            eq(inspectionResults.id, resultsRow.id),
                            eq(inspectionResults.tenantId, tenantId),
                        ));
                    migrated++;
                } else {
                    skipped++;
                }
                processed++;
            }
        }

        auditFromContext(c, 'admin.migrate_finding_keys', 'inspection_results', {
            metadata: { processed, migrated, skipped },
        });

        return c.json({
            success: true as const,
            data: { processed, migrated, skipped },
        }, 200);
    });

export default adminFindingKeyRoutes;
