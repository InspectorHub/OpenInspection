/**
 * Repair-builder shared gate/predicate helpers.
 *
 * Extracted from server/api/repair-builder.ts (pure movement):
 *   - runBuilderGate   — publish + tenant-flag gate for the CRUD/source routes
 *   - runAssertCanEdit — wraps the service assertCanEdit into explicit 403/404
 *   - runShareGate     — shareToken lookup + publish gate for the share routes
 *   - getBaseUrl       — absolute base URL from env or Host header
 */

import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, tenantConfigs } from './db/schema';
import { isReportPublished } from './status/report-status';
import type { HonoConfig } from '../types/hono';

/**
 * Runs the publish gate + tenant-flag gate (same two drizzle queries as the
 * source route). Returns a 403 Response on failure, or null on success so the
 * caller can continue.
 *
 * Usage:
 *   const gate = await runBuilderGate(c, id, tenantId);
 *   if (gate) return gate;
 */
export async function runBuilderGate(
    c: Context<HonoConfig>,
    id: string,
    tenantId: string,
) {
    const insp = await drizzle(c.env.DB)
        .select({ reportStatus: inspections.reportStatus })
        .from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
        .get();
    if (!insp || !isReportPublished(insp.reportStatus)) {
        return c.json(
            { success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } },
            403,
        );
    }

    const cfg = await drizzle(c.env.DB)
        .select({ enableCustomerRepairExport: tenantConfigs.enableCustomerRepairExport })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();
    if (!cfg?.enableCustomerRepairExport) {
        return c.json(
            { success: false as const, error: { code: 'FORBIDDEN', message: 'Repair request is not enabled.' } },
            403,
        );
    }

    return null;
}

/**
 * Wraps assertCanEdit: catches Forbidden/NotFound errors thrown by the service
 * and returns an explicit 403/404 json Response so the route handler can
 * `return handleEditGuard(...)` without the error surfacing as a 500.
 */
export async function runAssertCanEdit(
    c: Context<HonoConfig>,
    tenantId: string,
    inspectionId: string,
    rrId: string,
    creator: import('../services/repair-request.service').Creator,
): Promise<Response | null> {
    try {
        await c.var.services.repairRequest.assertCanEdit(tenantId, inspectionId, rrId, creator);
        return null;
    } catch (err: unknown) {
        // AppError carries a `code` string. Map Forbidden/NotFound to explicit JSON.
        const code = (err as { code?: string }).code ?? '';
        if (code === 'forbidden' || code === 'FORBIDDEN') {
            return c.json({ success: false as const, error: { code: 'FORBIDDEN', message: (err as Error).message ?? 'Forbidden.' } }, 403);
        }
        if (code === 'not_found' || code === 'NOT_FOUND') {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: (err as Error).message ?? 'Not found.' } }, 404);
        }
        // Re-throw unexpected errors.
        throw err;
    }
}

/**
 * Share gate: look up the repair request by shareToken, then check that its
 * inspection is currently published. Returns a structured result on success,
 * or a Response (403/404) on failure.
 *
 * Also fetches `propertyAddress` so callers don't need a second query.
 */
export async function runShareGate(
    c: Context<HonoConfig>,
    shareToken: string,
): Promise<
    | {
          request: { id: string; tenantId: string; inspectionId: string; customIntro: string | null };
          items: unknown[];
          tenantId: string;
          propertyAddress: string | null;
      }
    | Response
> {
    const result = await c.var.services.repairRequest.getByShareToken(shareToken);
    if (!result) {
        return c.json(
            { success: false as const, error: { code: 'NOT_FOUND', message: 'Repair request not found.' } },
            404,
        );
    }

    const { request, items } = result;
    const insp = await drizzle(c.env.DB)
        .select({ reportStatus: inspections.reportStatus, propertyAddress: inspections.propertyAddress })
        .from(inspections)
        .where(and(eq(inspections.id, request.inspectionId), eq(inspections.tenantId, request.tenantId)))
        .get();

    if (!insp || !isReportPublished(insp.reportStatus)) {
        return c.json(
            { success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } },
            403,
        );
    }

    return {
        request,
        items,
        tenantId: request.tenantId,
        propertyAddress: insp.propertyAddress ?? null,
    };
}

/** Derive the absolute base URL from env or the incoming Host header. */
export function getBaseUrl(c: Context<HonoConfig>): string {
    return (c.env.APP_BASE_URL || '').replace(/\/$/, '')
        || (c.req.header('host') ? `https://${c.req.header('host')}` : '');
}
