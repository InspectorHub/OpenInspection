// Admin → Data & members sub-router (Phase 1.3 split of server/api/admin.ts).
//
// Tenant export/import, member invite/list, audit-log read + inspector-driven
// write, GDPR data erasure + erasure-log accountability view, and the one-time
// finding-key migration. Route definitions are co-located with their
// `.openapi()` handlers; bodies are byte-identical to the original admin.ts.
// Mounted at `/` by the admin aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc as descDz } from 'drizzle-orm';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { safeISODate } from '../../lib/date';
import { getBaseUrl } from '../../lib/url';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
    InviteMemberSchema,
    DataErasureSchema,
    AdminExportResponseSchema,
    MemberListResponseSchema,
    AuditLogResponseSchema,
    InviteResponseSchema,
    ImportResponseSchema,
    EraseDataResponseSchema,
} from '../../lib/validations/admin.schema';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { templates, agreements as agreementTable, inspections, inspectionResults, erasureLog } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { syncInspectionAssignmentsBatch } from '../../lib/db/assignment-links';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';


/**
 * GET /api/admin/export
 */
const exportDataRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/export',
    tags: ["admin"],
    summary: "Export tenant for current tenant",
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AdminExportResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "exportTenant",
    description: "Auto-generated placeholder for exportTenant (GET /export, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * POST /api/admin/invite
 */
const inviteMemberRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/invite',
    tags: ["admin"],
    summary: "Invite tenant for current tenant",
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: InviteMemberSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: InviteResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Created',
        },
    },
    operationId: "inviteTenant",
    description: "Auto-generated placeholder for inviteTenant (POST /invite, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


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


/**
 * GET /api/admin/members
 */
const listMembersRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/members',
    tags: ["admin"],
    summary: "List tenant members for current tenant",
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: MemberListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantMembers",
    description: "Auto-generated placeholder for listTenantMembers (GET /members, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * GET /api/admin/audit-logs
 */
const getAuditLogsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/audit-logs',
    tags: ["admin"],
    summary: "List tenant audit logs",
    middleware: [requireRole('owner', 'manager')],
    request: {
        query: z.object({
            limit: z.string().optional().describe('TODO describe limit field for the OpenInspection MCP integration'),
            cursor: z.string().optional().describe('TODO describe cursor field for the OpenInspection MCP integration'),
            action: z.string().optional().describe('TODO describe action field for the OpenInspection MCP integration'),
            entityType: z.string().optional().describe('TODO describe entityType field for the OpenInspection MCP integration'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AuditLogResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantAuditLogs",
    description: "Auto-generated placeholder for listTenantAuditLogs (GET /audit-logs, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * POST /api/admin/audit-logs
 *
 * Sprint 1 Sub-spec A Task 12 (A-11): client-callable endpoint so the
 * conflict-modal can record \`inspection.sync_conflict_resolved\` audit
 * entries. The action enum is constrained to the small set inspectors
 * can legitimately log; all other audit actions are server-side only.
 */
const InspectorAuditActionSchema = z.enum(['inspection.sync_conflict_resolved']);

const postAuditLogRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/audit-logs',
    tags: ["admin"],
    summary: 'Record an inspector-driven audit event',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        action:       InspectorAuditActionSchema.describe('TODO describe action field for the OpenInspection MCP integration'),
                        resourceType: z.string().min(1).max(64).describe('TODO describe resourceType field for the OpenInspection MCP integration'),
                        resourceId:   z.string().min(1).max(128).describe('TODO describe resourceId field for the OpenInspection MCP integration'),
                        detail:       z.record(z.string(), z.unknown()).optional().describe('TODO describe detail field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Recorded',
        },
    },
    operationId: "createTenantAuditLogs",
    description: "Auto-generated placeholder for createTenantAuditLogs (POST /audit-logs, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * DELETE /api/admin/data
 */
const eraseDataRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/data',
    tags: ["admin"],
    summary: "Delete tenant data for current tenant",
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: DataErasureSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: EraseDataResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "deleteTenantData",
    description: "Auto-generated placeholder for deleteTenantData (DELETE /data, admin domain). TODO: replace with a real description sourced from the handler."
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


// -----------------------------------------------------------------------------
// GET /api/admin/compliance/erasure-log — recent DSAR (erasure) decision records
// -----------------------------------------------------------------------------
// Track I-a (spec §8/§9). The append-only accountability record (GDPR Art. 5(2) /
// Art. 30) made VISIBLE in Settings → Compliance. Tenant-scoped, newest first.
// Exposes ONLY the fields the admin already has visibility into: subject_email
// (they typed it to initiate the erasure), status, counts, and the parsed
// decision array. NO token material, NO requested_by / identity_basis PII.
// decisions_json is operator-written and tolerant-read (it can carry extra
// keys / legacy shapes); keep the response schema permissive so a corrupt or
// evolving payload never blocks the accountability view.
const ErasureLogRowSchema = z.object({
    id:              z.string(),
    subjectEmail:    z.string().describe('Data subject whose erasure was requested (admin already sees this).'),
    status:          z.string().describe('completed | partially_completed | refused.'),
    retainedCount:   z.number(),
    anonymizedCount: z.number(),
    deletedCount:    z.number(),
    decisions:       z.array(z.unknown()).describe('Parsed decisions_json: [{ table, action, count, legalBasis?, retentionExpiry? }].'),
    createdAt:       z.number().describe('Unix ms.'),
}).openapi('ErasureLogRow');

const ErasureLogResponseSchema = z.object({
    success: z.literal(true),
    data:    z.array(ErasureLogRowSchema),
}).openapi('ErasureLogResponse');

const erasureLogRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/compliance/erasure-log',
    tags: ['admin'],
    summary: 'Recent GDPR erasure (DSAR) decision records for the tenant',
    middleware: [requireRole('owner', 'manager')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: ErasureLogResponseSchema } },
            description: 'Up to 50 most-recent erasure log rows, newest first. No token material.',
        },
    },
    operationId: 'listComplianceErasureLog',
    description: 'Returns the tenant-scoped append-only erasure accountability record (Track I-a). Newest first, capped at 50. Exposes subject_email + status + counts + parsed decisions only.',
}, { scopes: ['admin'], tier: 'extended' }));


export const adminDataRoutes = createApiRouter()
    .openapi(exportDataRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const adminService = c.var.services.admin;
        const data = await adminService.getExport(tenantId);

        auditFromContext(c, 'data.export', 'bulk_export');

        return c.json({ success: true, data: { exportedAt: new Date().toISOString(), tenantId, ...data } }, 200);
    })
    .openapi(inviteMemberRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');

        const adminService = c.var.services.admin;
        const { inviteId, expiresAt } = await adminService.createInvite(tenantId, body.email, body.role);

        const inviteLink = `${getBaseUrl(c)}/join?token=${inviteId}`;

        const emailPromise = c.var.services.email.sendInvitation(body.email, inviteLink)
            .catch(() => { /* email delivery is best-effort */ });
        c.executionCtx.waitUntil(emailPromise);

        return c.json({ success: true, data: { inviteLink, expiresAt: expiresAt.toISOString() } }, 201);
    })
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
            paymentStatus?: 'unpaid' | 'partial' | 'paid'; price?: number; createdAt?: string
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
            await db.insert(inspections).values({
                id: ins.id, tenantId, propertyAddress: ins.propertyAddress,
                inspectorId: ins.inspectorId || null, clientName: ins.clientName || null,
                clientEmail: ins.clientEmail || null, templateId: ins.templateId || null,
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
    .openapi(listMembersRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const adminService = c.var.services.admin;
        const members = await adminService.getMembers(tenantId);

        // Map Date to string for schema compatibility
        const formattedMembers = members.members.map((m: { id: string; email: string; role: string; createdAt: Date }) => ({
            ...m,
            createdAt: safeISODate(m.createdAt)
        }));

        return c.json({ success: true, data: formattedMembers }, 200);
    })
    .openapi(getAuditLogsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { limit, cursor, action, entityType } = c.req.valid('query');
        const adminService = c.var.services.admin;
        const result = await adminService.getAuditLogs(tenantId, {
            limit: parseInt(limit || '50'),
            cursor,
            action,
            entityType
        } as Parameters<typeof adminService.getAuditLogs>[1]);

        // Map Date to string for schema compatibility
        const formattedResult = {
            ...result,
            items: result.logs.map((log: (typeof result.logs)[number]) => ({
                ...log,
                createdAt: safeISODate(log.createdAt)
            }))
        };

        auditFromContext(c, 'audit.view', 'audit_log');

        return c.json({ success: true, data: formattedResult }, 200);
    })
    .openapi(postAuditLogRoute, async (c) => {
        const { action, resourceType, resourceId, detail } = c.req.valid('json');
        auditFromContext(c, action, resourceType, {
            entityId: resourceId,
            ...(detail ? { metadata: detail } : {}),
        });
        return c.json({ success: true }, 200);
    })
    .openapi(eraseDataRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const adminService = c.var.services.admin;
        const counts = await adminService.eraseClientData(tenantId, body.clientEmail, {
            requestedBy: c.get('user')?.sub,
        });

        auditFromContext(c, 'data.delete', 'client', {
            metadata: { clientEmail: body.clientEmail, ...counts },
        });

        return c.json({ success: true, data: { message: 'Client data erased successfully.', ...counts } }, 200);
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
    })
    .openapi(erasureLogRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        const rows = await db
            .select({
                id:              erasureLog.id,
                subjectEmail:    erasureLog.subjectEmail,
                status:          erasureLog.status,
                retainedCount:   erasureLog.retainedCount,
                anonymizedCount: erasureLog.anonymizedCount,
                deletedCount:    erasureLog.deletedCount,
                decisionsJson:   erasureLog.decisionsJson,
                createdAt:       erasureLog.createdAt,
            })
            .from(erasureLog)
            .where(eq(erasureLog.tenantId, tenantId))
            .orderBy(descDz(erasureLog.createdAt))
            .limit(50);

        const data = rows.map((r) => {
            // decisions_json is written by the orchestrator; tolerate corruption.
            let decisions: unknown[] = [];
            try {
                const parsed = JSON.parse(r.decisionsJson);
                if (Array.isArray(parsed)) decisions = parsed;
            } catch {
                decisions = [];
            }
            return {
                id:              r.id,
                subjectEmail:    r.subjectEmail,
                status:          r.status,
                retainedCount:   r.retainedCount,
                anonymizedCount: r.anonymizedCount,
                deletedCount:    r.deletedCount,
                decisions,
                createdAt:       r.createdAt,
            };
        });

        return c.json({ success: true as const, data }, 200);
    });

export type AdminDataApi = typeof adminDataRoutes;
export default adminDataRoutes;
