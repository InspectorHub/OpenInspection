/**
 * GET /sign/:tenant/:id - the bare "sign this inspection's agreement" link.
 *
 * The inspection id is not a credential: it appears in calendar feeds, report links and other pages. So this route never answers an
 * inspection id alone with a signer's own link. A signer's link is returned only for a recipient who proves who they are, and the
 * proof here is the recipient's portal token (`?token=`, the one in their report and invoice links): it names a recipient email, and the
 * link returned is the one of the signer with exactly that email (never "the first signer"). With no proof, or a proof that names no
 * signer, the visitor is sent to the client portal, which asks them to sign in with their email before showing anything.
 */
import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { agreementSignPath } from '../lib/public-urls';
import { resolvePortalAccess } from '../lib/public-access';

export const signRedirectRoutes = new Hono<HonoConfig>().get('/sign/:tenant/:id', async (c) => {
    const id = c.req.param('id');
    const tenantSlug = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    // Tenant slug from the path must match what the tenant router resolved; an unresolved slug is the friendly not-found page.
    if (!tenantId || c.get('requestedTenantSlug') !== tenantSlug) {
        return c.redirect('/not-found?from=agreement-sign', 302);
    }
    const portal = `/portal/${encodeURIComponent(tenantSlug)}/i/${encodeURIComponent(id)}?section=overview`;
    try {
        const grant = await resolvePortalAccess(c.var.services.portalAccess, c.req.query('token'), id);
        // The grant must belong to this company: a token of another company's inspection names nobody here.
        if (grant && grant.tenantId === tenantId && grant.recipientEmail) {
            const link = await c.var.services.agreement.getSignerLinkByEmail(tenantId as string, id, grant.recipientEmail);
            if (link) return c.redirect(agreementSignPath(tenantSlug, link), 302);
        }
    } catch (e) {
        logger.warn('sign-redirect: lookup failed', { inspectionId: id.slice(0, 8), error: (e as Error).message });
    }
    return c.redirect(portal, 302);
});
