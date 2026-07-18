/**
 * Design System 0520 subsystem C P8 T8.2 — seat-quota M2M sync schema.
 *
 * Portal's BillingService.syncSeatQuota POSTs this shape after a Stripe
 * subscription mutation. Tenant id is the foreign key into core's
 * tenants table; maxUsers is the new seat cap. Range cap of 10_000 is
 * defensive — well above any plausible plan.
 */
import { z } from '@hono/zod-openapi';

export const SyncQuotaSchema = z.object({
    tenantId: z.string().min(1).max(128).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    maxUsers: z.number().int().min(1).max(10_000).describe('TODO describe maxUsers field for the OpenInspection MCP integration'),
}).openapi('SyncQuota');

