/**
 * IA-34 follow-up — GET /api/inspections/:id/hub must hand the inspector a
 * TOKENIZED pay link.
 *
 * IA-34 closed the public pay surface: `/api/public/inspections/:id/invoice`
 * and `.../pay-intent` now require a live client/co_client grant. That turned
 * the hub's "copy pay link" action into a dead link, because it built a bare
 * `/invoice/:id` on the client from the inspection id alone — the one producer
 * of a credential-less pay URL left in the app after the send path was fixed.
 *
 * The link the inspector copies and the link the send path emails must be the
 * SAME URL, so these assert the route mints the primary client's persistent
 * portal token and returns it on `invoice.payUrl` — and returns null (rather
 * than a link that will 401) whenever no token can be bound.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const SLUG = 'acme';

let issueToken: ReturnType<typeof vi.fn>;
let getPrimaryClient: ReturnType<typeof vi.fn>;

/** Minimal hub payload — only the invoice block matters here. */
function hubPayload(invoice: { id: string; status: string } | null) {
    return {
        inspection: { id: INSP_ID, propertyAddress: '1 Main St' },
        people: [],
        services: [],
        agreements: [],
        agreementRequests: [],
        invoice: invoice
            ? { id: invoice.id, status: invoice.status, amountCents: 50000, sentAt: null, paidAt: null }
            : null,
        publishReadiness: { ready: true, blockingCount: 0 },
    };
}

function buildApp(invoice: { id: string; status: string } | null, primaryClient: { email: string | null } | null) {
    const app = new OpenAPIHono<HonoConfig>();
    issueToken = vi.fn().mockResolvedValue('portal-token-xyz');
    getPrimaryClient = vi.fn().mockResolvedValue(primaryClient);

    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            inspection: { getInspectionHub: vi.fn().mockResolvedValue(hubPayload(invoice)) },
            people: { getPrimaryClient },
            portalAccess: { issueToken },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com', JWT_SECRET: 'test-secret' } as never;

async function get(app: OpenAPIHono<HonoConfig>) {
    const res = await app.request(`/api/inspections/${INSP_ID}/hub`, { method: 'GET' }, ENV);
    return { status: res.status, body: await res.json() as { data?: { invoice?: { payUrl?: string | null } | null } } };
}

describe('GET /api/inspections/:id/hub — tokenized pay link (IA-34 follow-up)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns a tokenized payUrl for a SENT invoice with a primary client email', async () => {
        const { status, body } = await get(buildApp({ id: 'inv-1', status: 'sent' }, { email: 'jane@example.com' }));

        expect(status).toBe(200);
        // The credential must be ON the URL — a bare /invoice/:id is refused now.
        expect(body.data?.invoice?.payUrl).toBe(
            'https://acme.example.com/invoice/550e8400-e29b-41d4-a716-446655440000?token=portal-token-xyz',
        );
        // Bound to the PRIMARY CLIENT, in this tenant, for this inspection.
        expect(issueToken).toHaveBeenCalledWith({
            tenantId: TENANT, inspectionId: INSP_ID, recipientEmail: 'jane@example.com',
        });
    });

    it('covers a PARTIAL invoice too — a part-paid link must keep working', async () => {
        const { body } = await get(buildApp({ id: 'inv-1', status: 'partial' }, { email: 'jane@example.com' }));
        expect(body.data?.invoice?.payUrl).toContain('?token=portal-token-xyz');
    });

    it('returns null payUrl and mints nothing for a DRAFT invoice', async () => {
        const { body } = await get(buildApp({ id: 'inv-1', status: 'draft' }, { email: 'jane@example.com' }));

        expect(body.data?.invoice?.payUrl).toBeNull();
        // A draft has no bound recipient yet — minting here would issue a live
        // credential for a link nobody has been given.
        expect(issueToken).not.toHaveBeenCalled();
    });

    it('returns null payUrl rather than a dead link when the primary client has no email', async () => {
        const { body } = await get(buildApp({ id: 'inv-1', status: 'sent' }, { email: null }));

        expect(body.data?.invoice?.payUrl).toBeNull();
        expect(issueToken).not.toHaveBeenCalled();
    });

    it('returns null payUrl when the inspection has no primary client at all', async () => {
        const { body } = await get(buildApp({ id: 'inv-1', status: 'sent' }, null));

        expect(body.data?.invoice?.payUrl).toBeNull();
        expect(issueToken).not.toHaveBeenCalled();
    });

    it('leaves invoice null (and mints nothing) when there is no invoice', async () => {
        const { body } = await get(buildApp(null, { email: 'jane@example.com' }));

        expect(body.data?.invoice).toBeNull();
        expect(issueToken).not.toHaveBeenCalled();
    });
});
