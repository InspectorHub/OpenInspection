/**
 * Share view routes (Task 5) for repair-builder (split from
 * repair-builder-routes.spec.ts).
 *
 * These routes are PUBLIC — the shareToken is the credential.
 * All three (GET /share/:token, GET /share/:token/pdf, POST /share/:token/email)
 * run a publish gate: getByShareToken → inspect reportStatus → 403 if not published.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../server/lib/public-access')>();
    return {
        ...actual,
        resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null),
        resolveAgentSession: vi.fn().mockResolvedValue(null),
    };
});

// eslint-disable-next-line import/order
import { buildShareApp, SHARE_INSP_UNPUBLISHED } from './helpers/repair-builder-routes-harness';

describe('GET /api/public/repair-request/share/:shareToken', () => {
    it('200 with propertyAddress + customIntro + items + creditTotal for published report', async () => {
        const { app, svc } = buildShareApp({});

        const res = await app.request('/api/public/repair-request/share/share-tok-abc');
        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: {
                propertyAddress: string;
                customIntro: string | null;
                items: unknown[];
                creditTotal: number;
            };
        };
        expect(body.success).toBe(true);
        expect(body.data.propertyAddress).toBe('123 Main St');
        expect(body.data.customIntro).toBe('Please review');
        expect(body.data.items).toHaveLength(1);
        expect(body.data.creditTotal).toBe(5000);

        expect(svc.repairRequest.getByShareToken).toHaveBeenCalledWith('share-tok-abc');
        // Share route uses the RR's own inspectionId; creditTotal now takes (tenant, inspId, rrId).
        expect(svc.repairRequest.creditTotal).toHaveBeenCalledWith('t1', 'insp1', 'rr1');
    });

    it('404 when shareToken is unknown', async () => {
        const { app } = buildShareApp({ rrResult: null });

        const res = await app.request('/api/public/repair-request/share/no-such-token');
        expect(res.status).toBe(404);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_FOUND');
    });

    it('403 NOT_PUBLISHED when report is in_progress — does NOT leak items', async () => {
        const { app } = buildShareApp({ inspResult: SHARE_INSP_UNPUBLISHED });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_PUBLISHED');
        // Must not contain items
        expect(JSON.stringify(body)).not.toContain('item1');
    });

    it('403 NOT_PUBLISHED when inspection row missing (safety)', async () => {
        const { app } = buildShareApp({ inspResult: null });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });
});

describe('GET /api/public/repair-request/share/:shareToken/pdf', () => {
    it('403 NOT_PUBLISHED when report is unpublished', async () => {
        const { app } = buildShareApp({ inspResult: SHARE_INSP_UNPUBLISHED });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/pdf');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('404 when shareToken is unknown', async () => {
        const { app } = buildShareApp({ rrResult: null });

        const res = await app.request('/api/public/repair-request/share/no-token/pdf');
        expect(res.status).toBe(404);
    });

    it('200 with PDF bytes when BROWSER stub returns ok response', async () => {
        const fakeBuffer = new ArrayBuffer(4);
        const browserStub = {
            quickAction: vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: async () => fakeBuffer,
            }),
        };

        const { app } = buildShareApp({ browserBinding: browserStub });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/pdf');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/pdf');
        expect(res.headers.get('Content-Disposition')).toContain('repair-request.pdf');
        // Confirm the page URL passed to quickAction
        expect(browserStub.quickAction).toHaveBeenCalledWith('pdf', expect.objectContaining({
            url: expect.stringContaining('/repair-request/share-tok-abc'),
        }));
    });
});

describe('POST /api/public/repair-request/share/:shareToken/email', () => {
    it('403 NOT_PUBLISHED when report is unpublished', async () => {
        const { app } = buildShareApp({ inspResult: SHARE_INSP_UNPUBLISHED });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com' }),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('404 when shareToken is unknown', async () => {
        const { app } = buildShareApp({ rrResult: null });

        const res = await app.request('/api/public/repair-request/share/no-token/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com' }),
        });
        expect(res.status).toBe(404);
    });

    it('400 when "to" is missing or not a valid email', async () => {
        const { app } = buildShareApp({});

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'not-an-email' }),
        });
        expect(res.status).toBe(400);
    });

    it('200 on published report with valid email — calls sendEmail', async () => {
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        const { app, svc } = buildShareApp({ sendEmail });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com', message: 'Please review.' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);

        expect(svc.email.sendEmail).toHaveBeenCalledWith(
            ['contractor@example.com'],
            expect.stringContaining('123 Main St'),
            expect.any(String),
        );
    });

    it('200 on published report with no optional message', async () => {
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        const { app } = buildShareApp({ sendEmail });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com' }),
        });
        expect(res.status).toBe(200);
    });
});
