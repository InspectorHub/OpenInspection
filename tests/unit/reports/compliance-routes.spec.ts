/**
 * Commercial PCA Phase M Task 6 — HTTP route tests for the compliance API:
 * GET /compliance, POST/DELETE signoff, doc-review seed/patch, PUT psq,
 * POST psq/status (+ its Deviations auto-disclosure on decline), and the
 * report_tier=full_pca write guard (409 TIER_NOT_FULL_PCA).
 *
 * Harness mirrors report-review-endpoints.spec.ts: mounts the real
 * inspectionsRoutes router with a real InspectionService + ComplianceService,
 * both backed by an in-memory better-sqlite3 DB via the `drizzle-orm/d1`
 * mock (same pattern pca-compliance-service.spec.ts uses for
 * ComplianceService alone).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { UserRole } from '../../../server/types/auth';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import AFTER mock is hoisted.
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';
import { InspectionService } from '../../../server/services/inspection.service';
import { ComplianceService } from '../../../server/services/compliance/pca-compliance.service';

const SECRET = 'test-encryption-secret-32-bytes-long!!';
const TENANT  = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000099';
const INSP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
// auditFromContext reads c.executionCtx, which Hono's Context throws on
// accessing when app.request() is called without a 4th executionCtx arg
// (unlike the real CF Workers runtime). Stub it so the write routes' fire-
// and-forget audit call doesn't 500 the request.
const FAKE_EXEC_CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function buildApp(db: BetterSQLite3Database<typeof schema>, role: UserRole) {
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const inspectionSvc = new InspectionService({} as D1Database);
    const complianceSvc = new ComplianceService({} as D1Database, SECRET);

    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: USER_ID, role, tenantId: TENANT });
        c.set('services', {
            inspection: inspectionSvc,
            compliance: complianceSvc,
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

async function seedInspection(
    db: BetterSQLite3Database<typeof schema>,
    overrides: Partial<typeof schema.inspections.$inferInsert> = {},
) {
    await db.insert(schema.inspections).values({
        id:              INSP_ID,
        tenantId:        TENANT,
        propertyAddress: '1 Main St',
        clientName:      'Test Client',
        clientEmail:     'client@example.com',
        date:            '2026-06-01',
        status:          'completed',
        paymentStatus:   'unpaid',
        price:           0,
        paymentRequired: false,
        agreementRequired: false,
        createdAt:       new Date(),
        propertyType:    'commercial',
        reportTier:      'full_pca',
        ...overrides,
    });
}

async function readDeviations(db: BetterSQLite3Database<typeof schema>) {
    const row = await db.select({ deviations: schema.inspections.deviations })
        .from(schema.inspections)
        .where(and(eq(schema.inspections.id, INSP_ID), eq(schema.inspections.tenantId, TENANT)))
        .get();
    return row?.deviations ?? [];
}

describe('Commercial PCA compliance routes', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'user@example.com',
            passwordHash: 'hash', createdAt: new Date(),
        });
    });

    it('GET /compliance on a fresh full_pca inspection → empty artifacts, conforms=false', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { reportSignoffs: unknown[]; psq: unknown; documentReview: unknown[]; conformance: { conforms: boolean; standard: string } } };
        expect(body.data.reportSignoffs).toEqual([]);
        expect(body.data.psq).toBeNull();
        expect(body.data.documentReview).toEqual([]);
        expect(body.data.conformance).toEqual({ standard: 'E2018-24', conforms: false });
    });

    it('agent GET /compliance → 403 (not in owner/manager/inspector gate)', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'agent');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(403);
    });

    it('POST /compliance/signoff records an attestation; GET reflects it', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance/signoff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'pcr_reviewer', personId: 'u1', name: 'Jane', license: 'PE-1', dualRole: false }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { role: string; signatureRef: string; signedAt: number } };
        expect(body.data.role).toBe('pcr_reviewer');
        expect(typeof body.data.signedAt).toBe('number');
        expect(body.data.signatureRef.length).toBeGreaterThan(0);

        const getRes = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        const getBody = await getRes.json() as { data: { reportSignoffs: Array<{ role: string; signedAt: number }> } };
        expect(getBody.data.reportSignoffs).toHaveLength(1);
        expect(getBody.data.reportSignoffs[0].role).toBe('pcr_reviewer');
        expect(typeof getBody.data.reportSignoffs[0].signedAt).toBe('number');
    });

    it('POST /compliance/signoff on a light_commercial inspection → 409 TIER_NOT_FULL_PCA', async () => {
        await seedInspection(db, { reportTier: 'light_commercial' });
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance/signoff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'pcr_reviewer', personId: 'u1', name: 'Jane' }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('TIER_NOT_FULL_PCA');
    });

    it('DELETE /compliance/signoff/:role removes the attestation', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'owner');
        await app.request(`/api/inspections/${INSP_ID}/compliance/signoff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'field_observer', personId: 'u1', name: 'Jane' }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        const delRes = await app.request(`/api/inspections/${INSP_ID}/compliance/signoff/field_observer`, { method: 'DELETE' }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(delRes.status).toBe(200);
        const getRes = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        const getBody = await getRes.json() as { data: { reportSignoffs: unknown[] } };
        expect(getBody.data.reportSignoffs).toEqual([]);
    });

    it('DELETE /compliance/signoff/:role on light_commercial → 409 TIER_NOT_FULL_PCA', async () => {
        await seedInspection(db, { reportTier: 'light_commercial' });
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance/signoff/field_observer`, { method: 'DELETE' }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
    });

    it('POST doc-review/seed then PATCH a single item', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'owner');
        const seedRes = await app.request(`/api/inspections/${INSP_ID}/compliance/doc-review/seed`, { method: 'POST' }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(seedRes.status).toBe(200);

        const getRes = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        const getBody = await getRes.json() as { data: { documentReview: Array<{ documentKey: string }> } };
        expect(getBody.data.documentReview.length).toBeGreaterThan(0);
        const key = getBody.data.documentReview[0].documentKey;

        const patchRes = await app.request(`/api/inspections/${INSP_ID}/compliance/doc-review/${key}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requested: true, received: true, reviewed: true }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(patchRes.status).toBe(200);

        const afterRes = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        const afterBody = await afterRes.json() as { data: { documentReview: Array<{ documentKey: string; requested: boolean; received: boolean; reviewed: boolean }> } };
        const item = afterBody.data.documentReview.find((d) => d.documentKey === key);
        expect(item?.requested).toBe(true);
        expect(item?.received).toBe(true);
        expect(item?.reviewed).toBe(true);
    });

    it('PUT /compliance/psq stores responses and transitions status to received', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance/psq`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ responses: { occupancy: 'owner' } }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const getRes = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        const getBody = await getRes.json() as { data: { psq: { status: string; responses: Record<string, unknown> } | null } };
        expect(getBody.data.psq?.status).toBe('received');
        expect(getBody.data.psq?.responses).toEqual({ occupancy: 'owner' });
    });

    it('PUT /compliance/psq on light_commercial → 409 TIER_NOT_FULL_PCA', async () => {
        await seedInspection(db, { reportTier: 'light_commercial' });
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance/psq`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ responses: {} }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
    });

    it('POST psq/status declined appends a PSQ Deviations disclosure (idempotent)', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance/psq/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'declined', reason: 'Owner unreachable' }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        let deviations = await readDeviations(db);
        expect(deviations).toHaveLength(1);
        expect(deviations[0]).toMatchObject({
            area: 'PSQ',
            baselineRequirement: 'ASTM §8.5 Pre-Survey Questionnaire included as exhibit',
            deviation: 'PSQ not obtained from point-of-contact',
            reason: 'Owner unreachable',
        });

        // Re-declining must not duplicate the disclosure (appendDeviation is idempotent).
        await app.request(`/api/inspections/${INSP_ID}/compliance/psq/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'declined', reason: 'Owner unreachable' }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        deviations = await readDeviations(db);
        expect(deviations).toHaveLength(1);
    });

    it('POST psq/status on light_commercial → 409 TIER_NOT_FULL_PCA', async () => {
        await seedInspection(db, { reportTier: 'light_commercial' });
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/compliance/psq/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'sent' }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
    });

    it('conforms flips true once reviewer sign-off + PSQ decline-disclosure are both present', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'owner');

        await app.request(`/api/inspections/${INSP_ID}/compliance/signoff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'pcr_reviewer', personId: 'u1', name: 'Jane' }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        await app.request(`/api/inspections/${INSP_ID}/compliance/psq/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'declined', reason: 'Owner unreachable' }),
        }, FAKE_ENV, FAKE_EXEC_CTX);

        const getRes = await app.request(`/api/inspections/${INSP_ID}/compliance`, {}, FAKE_ENV, FAKE_EXEC_CTX);
        const getBody = await getRes.json() as { data: { conformance: { conforms: boolean } } };
        expect(getBody.data.conformance.conforms).toBe(true);
    });
});
