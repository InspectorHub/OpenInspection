import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../../server/api/agent';
import type { HonoConfig } from '../../../server/types/hono';

import { createTestDb } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';

/**
 * Defect photos on the agent repair-items page need an agent-authenticated way
 * to read an R2 object: the staff photo route is owner/manager/inspector-only
 * and the public one wants a portal token, so an agent session satisfies
 * neither. This route is that path — and it must be no wider than the agent's
 * existing referral access:
 *
 *   1. no association with the inspection  -> 404 (never the bytes)
 *   2. a key outside `${tenantId}/inspections/${id}/` -> 404, even when the
 *      agent legitimately has access to THAT inspection (no key smuggling)
 *   3. associated + in-scope key           -> the object
 */
describe('GET /api/agent/inspections/:id/photo', () => {
    const KEY = 't1/inspections/i1/photos/p1.jpg';

    // The route reads the inspection's report status from the database; each case sets it on a real in-memory one.
    let reportStatus: string = 'published';
    function app(accessToInspection: unknown, bucketGet = vi.fn(), releaseGate: unknown = null) {
        reportStatus = 'published';
        const a = new OpenAPIHono<HonoConfig>();
        a.use('*', async (c, next) => {
            c.set('userRole', 'agent');
            c.set('user', { sub: 'u1' } as never);
            c.set('services', { agent: { accessToInspection }, inspection: { resolveReleaseGate: vi.fn().mockResolvedValue(releaseGate) } } as never);
            await next();
        });
        a.route('/api/agent', agentRoutes);
        return { app: a, bucketGet };
    }

    const env = (bucketGet: unknown) => {
        const { sqlite, db } = createTestDb();
        db.insert(schema.tenants).values({ id: 't1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date() } as never).run();
        db.insert(schema.inspections).values({
            id: 'i1', tenantId: 't1', propertyAddress: '1 Main', clientName: 'C', clientEmail: 'c@example.test', date: '2026-11-01', status: 'completed',
            reportStatus, createdAt: new Date(),
        } as never).run();
        return { PHOTOS: { get: bucketGet }, DB: toD1Binding(sqlite) } as never;
    };

    function url(key: string, id = 'i1') {
        return `/api/agent/inspections/${id}/photo?key=${encodeURIComponent(key)}`;
    }

    it('404s when the agent has no association with the inspection', async () => {
        const accessToInspection = vi.fn().mockResolvedValue(null);
        const bucketGet = vi.fn();
        const { app: a } = app(accessToInspection, bucketGet);
        const res = await a.request(url(KEY), {}, env(bucketGet));
        expect(res.status).toBe(404);
        // The bucket is never touched for an unauthorized caller.
        expect(bucketGet).not.toHaveBeenCalled();
    });

    it('404s a key belonging to another tenant or another inspection', async () => {
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't1', repairAccess: 'read' });
        const bucketGet = vi.fn();
        const { app: a } = app(accessToInspection, bucketGet);

        const otherTenant = await a.request(url('t2/inspections/i1/photos/p1.jpg'), {}, env(bucketGet));
        expect(otherTenant.status).toBe(404);

        const otherInspection = await a.request(url('t1/inspections/i9/photos/p1.jpg'), {}, env(bucketGet));
        expect(otherInspection.status).toBe(404);

        expect(bucketGet).not.toHaveBeenCalled();
    });

    it('streams the object for an associated agent and an in-scope key', async () => {
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't1', repairAccess: 'read' });
        const bucketGet = vi.fn().mockResolvedValue({
            body: new ReadableStream(),
            httpMetadata: { contentType: 'image/jpeg' },
            customMetadata: { originalName: 'roof.jpg' },
            httpEtag: '"abc"',
        });
        const { app: a } = app(accessToInspection, bucketGet);

        const res = await a.request(url(KEY), {}, env(bucketGet));
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/jpeg');
        expect(bucketGet).toHaveBeenCalledWith(KEY);
        expect(accessToInspection).toHaveBeenCalledWith('u1', 'i1');
    });

    it('404s when the object is missing from the bucket', async () => {
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't1', repairAccess: 'read' });
        const bucketGet = vi.fn().mockResolvedValue(null);
        const { app: a } = app(accessToInspection, bucketGet);
        const res = await a.request(url(KEY), {}, env(bucketGet));
        expect(res.status).toBe(404);
    });

    describe('applies the gates the report applies to a recipient', () => {
        const bucketBody = () => vi.fn().mockResolvedValue({ body: new ReadableStream(), httpMetadata: { contentType: 'image/jpeg' }, customMetadata: {}, httpEtag: '"a"' });

        it('serves a published, released report to an agent whose policy allows the list (control)', async () => {
            const bucketGet = bucketBody();
            const { app: a } = app(vi.fn().mockResolvedValue({ tenantId: 't1', repairAccess: 'read' }), bucketGet);
            expect((await a.request(url(KEY), {}, env(bucketGet))).status).toBe(200);
        });

        it('404s a report that is not published, without touching the bucket', async () => {
            const bucketGet = bucketBody();
            const { app: a } = app(vi.fn().mockResolvedValue({ tenantId: 't1', repairAccess: 'read' }), bucketGet);
            for (const status of ['in_progress', 'submitted']) {
                reportStatus = status;
                expect((await a.request(url(KEY), {}, env(bucketGet))).status, String(status)).toBe(404);
            }
            expect(bucketGet).not.toHaveBeenCalled();
        });

        it('404s a report held by an outstanding payment or agreement', async () => {
            for (const gate of [{ reason: 'payment' }, { reason: 'agreement' }]) {
                const bucketGet = bucketBody();
                const { app: a } = app(vi.fn().mockResolvedValue({ tenantId: 't1', repairAccess: 'readwrite' }), bucketGet, gate);
                expect((await a.request(url(KEY), {}, env(bucketGet))).status, gate.reason).toBe(404);
                expect(bucketGet).not.toHaveBeenCalled();
            }
        });

        it('404s when the company (or the agent role) turned the repair list off for agents', async () => {
            const bucketGet = bucketBody();
            const { app: a } = app(vi.fn().mockResolvedValue({ tenantId: 't1', repairAccess: 'off' }), bucketGet);
            expect((await a.request(url(KEY), {}, env(bucketGet))).status).toBe(404);
            expect(bucketGet).not.toHaveBeenCalled();
        });
    });
});
