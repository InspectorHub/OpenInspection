import { Hono } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { checkRateLimit } from '../../lib/rate-limit';
import { loadVerifyKeys } from '../../lib/verify-data';
import { agreementRenderPath } from '../../lib/public-urls';

/**
 * The public verifier's two plain links, beside the typed verification route in ./verify.ts: the signing key(s) as a PEM file, and a
 * redirect to the signed document. Neither is consumed through the typed client. They read only what they hand out (see
 * `loadVerifyKeys`), not the whole chain, and they are counted per network like the verification route.
 */
export const verifyLinkRoutes = new Hono<HonoConfig>()
    .get('/verify/:envelopeId/public-key', async (c) => {
        await checkRateLimit(c, 'verify-public');
        const envelopeId = c.req.param('envelopeId');
        const data = await loadVerifyKeys(c, envelopeId);
        if (!data || !data.pubKey) return c.text('Not found', 404);
        c.header('Content-Type', 'application/x-pem-file');
        c.header('Content-Disposition', `attachment; filename="pubkey-${envelopeId.slice(0, 8)}.pem"`);
        return c.body(data.pubKeyPem);
    })
    // Spec 5H D-patch — view the signed document. Redirects to the renderer, which is keyed by the envelope's requestId.
    .get('/verify/:envelopeId/document', async (c) => {
        await checkRateLimit(c, 'verify-public');
        const data = await loadVerifyKeys(c, c.req.param('envelopeId'));
        if (!data) return c.text('Not found', 404);
        return c.redirect(agreementRenderPath(data.tenantSlug, data.reqRow.id), 302);
    });
