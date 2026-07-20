// Admin → Data import & migration sub-router (Phase 1.3 split of
// server/api/admin.ts; carved out of admin-data.ts to keep each file under the
// size ceiling).
//
// The two heavy batch routines: bulk tenant import (POST /import) and the
// one-time legacy finding-key migration (POST /migrate-finding-keys). Route
// definitions are co-located with their `.openapi()` handlers; bodies are
// byte-identical to the original admin.ts. Mounted at `/` by the admin
// aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { auditFromContext } from '../../lib/audit';
import { requireRole } from '../../lib/middleware/rbac';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { ImportResponseSchema } from '../../lib/validations/admin.schema';
import { templates, agreements as agreementTable, inspections, inspectionResults, contactRoleProfiles } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { syncInspectionAssignmentsBatch } from '../../lib/db/assignment-links';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

/**
 * Task 7c (people-role-profiles fix) — resolves an active role profile's id
 * by key (e.g. 'client', 'buyer_agent', 'listing_agent') for the imported-
 * inspection people-mirroring below. Returns undefined when the tenant has
 * no active profile for that key (role seeding failed/incomplete) —
 * callers treat that as "skip this role" rather than throw.
 */
async function resolveRoleId(db: DrizzleD1Database, tenantId: string, key: string): Promise<string | undefined> {
    const row = await db.select({ id: contactRoleProfiles.id }).from(contactRoleProfiles)
        .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.key, key), eq(contactRoleProfiles.active, true)))
        .get();
    return row?.id;
}


/**
 * POST /api/admin/import
 */
const importDataRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/import',
    tags: ["admin"],
    summary: "Import tenant for current tenant",
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        inspections: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe inspections field for the OpenInspection MCP integration'),
                        templates: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe templates field for the OpenInspection MCP integration'),
                        agreements: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe agreements field for the OpenInspection MCP integration'),
                        inspectionResults: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe inspectionResults field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: ImportResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "importTenant",
    description: "Auto-generated placeholder for importTenant (POST /import, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


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
        const body = c.req.valid('json');

        const importedInspections = Array.isArray(body.inspections) ? body.inspections : [];
        const importedTemplates = Array.isArray(body.templates) ? body.templates : [];
        const importedAgreements = Array.isArray(body.agreements) ? body.agreements : [];
        const importedResults = Array.isArray(body.inspectionResults) ? body.inspectionResults : [];

        const total = importedInspections.length + importedTemplates.length +
                      importedAgreements.length + importedResults.length;
        if (total === 0) throw Errors.BadRequest('No importable records found.');
        if (total > 5000) throw Errors.BadRequest('Payload too large.');

        const db = drizzle(c.env.DB);
        const counts = { templates: 0, agreements: 0, inspections: 0, results: 0 };

        interface TemplateImport { id: string; name: string; version?: number; schema: unknown; createdAt?: string }
        interface AgreementImport { id: string; name: string; content: string; version?: number; createdAt?: string }
        interface InspectionImport {
            id: string; propertyAddress: string; inspectorId?: string; clientName?: string;
            clientEmail?: string; templateId?: string; date?: string;
            status?: 'requested' | 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
            paymentStatus?: 'unpaid' | 'partial' | 'paid'; price?: number; createdAt?: string;
            // Task 7c (people-role-profiles fix) — optional legacy agent-referral
            // ids, mirrored into inspection_people (buyer_agent / listing_agent)
            // below when present. Both must already be contacts.id rows in this
            // tenant (same contract as the legacy inspections columns they name).
            referredByAgentId?: string; sellingAgentId?: string;
        }
        interface ResultImport { id: string; inspectionId: string; data: unknown; lastSyncedAt?: string }

        for (const t of importedTemplates as unknown as TemplateImport[]) {
            if (!t.id || !t.name) continue;
            await db.insert(templates).values({
                id: t.id, tenantId, name: t.name, version: t.version ?? 1,
                schema: typeof t.schema === 'string' ? t.schema : JSON.stringify(t.schema),
                createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
            }).onConflictDoNothing().run();
            counts.templates++;
        }

        for (const a of importedAgreements as unknown as AgreementImport[]) {
            if (!a.id || !a.name) continue;
            await db.insert(agreementTable).values({
                id: a.id, tenantId, name: a.name, content: a.content || '', version: a.version ?? 1,
                createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
            }).onConflictDoNothing().run();
            counts.agreements++;
        }

        const importAssignments: Array<{ inspectionId: string; inspectorId: string | null }> = [];
        for (const ins of importedInspections as unknown as InspectionImport[]) {
            if (!ins.id || !ins.propertyAddress) continue;
            // Imported historical inspections deliberately do not consume plan quota.
            await db.insert(inspections).values({
                id: ins.id, tenantId, propertyAddress: ins.propertyAddress,
                inspectorId: ins.inspectorId || null,
                templateId: ins.templateId || null,
                date: ins.date || new Date().toISOString(), status: ins.status || INSPECTION_STATUS.REQUESTED,
                paymentStatus: ins.paymentStatus || 'unpaid', price: ins.price || 0,
                createdAt: ins.createdAt ? new Date(ins.createdAt) : new Date(),
            }).onConflictDoNothing().run();
            // DB-8: mirror the import row's assignment into the link table. NOTE: on
            // onConflictDoNothing conflicts the canonical inspection row is unchanged,
            // so this intentionally re-asserts the link rows from the IMPORT payload —
            // acceptable for the one-shot import tool, where re-importing the same file
            // is the only conflict source and payloads are identical.
            importAssignments.push({ inspectionId: ins.id, inspectorId: ins.inspectorId || null });
            counts.inspections++;

            // Task 7c (people-role-profiles fix) — getInspection/listInspections
            // (Task 9c-reads) resolve the client ONLY via inspection_people; the
            // legacy inline clientName/clientEmail/referredByAgentId/
            // sellingAgentId columns were dropped from inspections (Task 13),
            // so every imported inspection needs matching inspection_people
            // rows. Client is upserted as a contact (same idempotent match
            // booking.service/core.ts use); agent ids are assumed to already be
            // contacts.id rows in this tenant (same contract as the legacy
            // columns) and are linked directly. Per-row non-fatal: one bad row
            // must not abort the rest of the import (the inspection row already
            // committed above regardless).
            if (ins.clientName || ins.clientEmail || ins.referredByAgentId || ins.sellingAgentId) {
                try {
                    if (ins.clientName || ins.clientEmail) {
                        const { id: clientContactId } = await c.var.services.contact.upsertClientContact(tenantId, {
                            name: ins.clientName || 'Imported Client',
                            ...(ins.clientEmail ? { email: ins.clientEmail } : {}),
                            type: 'client',
                        });
                        const clientRoleId = await resolveRoleId(db, tenantId, 'client');
                        if (clientRoleId) {
                            await c.var.services.people.addPerson(tenantId, ins.id, clientContactId, clientRoleId);
                        }
                    }
                    if (ins.referredByAgentId) {
                        const buyerAgentRoleId = await resolveRoleId(db, tenantId, 'buyer_agent');
                        if (buyerAgentRoleId) {
                            await c.var.services.people.addPerson(tenantId, ins.id, ins.referredByAgentId, buyerAgentRoleId);
                        }
                    }
                    if (ins.sellingAgentId) {
                        const listingAgentRoleId = await resolveRoleId(db, tenantId, 'listing_agent');
                        if (listingAgentRoleId) {
                            await c.var.services.people.addPerson(tenantId, ins.id, ins.sellingAgentId, listingAgentRoleId);
                        }
                    }
                } catch (err) {
                    logger.error('inspection-people write from admin data import failed', { inspectionId: ins.id }, err instanceof Error ? err : undefined);
                }
            }
        }
        // B-29: all link-table resyncs in one db.batch round trip (was 2N
        // statements inside the loop).
        await syncInspectionAssignmentsBatch(db, tenantId, importAssignments);

        for (const r of importedResults as unknown as ResultImport[]) {
            if (!r.id || !r.inspectionId) continue;

            // Verify inspectionId belongs to current tenant
            const inspection = await db.select().from(inspections)
                .where(eq(inspections.id, r.inspectionId))
                .get();

            if (!inspection) {
                logger.warn(`Skipping result ${r.id}: inspection ${r.inspectionId} not found`);
                continue;
            }

            if (inspection.tenantId !== tenantId) {
                logger.warn(`Skipping result ${r.id}: inspection ${r.inspectionId} belongs to different tenant`);
                continue;
            }

            await db.insert(inspectionResults).values({
                id: r.id,
                tenantId,
                inspectionId: r.inspectionId,
                data: typeof r.data === 'string' ? r.data : JSON.stringify(r.data),
                lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt) : new Date(),
            }).onConflictDoNothing().run();
            counts.results++;
        }

        auditFromContext(c, 'data.import', 'import', { metadata: { counts } });

        return c.json({ success: true, data: { message: 'Import complete.', imported: counts } }, 200);
    })
    .openapi(migrateFindingKeysRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

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

                interface SchemaSectionLite { id: string; items?: Array<{ id: string }> }
                let sections: SchemaSectionLite[] = [];

                const snap = insp.templateSnapshot as { sections?: SchemaSectionLite[] } | null;
                if (snap && Array.isArray(snap?.sections)) {
                    sections = snap.sections;
                } else if (insp.templateId) {
                    const tpl = await db.select().from(templates)
                        .where(and(eq(templates.id, insp.templateId), eq(templates.tenantId, tenantId)))
                        .get();
                    const live = tpl?.schema as { sections?: SchemaSectionLite[] } | null;
                    if (live && Array.isArray(live?.sections)) {
                        sections = live.sections;
                    }
                }

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
                        .where(eq(inspectionResults.id, resultsRow.id));
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
