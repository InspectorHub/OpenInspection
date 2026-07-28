/**
 * A contact id is an opaque TEXT value, and every contacts endpoint has to
 * agree about that.
 *
 * This resource used to validate `.min(1)` on GET /{id} but `.uuid()` on
 * update/delete/access, so the same id could be readable and un-revokable. It
 * surfaced the worst possible way: `GET /{id}/access` 400'd, the contact-detail
 * loader caught the failure into an empty array, and the page stated "This
 * contact cannot open any reports" — a false negative on an access-control
 * panel, produced by a validation error.
 *
 * Every contacts spec until now was service-level, and the service takes any
 * string. That is precisely why the mismatch survived: nothing exercised the
 * HTTP edge, which is where the rejection happened. These do.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import contactRoutes from '../../../server/api/contacts';
import type { HonoConfig } from '../../../server/types/hono';

// Deliberately NOT a UUID. `contacts.id` is `text('id')`; the column promises
// nothing about the format, so neither may the route.
const OPAQUE_ID = 'fx-contact-agent';

function contactsApp(services: Record<string, unknown>) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('user', { sub: 'u1' } as never);
        c.set('tenantId', 't1');
        c.set('services', services as never);
        await next();
    });
    app.route('/api/contacts', contactRoutes);
    return app;
}

describe('contact id param accepts any opaque id', () => {
    it('GET /{id}/access does not reject a non-UUID id', async () => {
        const listAccess = vi.fn().mockResolvedValue([
            { inspectionId: 'i1', propertyAddress: '1 Main', role: 'buyer_agent', createdAt: 1 },
        ]);
        const res = await contactsApp({ contact: { listAccess } }).request(
            `/api/contacts/${OPAQUE_ID}/access`,
        );

        expect(res.status).toBe(200);
        expect(listAccess).toHaveBeenCalledWith(OPAQUE_ID, 't1');
    });

    it('POST /{id}/access/revoke does not reject a non-UUID id', async () => {
        // The half that matters most: a link you can see but cannot revoke is
        // worse than one you cannot see, because the page offers the button.
        const revokeAccess = vi.fn().mockResolvedValue(2);
        const res = await contactsApp({ contact: { revokeAccess } }).request(
            `/api/contacts/${OPAQUE_ID}/access/revoke`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            },
        );

        expect(res.status).toBe(200);
        expect(revokeAccess).toHaveBeenCalledWith(OPAQUE_ID, 't1');
    });

    it('GET /{id} and GET /{id}/access agree — one id contract, not two', async () => {
        // The regression was not "uuid is wrong" so much as "two rules for one
        // id". Assert they answer the same way for the same input.
        const services = {
            contact: {
                getContactDetail: vi.fn().mockResolvedValue({ contact: { id: OPAQUE_ID }, inspections: [], stats: {} }),
                listAccess: vi.fn().mockResolvedValue([]),
            },
        };
        const app = contactsApp(services);

        const detail = await app.request(`/api/contacts/${OPAQUE_ID}`);
        const access = await app.request(`/api/contacts/${OPAQUE_ID}/access`);

        expect(detail.status).not.toBe(400);
        expect(access.status).not.toBe(400);
    });

    it('still rejects a blank id', async () => {
        // Opaque is not the same as unvalidated: a whitespace-only id is not an
        // id, and `.min(1)` alone would let it through (a space is length 1).
        const res = await contactsApp({ contact: { listAccess: vi.fn() } }).request(
            '/api/contacts/%20/access',
        );
        expect(res.status).not.toBe(200);
    });
});
