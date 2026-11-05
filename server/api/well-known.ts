import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { SigningKeyService } from '../services/signing-key.service';

const wellKnownRoutes = new Hono<HonoConfig>();

/**
 * Public discovery endpoint for a tenant's Ed25519 verification key.
 *
 * Lets a third party (court, opposing counsel) independently confirm that
 * a given public-key.pem from an evidence pack actually belongs to the
 * issuing tenant. Cached publicly for 1 hour.
 */
wellKnownRoutes.get('/openinspection/tenant-keys/:slug', async (c) => {
    const slug = c.req.param('slug');
    const db = drizzle(c.env.DB, { schema });
    const tenant = await db.select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug))
        .get();
    if (!tenant) return c.json({ error: 'tenant not found' }, 404);
    const signing = SigningKeyService.fromEnv(c.env.DB, c.env);
    const pub = await signing.getPublicKey(tenant.id);
    if (!pub) return c.json({ error: 'no signing key for tenant' }, 404);
    return c.json(
        {
            tenantSlug: slug, // projection-allow: the tenant slug the public key is published under
            algorithm: 'Ed25519',
            publicKeyPem: pub.pem, // projection-allow: the tenant public signing key (PEM): public by design, anyone verifies a signature with it
            keyFingerprint: pub.fingerprint, // projection-allow: the fingerprint of that public key
            retrievedAt: new Date().toISOString(),
        },
        200,
        { 'Cache-Control': 'public, max-age=3600' },
    );
});

export default wellKnownRoutes;
