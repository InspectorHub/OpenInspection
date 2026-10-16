// Admin → Data & members sub-router (Phase 1.3 split of server/api/admin.ts).
//
// Tenant export/import, member invite/list, audit-log read + inspector-driven
// write, GDPR data erasure + erasure-log accountability view, and the one-time
// finding-key migration. Route definitions are co-located with their
// `.openapi()` handlers; bodies are byte-identical to the original admin.ts.
// Mounted at `/` by the admin aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { eq, desc as descDz } from 'drizzle-orm';
import { requireRole } from '../../lib/middleware/rbac';
import { capabilitiesFor } from '../../lib/middleware/require-capability';
import { auditFromContext } from '../../lib/audit';
import { safeISODate } from '../../lib/date';
import type { MemberWithCalendarSync } from '../../services/admin.service';
import { inviteAcceptUrl } from '../../lib/url';
import {
    InviteMemberSchema,
    DataErasureSchema,
    AdminExportResponseSchema,
    MemberListResponseSchema,
    AuditLogResponseSchema,
    InviteResponseSchema,
    EraseDataResponseSchema,
} from '../../lib/validations/admin.schema';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { InspectorAuditLogSchema } from '../../lib/validations/audit-log-write.schema';
import { erasureLog } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { getDrizzle } from '../../lib/route-helpers';
import { moneyView } from '../../lib/auth/money-access';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';


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
                    schema: AdminExportResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "exportTenant",
    description: "Returns a full JSON export of the company's data in one response: every inspection, template and agreement template row, all inspection results, and the agreement signing requests with their per-signer records. Signing-request token columns are deliberately left out, so signing links cannot be rebuilt from the export. Not paginated, so the response can be very large. Side effect: each call writes a data.export entry to the audit log. Restricted to owners and managers."
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
                    schema: InviteMemberSchema.describe('Who to invite and with which role'),
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: InviteResponseSchema,
                },
            },
            description: 'Created',
        },
        403: { description: 'Only an owner can invite someone as an owner' },
    },
    operationId: "inviteTenant",
    description: "Invite a person to join the company team. Creates a pending invite that expires after 7 days and emails the recipient the accept link (the email is sent in the background; if it is refused or fails, the invite still exists and the call still succeeds, so deliver the returned inviteLink yourself when in doubt). Only an owner may invite someone as an owner (403 otherwise). The body also lists notify and permissionOverrides, but this route does not apply either: it always sends the email and grants the plain role. Each call creates a new invite; repeating an email creates another. Restricted to owners and managers."
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
                    schema: MemberListResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantMembers",
    description: "Lists the company's user accounts with id, email, role and creation time, plus whether each has a calendar connected and when it last synced. Pending invitations are not included; the invite route and the team members route cover those. Not paginated. Read-only. Restricted to owners and managers."
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
            limit: z.string().optional().describe('Number of log entries per page, sent as a numeric string. Defaults to 50 when omitted.'),
            cursor: z.string().optional().describe('Opaque paging token: the nextCursor value from the previous response. A value that is not a valid token is rejected with 400.'),
            action: z.string().optional().describe('Return only entries whose action matches this value exactly, for example inspection.create.'),
            entityType: z.string().optional().describe('Return only entries for this entity type, matched exactly, for example audit_log.'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AuditLogResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantAuditLogs",
    description: "Returns the company's audit log, newest first, one page at a time. Pass the nextCursor from a response back as cursor to read the next page; hasMore says whether another page exists. action and entityType filter by exact match. Side effect: each call writes an audit.view entry to the audit log itself. Restricted to owners and managers."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * POST /api/admin/audit-logs
 *
 * Sprint 1 Sub-spec A Task 12 (A-11): client-callable endpoint so the
 * conflict-modal can record \`inspection.sync_conflict_resolved\` audit
 * entries. The action enum is constrained to the small set inspectors
 * can legitimately log; all other audit actions are server-side only.
 */
// The schemas moved to `lib/validations/audit-log-write.schema.ts` (repo rule: Zod lives
// there, not inline in a handler). `resourceType` used to be an unconstrained
// 64-character string; it is now the closed family list.

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
                    schema: InspectorAuditLogSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Recorded',
        },
    },
    operationId: "createTenantAuditLogs",
    description: "Append one client-reported event to the company audit log. The only action accepted is inspection.sync_conflict_resolved, which the offline editor reports when an inspector resolves a sync conflict; every other audit action is written by the server itself and cannot be forged here. The entity family must be one of the known families, and detail is free-form metadata that is redacted by value shape when written. Each call appends a new entry; repeating it records the event again. Open to owners, managers and inspectors."
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
                    schema: DataErasureSchema.describe('The client whose personal data is to be erased'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: EraseDataResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "deleteTenantData",
    description: "Erase a client's personal data, found by email address, from this company (a data-subject erasure request). Irreversible. Signed agreements are kept as evidence: their personal details are anonymised in place while the signature, signing times and signing audit trail remain. Agreements nobody has signed are deleted, and the client's contact record is deleted. Erasure is recorded in an append-only erasure log. The response reports the outcome status (completed, partially_completed, refused or held) with counts of rows anonymised, deleted and retained; a status other than completed means some data was kept or a step failed, so read the decisions before telling anyone it is done. Restricted to owners and managers."
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
    status:          z.string().describe('completed | partially_completed | refused | held.'),
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

const adminDataRoutes = createApiRouter()
    .openapi(exportDataRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const adminService = c.var.services.admin;
        const data = await adminService.getExport(tenantId);

        auditFromContext(c, 'data.export', 'bulk_export');
        // Only inspection rows carry company money; templates are customer JSON.
        return c.json({ success: true, data: { exportedAt: new Date().toISOString(), tenantId, ...data, inspections: await moneyView(c, data.inspections, 'companyFinance') } }, 200);
    })
    .openapi(inviteMemberRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');

        const adminService = c.var.services.admin;
        const { inviteId, expiresAt } = await adminService.createInvite(tenantId, body.email, body.role, c.get('userRole'), await capabilitiesFor(c));

        const inviteLink = inviteAcceptUrl(c, inviteId);

        const emailPromise = c.var.services.email.sendInvitation(body.email, inviteLink)
            .catch((e: unknown) => {
                // The invite row and link are already created; the admin has the
                // inviteLink in the response and can share it manually. But we
                // want to distinguish a platform-level refusal (domain unverified,
                // quota exhausted, address suppressed) from a transient failure so
                // ops can act on it rather than assuming everything is fine.
                if (e instanceof AppError) {
                    logger.warn('admin.invite.email.refused', { code: e.code });
                } else {
                    logger.error('admin.invite.email.failed', {}, e instanceof Error ? e : undefined);
                }
            });
        c.executionCtx.waitUntil(emailPromise);

        return c.json({ success: true, data: { inviteLink, expiresAt: expiresAt.toISOString() } }, 201);
    })
    .openapi(listMembersRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const adminService = c.var.services.admin;
        const members = await adminService.getMembers(tenantId);

        // Map Date to string for schema compatibility.
        const formattedMembers = members.members.map((m: MemberWithCalendarSync) => ({
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
    .openapi(erasureLogRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);

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
                createdAt:       r.createdAt.getTime(),
            };
        });

        return c.json({ success: true as const, data }, 200);
    });

export default adminDataRoutes;
