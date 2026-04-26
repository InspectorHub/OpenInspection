import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Validation schema for the branding configuration update.
 */
export const UpdateBrandingSchema = z.object({
    siteName: z.string().min(1, 'Site name is required').max(50).optional().openapi({ example: 'My Inspection Pro' }),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional().openapi({ example: '#4f46e5' }),
    supportEmail: z.string().email('Invalid email address').optional().openapi({ example: 'support@example.com' }),
    billingUrl: z.string().url('Invalid URL').or(z.literal('')).optional().openapi({ example: 'https://example.com/billing' }),
    gaMeasurementId: z.string().regex(/^G-[A-Z0-9]+$/, 'Invalid GA Measurement ID').or(z.literal('')).optional().openapi({ example: 'G-12345678' }),
}).openapi('UpdateBranding');

/**
 * Validation schema for inviting a new team member.
 */
export const InviteMemberSchema = z.object({
    email: z.string().email('Invalid email address').openapi({ example: 'new-user@example.com' }),
    role: z.enum(['admin', 'inspector', 'agent', 'owner']).default('inspector').openapi({ example: 'inspector' }),
}).openapi('InviteMember');

/**
 * Validation schema for the GDPA data erasure request.
 */
export const DataErasureSchema = z.object({
    clientEmail: z.string().email('Invalid email address').openapi({ example: 'client-to-delete@example.com' }),
}).openapi('DataErasure');

/**
 * Validation schema for creating/updating agreements.
 */
export const AgreementSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100).openapi({ example: 'Standard Service Agreement' }),
    content: z.string().min(1, 'Content is required').openapi({ example: 'This agreement governs...' }),
}).openapi('Agreement');

/**
 * Validation schema for tenant status updates (M2M).
 */
export const TenantStatusSchema = z.object({
    id: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    subdomain: z.string().min(1).openapi({ example: 'acme' }),
    status: z.string().min(1).openapi({ example: 'active' }),
    tier: z.string().optional().openapi({ example: 'pro' }),
    name: z.string().optional().openapi({ example: 'Acme Corp' }),
    deploymentMode: z.enum(['shared', 'silo']).default('shared').openapi({ example: 'shared' }),
    setupVerificationCode: z.string().optional().openapi({ example: 'XYZ12345' }),
    adminEmail: z.string().email().optional().openapi({ example: 'admin@acme.com' }),
    adminPasswordHash: z.string().optional().openapi({ example: '...sha256...' }),
}).openapi('TenantStatus');

/**
 * Validation schema for silo DB ID updates (M2M).
 */
export const SiloUpdateSchema = z.object({
    tenantId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    siloDbId: z.string().min(1).openapi({ example: 'db_12345' }),
}).openapi('SiloUpdate');

/**
 * Validation schema for Stripe Connect updates (M2M).
 */
export const StripeConnectSchema = z.object({
    subdomain: z.string().min(1).openapi({ example: 'acme' }),
    stripeConnectAccountId: z.string().min(1).openapi({ example: 'acct_12345' }),
}).openapi('StripeConnect');

/**
 * Body schema for PATCH /api/integration/tenants/:subdomain (M2M).
 * subdomain comes from URL param, not body.
 */
export const TenantStatusBodySchema = z.object({
    id: z.string().uuid().optional(),
    status: z.string().min(1),
    tier: z.string().optional(),
    name: z.string().optional(),
    deploymentMode: z.enum(['shared', 'silo']).optional(),
    setupVerificationCode: z.string().optional(),
    maxUsers: z.number().int().positive().optional(),
    adminEmail: z.string().email().optional(),
    adminPasswordHash: z.string().optional(),
});

/**
 * Body schema for POST /api/integration/tenants/:subdomain/stripe-connect (M2M).
 */
export const StripeConnectBodySchema = z.object({
    accountId: z.string().min(1),
});

/**
 * Response Schemas
 */
export const AdminExportResponseSchema = createApiResponseSchema(z.object({
    exportedAt: z.string().openapi({ example: '2024-04-09T10:00:00Z' }),
    tenantId: z.string().uuid(),
    inspections: z.array(z.record(z.string(), z.any())),
    templates: z.array(z.record(z.string(), z.any())),
    agreements: z.array(z.record(z.string(), z.any())),
    inspectionResults: z.array(z.record(z.string(), z.any())),
})).openapi('AdminExportResponse');

export const MemberListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().uuid(),
    email: z.string(),
    role: z.string(),
    createdAt: z.string(),
}))).openapi('MemberListResponse');

export const AuditLogResponseSchema = createApiResponseSchema(z.object({
    items: z.array(z.object({
        id: z.string().uuid(),
        action: z.string(),
        entityType: z.string(),
        metadata: z.any().nullable(),
        ipAddress: z.string().nullable(),
        createdAt: z.string(),
        userId: z.string().uuid().nullable(),
    })),
    nextCursor: z.string().nullable(),
})).openapi('AuditLogResponse');

export const BrandingResponseSchema = createApiResponseSchema(z.object({
    branding: z.object({
        siteName: z.string(),
        primaryColor: z.string(),
        logoUrl: z.string().nullable(),
        supportEmail: z.string(),
        billingUrl: z.string().nullable(),
        gaMeasurementId: z.string().nullable(),
    }),
})).openapi('BrandingResponse');

export const InviteResponseSchema = createApiResponseSchema(z.object({
    inviteLink: z.string(),
    expiresAt: z.string(),
})).openapi('InviteResponse');

export const ImportResponseSchema = createApiResponseSchema(z.object({
    message: z.string(),
    imported: z.object({
        templates: z.number(),
        agreements: z.number(),
        inspections: z.number(),
        results: z.number(),
    }),
})).openapi('ImportResponse');

export const AgreementListResponseSchema = createApiResponseSchema(z.object({
    agreements: z.array(z.object({
        id: z.string().uuid(),
        tenantId: z.string().uuid(),
        name: z.string(),
        content: z.string(),
        version: z.number(),
        createdAt: z.string(),
    })),
})).openapi('AgreementListResponse');

export const AgreementResponseSchema = createApiResponseSchema(z.object({
    agreement: z.object({
        id: z.string().uuid(),
        tenantId: z.string().uuid(),
        name: z.string(),
        content: z.string(),
        version: z.number(),
        createdAt: z.string(),
    }),
})).openapi('AgreementResponse');

export const EraseDataResponseSchema = createApiResponseSchema(z.object({
    message: z.string(),
    templates: z.number().optional(),
    inspections: z.number().optional(),
    results: z.number().optional(),
})).openapi('EraseDataResponse');

export const TeamMembersResponseSchema = createApiResponseSchema(z.object({
    members: z.array(z.object({
        id: z.string().uuid(),
        email: z.string(),
        role: z.string(),
        createdAt: z.string(),
    })),
    invites: z.array(z.object({
        id: z.string(),
        email: z.string(),
        role: z.string(),
        status: z.string(),
        expiresAt: z.string(),
    })),
})).openapi('TeamMembersResponse');
