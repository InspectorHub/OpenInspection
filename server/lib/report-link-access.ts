/**
 * Who may read a report link, and what media they may fetch with it.
 *
 * The report data, photo, video and PDF routes each prove the caller the same way: a persistent portal token for THIS inspection
 * (or the legacy share token), a server-minted render token (the headless PDF renderer), or an owner session. The company always
 * comes from that proof, never from the URL. Photos and video then apply the same two gates as the data route: the report must be
 * published, and no agreement or payment hold may be outstanding. They live here so a new media route cannot forget one.
 */
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { inspections, tenants } from './db/schema';
import { getDrizzle } from './route-helpers';
import { resolvePortalAccess, resolveOwnerPreviewFromCookie } from './public-access';
import { resolveRenderAccess } from './render-token';
import { publicReportAccessAllowed } from './report-access';

/**
 * Shared client-facing tenant resolution for the public report endpoints: the persistent per-(recipient, order) portal token,
 * falling back to the legacy KV agent-view-token bridge (`?view=agent&token=`). Returns the AUTHORITATIVE tenantId from whichever
 * token resolves to THIS inspection, or null. `accessTokenId` is the per-recipient token row's id, or null on the legacy KV bridge
 * (no row), so a bridge view is never counted: it names no recipient.
 */
export async function resolveClientTenant(
    c: Context<HonoConfig>, token: string | undefined, id: string,
): Promise<{ tenantId: string; accessTokenId: string | null } | null> {
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, id);
    if (grant) return { tenantId: grant.tenantId, accessTokenId: grant.accessTokenId };
    if (!token) return null;
    const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
    if (legacy && legacy.inspectionId === id) return { tenantId: legacy.tenantId, accessTokenId: null };
    return null;
}

/**
 * The outstanding release gate for a public request, or null when nothing holds the report back. Skipped entirely on the bypass
 * paths rather than computed and discarded: the predicate ignores it there, and asking anyway would put two reads on every page
 * the headless PDF renderer loads.
 */
export async function releaseGateFor(
    services: { inspection: { resolveReleaseGate(inspectionId: string, tenantId: string): Promise<{ reason: 'payment' | 'agreement' } | null> } },
    id: string,
    tenantId: string,
    bypass: boolean,
): Promise<'payment' | 'agreement' | null> {
    if (bypass) return null;
    const gate = await services.inspection.resolveReleaseGate(id, tenantId);
    return gate?.reason ?? null;
}

/** How a media request proved itself. Render and owner modes bypass the publish and release gates, as they do on the data route. */
interface ReportMediaAccess {
    tenantId: string;
    renderMode: boolean;
    ownerPreview: boolean;
}

/**
 * Prove a media request (photo or video) and apply the report gates. Null means answer 404, whatever the reason: the caller learns
 * nothing about which check failed.
 */
export async function authorizeReportMedia(
    c: Context<HonoConfig>, id: string, proof: { token?: string | undefined; render?: string | undefined },
): Promise<ReportMediaAccess | null> {
    let tenantId = (await resolveClientTenant(c, proof.token, id))?.tenantId ?? null;
    let renderMode = false;
    let ownerPreview = false;
    if (!tenantId && proof.render) {
        const r = await resolveRenderAccess(proof.render, id, c.env.JWT_SECRET);
        if (r) {
            const row = await getDrizzle(c).select({ tenantId: inspections.tenantId })
                .from(inspections).where(eq(inspections.id, id)).get();
            if (row) { tenantId = row.tenantId; renderMode = true; }
        }
    }
    // Owner-session preview: a browser loading an <img> or <video> carries the session cookie but cannot carry a header.
    if (!tenantId) { tenantId = await resolveOwnerPreviewFromCookie(c); ownerPreview = !!tenantId; }
    if (!tenantId) return null;
    // The owner session and the headless renderer bypass both gates, so they need neither read. A report page loads many photos and
    // each is its own request, so reads that cannot change the answer are not made (the PDF renderer alone fetches every photo).
    if (renderMode || ownerPreview) return { tenantId, renderMode, ownerPreview };
    const gateRow = await getDrizzle(c)
        .select({ reportStatus: inspections.reportStatus })
        .from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
        .get();
    // A gate that holds the report but serves its media is not a gate.
    const releaseGate = await releaseGateFor(c.var.services, id, tenantId, false);
    if (!publicReportAccessAllowed({ renderMode, ownerPreview, reportStatus: gateRow?.reportStatus, releaseGate })) return null;
    return { tenantId, renderMode, ownerPreview };
}

/** What a company slug looks like: the only characters the report page path accepts in that position. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62})$/i;

/**
 * The company's slug for a URL we build ourselves (the render URL the headless browser visits), taken from the company's row. The
 * request's own `:tenant` segment is used only when the row has no slug, and only if it is a plain slug: it is the caller's text.
 * An empty result is possible and 404s the render, which is better than a path the caller chose.
 */
export async function companySlugFor(c: Context<HonoConfig>, tenantId: string, requestedSegment: string): Promise<string> {
    const row = await getDrizzle(c).select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).get();
    if (row?.slug) return row.slug;
    return SLUG.test(requestedSegment) ? requestedSegment : '';
}
