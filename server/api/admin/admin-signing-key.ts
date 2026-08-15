// Admin → tenant e-signature signing key.
//
// Split out of admin-esign.ts rather than added to it: that file is about
// envelopes — listing them, reading their audit trail, nudging a signer — and
// this is about the key underneath all of them. It is also the only route in
// the admin surface that changes a cryptographic identity, which is worth
// having somewhere a reader can find without scrolling past six envelope
// endpoints. Mounted at `/` by the admin aggregator.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

// Owner-only, unlike the envelope routes next door: this changes what the
// company's future signatures are made with. Nothing already signed is
// affected — the retired key stays on file and both verifiers resolve each row
// by the fingerprint it recorded — which is precisely why this endpoint can
// exist at all. Before `signing_keys` became a history, rotating would have
// left every earlier agreement and report version unverifiable.
const rotateSigningKeyRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements/signing-key/rotate',
    tags: ['admin', 'agreements'],
    summary: 'Rotate the tenant e-signature signing key',
    middleware: [requireRole('owner')],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.object({
                    fingerprint: z.string().describe('SHA-256 of the new active public key'),
                    retired: z.string().nullable().describe('Fingerprint of the key just retired, or null if the tenant had none'),
                }),
            }) } },
            description: 'Rotated',
        },
    },
    operationId: 'rotateTenantSigningKey',
    description: "Retire the tenant's current Ed25519 e-signature key and mint a replacement. Previously signed agreements and report versions keep verifying: the retired public key is kept forever and every audit row is checked against the key its own fingerprint names. Nothing is re-signed and no existing evidence is modified.",
}, { scopes: ['admin'], tier: 'extended' }));

const adminSigningKeyRoutes = createApiRouter()
    .openapi(rotateSigningKeyRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const result = await c.var.services.signingKey.rotateKeypair(tenantId);
        // Both fingerprints in the audit record: which key stopped signing and
        // which took over. Without the retired one, a later reader cannot tell
        // which of a tenant's keys covers which stretch of its evidence.
        auditFromContext(c, 'signing_key.rotate', 'signing_key', {
            metadata: { fingerprint: result.fingerprint, retired: result.retired },
        });
        return c.json({ success: true as const, data: result }, 200);
    });

export default adminSigningKeyRoutes;
