/**
 * Repair-builder shared gate/predicate helpers.
 *
 * Extracted from server/api/repair-builder.ts (pure movement):
 *   - runBuilderGate   — publish + tenant-flag gate for the CRUD/source routes
 *   - runAssertCanEdit — wraps the service assertCanEdit into explicit 403/404
 *   - runShareGate     — shareToken lookup + publish gate for the share routes
 */

import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, tenantConfigs } from './db/schema';
import { isReportPublished } from './status/report-status';
import { mayAuthorRepairActionTag } from './repair-action-tag';
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

    // THE RELEASE GATE APPLIES HERE TOO, and for the same reason it applies to
    // the report itself: what this route serves IS report content. The builder
    // hands a client every defect in the inspection, so a workspace holding the
    // report for a signed agreement or an outstanding payment would have the
    // whole substance of it walk out through this door while the report page
    // beside it correctly refused. One rule, every door that opens onto it.
    const releaseGate = await c.var.services.inspection.resolveReleaseGate(id, tenantId);
    if (releaseGate) {
        return c.json(
            { success: false as const, error: { code: 'REPORT_GATED', message: 'This report has not been released yet.' } },
            403,
        );
    }

    return null;
}

/**
 * #275 — the tenant's configured repair-note quick phrases, VERBATIM.
 *
 * NULL is returned as null and never substituted here. "Never configured"
 * (null → the seeded defaults) and "deliberately emptied" ([] → no buttons at
 * all) are different states, and the defaults are localized product strings the
 * client owns, not server constants. Collapsing the two on the way out would
 * take away the tenant's only off switch and nobody would notice, because the
 * defaults look intentional.
 */
export async function loadQuickPhrases(
    c: Context<HonoConfig>,
    tenantId: string,
): Promise<string[] | null> {
    const cfg = await drizzle(c.env.DB)
        .select({ repairQuickPhrases: tenantConfigs.repairQuickPhrases })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();
    return cfg?.repairQuickPhrases ?? null;
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
    accessLevel: 'read' | 'readwrite' = 'readwrite',
): Promise<Response | null> {
    // IA-35 / IA-73 — a read-only actor (agent under the tenant's `read`
    // policy) may see the list but not mutate it. Refuse before the ownership
    // check so a read-only agent gets a clean 403, not a "not the creator" one.
    if (accessLevel !== 'readwrite') {
        return c.json({ success: false as const, error: { code: 'FORBIDDEN', message: 'Read-only access to the repair list.' } }, 403);
    }
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
 * #275 — WHO may author the repair-vs-replace tag, enforced at the boundary.
 *
 * Returns a 403 Response when a non-null tag arrives from an inspector, and null
 * otherwise. Call it AFTER `runAssertCanEdit` so a read-only agent still gets
 * its 403 for the right reason, and so an unauthorized caller is never told
 * anything about the field.
 *
 * ⚠️ It refuses the FIELD, not the request. `undefined` and `null` both pass:
 * an inspector on owner-preview creates lists and adds untagged items today
 * (`repair-access.ts` gives that JWT `kind: 'inspector'`, `readwrite`), and
 * refusing the write would break a working flow. `runAssertCanEdit` cannot do
 * this job — it looks only at `accessLevel` and creator identity, never at
 * `creator.kind` — and `lint:capability-decl` is inert here because these
 * routes use no `requireCapability(...)`.
 */
export function runAssertMayAuthorTag(
    c: Context<HonoConfig>,
    creator: import('../services/repair-request.service').Creator,
    tag: string | null | undefined,
): Response | null {
    if (tag == null) return null;
    if (mayAuthorRepairActionTag(creator.kind)) return null;
    return c.json({
        success: false as const,
        error: {
            code: 'FORBIDDEN',
            message: 'The repair-vs-replace tag is authored by the buyer or their agent.',
        },
    }, 403);
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

    // THE RELEASE GATE APPLIES TO THE SHARE TRACK TOO, and this door is the one
    // most easily missed: its credential is a share token minted when the list
    // was built, so a link created BEFORE a company switched on "require
    // payment" keeps working forever unless the hold is checked on every read.
    // The hold is per-inspection and can be switched on at any time, so a link
    // that was legitimate yesterday is not evidence that it is legitimate now.
    //
    // What it serves is the same report-derived defect content `runBuilderGate`
    // above is gated for — the item list, its PDF, and the email that carries
    // them — 130 lines apart in this same file. It was left out of the first
    // pass by oversight, not by an argument; the one door that IS deliberately
    // exempt (the per-version verify endpoint) carries its reasoning at its own
    // check, which is the standard any future exemption has to meet.
    const releaseGate = await c.var.services.inspection.resolveReleaseGate(
        request.inspectionId,
        request.tenantId,
    );
    if (releaseGate) {
        return c.json(
            { success: false as const, error: { code: 'REPORT_GATED', message: 'This report has not been released yet.' } },
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
