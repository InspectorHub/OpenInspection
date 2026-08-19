// Admin → data import & one-time migration sub-router.
//
// Two routes: delivery of a converted import bundle into the run it belongs to
// (POST /import), and the one-time legacy finding-key migration
// (POST /migrate-finding-keys). Route definitions are co-located with their
// `.openapi()` handlers. Mounted at `/` by the admin aggregator.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { eq, and } from 'drizzle-orm';
import { auditFromContext } from '../../lib/audit';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { ImportResponseSchema } from '../../lib/validations/admin.schema';
import { inspections, inspectionResults } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { templateSnapshotSectionsOrNone } from '../../services/inspection/shared';
import { getDrizzle } from '../../lib/route-helpers';
import { MigrationStageService } from '../../services/migration-intake/stage.service';
import { MigrationAssistanceService } from '../../services/migration-intake/assistance.service';
import { limitsFor } from '../../lib/migration-intake/limits';

/**
 * POST /api/admin/import
 *
 * Delivers a converted file into the import run it was uploaded to.
 *
 * It takes a bundle in the one normalised format rather than our own row
 * shapes, which is what makes the format's rules apply to it: no primary keys
 * of ours (ids are minted on write), counts that must equal what is actually
 * carried, and every entry the conversion could not use named rather than
 * counted. Nothing here reaches a real table — the run lands staged and the
 * workspace applies it themselves, seeing what will happen first.
 */
const importDataRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/import',
    tags: ['admin'],
    summary: 'Deliver a converted import bundle',
    description: 'Delivers a converted file, in the normalised import format, into the waiting import run it belongs to. The run becomes a prepared import the workspace reviews and applies; this route writes nothing to a real table.',
    middleware: [requireRole('owner', 'manager'), requireCapability('templateCreate')],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        batchId: z.string().min(1).describe('Id of the waiting import run this bundle was converted for'),
                        bundle: z.record(z.string(), z.unknown()).describe('The converted file in the normalised import format, validated on arrival'),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ImportResponseSchema.describe('Counts of what the run now carries') } },
            description: 'Bundle delivered',
        },
        400: { description: 'The bundle carries nothing to import, more entries than one run may carry, or a kind this run did not ask for' },
        403: { description: "Missing the 'templateCreate' capability" },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'That run is not waiting for a converted file' },
        422: { description: 'The bundle is not in the normalised import format' },
    },
    operationId: 'importTenant',
}, { scopes: ['admin'], tier: 'extended', capability: 'templateCreate' }));


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


const adminDataImportRoutes = createApiRouter()
    .openapi(importDataRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { batchId, bundle } = c.req.valid('json');

        const stage = new MigrationStageService(c.env.DB);
        const result = await stage.stageIntoBatch({
            tenantId,
            batchId,
            bundle,
            limits: limitsFor(c.var.profile),
        });

        const byEntity = { template: 0, contact: 0, member: 0 };
        for (const row of result.rows) byEntity[row.entity]++;

        await new MigrationAssistanceService(c.env.DB).notifyDelivered(tenantId, batchId);

        // A converted file landing on a run that has been waiting for one. This
        // is the only event on the pipeline that is OURS rather than the
        // operator's, which is why it has a name of its own rather than sharing
        // `data.import` with starter-content installs.
        auditFromContext(c, 'migration.delivered', 'migration_batch', {
            entityId: batchId,
            metadata: { rows: result.rows.length, byEntity },
        });

        return c.json({
            success: true as const,
            data: { batchId, rows: result.rows.length, byEntity },
        }, 200);
    })
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

export default adminDataImportRoutes;
