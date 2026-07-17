import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from '../shared.schema';
import { ROLES } from '../../auth/roles';

/**
 * Validation schema for inviting a new team member.
 */
export const InviteMemberSchema = z.object({
    email: z.string().email('Invalid email address').openapi({ example: 'new-user@example.com' }).describe('TODO describe email field for the OpenInspection MCP integration'),
    role: z.enum(ROLES)
        .default('inspector').openapi({ example: 'inspector' }).describe('TODO describe role field for the OpenInspection MCP integration'),
    // Role permission-template overrides (2026-06-13). Optional sparse map of the
    // four toggleable capabilities. Only differing-from-template keys are sent;
    // TeamService stores the diff (or null when nothing differs) and it is
    // replayed onto the new users row at accept time.
    permissionOverrides: z.object({
        publish: z.boolean().optional(),
        scheduleOthers: z.boolean().optional(),
        financial: z.boolean().optional(),
        manageContacts: z.boolean().optional(),
    }).partial().optional().openapi({ example: { publish: false } }).describe('Sparse capability override map for the invited member'),
}).openapi('InviteMember');

/**
 * Validation schema for the GDPA data erasure request.
 */
export const DataErasureSchema = z.object({
    clientEmail: z.string().email('Invalid email address').openapi({ example: 'client-to-delete@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
}).openapi('DataErasure');

/**
 * Response Schemas
 */
export const AdminExportResponseSchema = createApiResponseSchema(z.object({
    exportedAt: z.string().openapi({ example: '2024-04-09T10:00:00Z' }).describe('TODO describe exportedAt field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    inspections: z.array(z.record(z.string(), z.any())).describe('TODO describe inspections field for the OpenInspection MCP integration'),
    templates: z.array(z.record(z.string(), z.any())).describe('TODO describe templates field for the OpenInspection MCP integration'),
    agreements: z.array(z.record(z.string(), z.any())).describe('TODO describe agreements field for the OpenInspection MCP integration'),
    inspectionResults: z.array(z.record(z.string(), z.any())).describe('TODO describe inspectionResults field for the OpenInspection MCP integration'),
})).openapi('AdminExportResponse');

export const MemberListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
    role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    calendarConnected: z.boolean().describe('Whether this member has a connected Google calendar'),
    calendarLastSyncAt: z.number().nullable().describe('Epoch ms of the last successful Google busy pull; null when never synced'),
}))).openapi('MemberListResponse');

export const AuditLogResponseSchema = createApiResponseSchema(z.object({
    items: z.array(z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        action: z.string().describe('TODO describe action field for the OpenInspection MCP integration'),
        entityType: z.string().describe('TODO describe entityType field for the OpenInspection MCP integration'),
        metadata: z.any().nullable().describe('TODO describe metadata field for the OpenInspection MCP integration'),
        ipAddress: z.string().nullable().describe('TODO describe ipAddress field for the OpenInspection MCP integration'),
        createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
        userId: z.string().uuid().nullable().describe('TODO describe userId field for the OpenInspection MCP integration'),
    })).describe('TODO describe items field for the OpenInspection MCP integration'),
    nextCursor: z.string().nullable().describe('TODO describe nextCursor field for the OpenInspection MCP integration'),
})).openapi('AuditLogResponse');

export const InviteResponseSchema = createApiResponseSchema(z.object({
    inviteLink: z.string().describe('TODO describe inviteLink field for the OpenInspection MCP integration'),
    expiresAt: z.string().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
})).openapi('InviteResponse');

export const ImportResponseSchema = createApiResponseSchema(z.object({
    message: z.string().describe('TODO describe message field for the OpenInspection MCP integration'),
    imported: z.object({
        templates: z.number().describe('TODO describe templates field for the OpenInspection MCP integration'),
        agreements: z.number().describe('TODO describe agreements field for the OpenInspection MCP integration'),
        inspections: z.number().describe('TODO describe inspections field for the OpenInspection MCP integration'),
        results: z.number().describe('TODO describe results field for the OpenInspection MCP integration'),
    }).describe('TODO describe imported field for the OpenInspection MCP integration'),
})).openapi('ImportResponse');

export const EraseDataResponseSchema = createApiResponseSchema(z.object({
    message: z.string().describe('Human-readable confirmation message.'),
    // Legacy additive fields (preserved for existing callers).
    templates: z.number().optional().describe('Legacy field — number of template rows affected.'),
    inspections: z.number().optional().describe('Legacy field — number of inspection rows matched.'),
    results: z.number().optional().describe('Legacy field — total result rows affected.'),
    matched: z.number().optional().describe('Number of inspections the subject appeared on.'),
    deletedAgreements: z.number().optional().describe('Legacy additive field — number of matched inspections (mirrors matched).'),
    // Orchestrator summary fields (Track I-a).
    status: z.enum(['completed', 'partially_completed', 'refused']).optional()
        .describe('Overall erasure outcome. partially_completed means at least one step threw; the rest still landed.'),
    logId: z.string().optional().describe('UUID of the append-only erasure_log decision row (Art. 5(2)/30).'),
    anonymizedCount: z.number().int().optional()
        .describe('Total rows anonymized (PII sentinel-cleared, evidence retained under Art. 17(3) exemption).'),
    deletedCount: z.number().int().optional()
        .describe('Total rows deleted (draft envelopes + signer rows + contact rows).'),
    retainedCount: z.number().int().optional()
        .describe('Total rows retained as anonymized evidence (signer rows + envelope rows, post-anonymization).'),
    decisions: z.array(z.object({
        table: z.string().describe('DB table the decision applies to.'),
        action: z.enum(['delete', 'null', 'anonymize']).describe('Action taken on this table.'),
        count: z.number().int().describe('Rows affected.'),
        legalBasis: z.enum(['art_17_3_b', 'art_17_3_e']).optional()
            .describe('GDPR Art. 17(3) exemption invoked, when retaining evidence.'),
        retentionExpiry: z.number().optional()
            .describe('Unix-MS integer: signedAt + retentionYears. Present on anonymize steps.'),
        error: z.string().optional()
            .describe('Set when this step threw (fail-closed accountability).'),
    })).optional().describe('Per-table erasure decisions recorded in the log row.'),
})).openapi('EraseDataResponse');

export const TeamMembersResponseSchema = createApiResponseSchema(z.object({
    members: z.array(z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
        role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
        createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    })).describe('TODO describe members field for the OpenInspection MCP integration'),
    invites: z.array(z.object({
        id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
        email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
        role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
        status: z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
        expiresAt: z.string().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
    })).describe('TODO describe invites field for the OpenInspection MCP integration'),
})).openapi('TeamMembersResponse');
