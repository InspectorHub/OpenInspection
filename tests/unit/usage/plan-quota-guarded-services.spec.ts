/**
 * Fix wave (2026-07) — Finding 2 of the Task 3 code review: booking,
 * concierge, and inspection-request creation paths bypassed PlanQuotaGuard
 * entirely. Covers the three newly-guarded services:
 *   - ConciergeService.createBooking
 *   - InspectionRequestService.create (batch, once-per-sub-inspection) and
 *     addSubInspection (single append)
 *   - BookingService.fulfillBooking (public self-serve booking, legacy
 *     single-service branch — the multi-service branch delegates to
 *     InspectionRequestService.create, covered above)
 *
 * Each suite proves: (a) the 6th create for a free tenant is blocked with
 * 402/QUOTA_EXHAUSTED, and (b) a validation failure never consumes quota.
 * The booking suite additionally proves no orphaned inspection_requests row
 * is left behind when quota blocks the flow.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';
import { BookingService } from '../../../server/services/booking.service';
import { ConciergeService } from '../../../server/services/concierge.service';
import { InspectionRequestService } from '../../../server/services/inspection-request.service';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { MeteringService } from '../../../server/services/metering.service';
import type { EmailService } from '../../../server/services/email.service';

// ---------------------------------------------------------------------------
// ConciergeService.createBooking
// ---------------------------------------------------------------------------
describe('ConciergeService.createBooking consumes the free-tier quota', () => {
    const T1        = '00000000-0000-0000-0000-0000000000c1';
    const AGENT     = '00000000-0000-0000-0000-0000000000c2';
    const INSPECTOR = '00000000-0000-0000-0000-0000000000c3';
    const CONTACT_INSP  = '00000000-0000-0000-0000-0000000000c4';
    const CONTACT_AGENT = '00000000-0000-0000-0000-0000000000c5';

    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let testD1: D1Database;
    let stubEmail: { sendConciergeClientConfirm: ReturnType<typeof vi.fn>; sendConciergeInspectorReview: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        testD1 = toRawD1(sqlite);

        stubEmail = {
            sendConciergeClientConfirm: vi.fn().mockResolvedValue(undefined),
            sendConciergeInspectorReview: vi.fn().mockResolvedValue(undefined),
        };

        await testDb.insert(schema.tenants).values({
            id: T1, name: 'Acme', slug: 'acme-concierge', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: T1, conciergeReviewRequired: false, updatedAt: new Date(),
        });
        await testDb.insert(schema.users).values([
            { id: INSPECTOR, tenantId: T1, email: 'mike@acme.com', name: 'Mike Reynolds',
              role: 'inspector', passwordHash: 'x', createdAt: new Date() },
            { id: AGENT, tenantId: null, email: 'jane@realty.com', name: 'Jane Smith',
              role: 'agent', passwordHash: 'x', createdAt: new Date() },
        ]);
        await testDb.insert(schema.contacts).values([
            { id: CONTACT_INSP, tenantId: T1, type: 'client', name: 'Mike Reynolds',
              email: 'mike@acme.com', createdAt: new Date() },
            { id: CONTACT_AGENT, tenantId: T1, type: 'agent', name: 'Jane Smith',
              email: 'jane@realty.com', createdAt: new Date() },
        ]);
        await testDb.insert(schema.agentTenantLinks).values({
            id: crypto.randomUUID(), agentUserId: AGENT, tenantId: T1,
            inspectorContactId: CONTACT_AGENT, status: 'active',
            invitedByUserId: INSPECTOR, createdAt: new Date(),
        });
    });

    afterEach(() => sqlite.close());

    const baseParams = () => ({
        tenantId: T1, agentUserId: AGENT, inspectorContactId: CONTACT_INSP,
        date: '2026-06-15', timeSlot: '10:00', propertyAddress: '1 Main St',
        clientName: 'Sarah Buyer', clientEmail: 'sarah@example.com',
        agreementRequired: true, paymentRequired: false,
    });

    it('blocks the 6th create for a free tenant with 402/QUOTA_EXHAUSTED', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = new ConciergeService(testD1, stubEmail as unknown as EmailService, 'https://acme.example.com', guard);

        for (let i = 0; i < 5; i++) await svc.createBooking(baseParams());
        await expect(svc.createBooking(baseParams())).rejects.toMatchObject({
            status: 402, code: 'QUOTA_EXHAUSTED',
        });
        expect(await new MeteringService(testD1).lifetimeTotal(T1, 'inspections')).toBe(5);
    });

    it('a rejected validation (unknown inspector contact) does not consume quota', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = new ConciergeService(testD1, stubEmail as unknown as EmailService, 'https://acme.example.com', guard);

        await expect(svc.createBooking({ ...baseParams(), inspectorContactId: 'no-such-contact' }))
            .rejects.toThrow(/not found/i);
        expect(await new MeteringService(testD1).lifetimeTotal(T1, 'inspections')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// InspectionRequestService.create + addSubInspection
// ---------------------------------------------------------------------------
describe('InspectionRequestService consumes the free-tier quota', () => {
    const TENANT = '00000000-0000-0000-0000-00000000d001';
    const TPL1   = '00000000-0000-0000-0000-00000000d002';

    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let testD1: D1Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        testD1 = toRawD1(sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-req', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.templates).values({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            id: TPL1, tenantId: TENANT, name: 'Residential', version: 1, schema: { sections: [] } as any,
            createdAt: new Date(),
        });
    });

    afterEach(() => sqlite.close());

    it('blocks the 6th single-sub request for a free tenant with 402/QUOTA_EXHAUSTED', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = new InspectionRequestService(testD1, guard);

        for (let i = 0; i < 5; i++) {
            await svc.create(TENANT, {
                clientName: 'X', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
            }, [{ templateId: TPL1 }]);
        }
        await expect(svc.create(TENANT, {
            clientName: 'X', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }])).rejects.toMatchObject({ status: 402, code: 'QUOTA_EXHAUSTED' });

        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(5);
        const reqRows = await testDb.select().from(schema.inspectionRequests).all();
        expect(reqRows).toHaveLength(5); // the 6th, blocked, request row was never inserted
    });

    it('a multi-sub batch that would exceed the cap leaves no orphaned request row', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = new InspectionRequestService(testD1, guard);

        // Consume 3 of the 5 lifetime slots first.
        await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }, { templateId: TPL1 }, { templateId: TPL1 }]);

        // A 3-sub batch would need slots 4, 5, 6 — the 3rd consume (slot 6) must
        // reject, and the whole batch (including the parent request row) must
        // not be persisted.
        await expect(svc.create(TENANT, {
            clientName: 'B', propertyAddress: '2 St', scheduledAt: '2026-06-16T09:00:00Z',
        }, [{ templateId: TPL1 }, { templateId: TPL1 }, { templateId: TPL1 }]))
            .rejects.toMatchObject({ status: 402, code: 'QUOTA_EXHAUSTED' });

        const reqRows = await testDb.select().from(schema.inspectionRequests).all();
        expect(reqRows).toHaveLength(1); // only the first (successful) request exists
        const inspRows = await testDb.select().from(schema.inspections).all();
        expect(inspRows).toHaveLength(3); // only the first batch's 3 children exist
        // The cap (5) was reached mid-loop — 2 of the 3 attempted consumes for
        // the rejected batch succeeded before the 3rd hit the cap. The counter
        // is monotonic (no refund), matching PlanQuotaGuard's documented
        // semantics elsewhere (deletes/aborted batches never refund).
        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(5);
    });

    it('a rejected validation (unknown template) does not consume quota', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = new InspectionRequestService(testD1, guard);

        await expect(svc.create(TENANT, {
            clientName: 'X', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: 'no-such-template' }])).rejects.toThrow(/template not found/i);

        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(0);
    });

    it('addSubInspection blocks the 6th append for a free tenant with 402/QUOTA_EXHAUSTED', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = new InspectionRequestService(testD1, guard);

        const created = await svc.create(TENANT, {
            clientName: 'X', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]); // 1

        for (let i = 0; i < 4; i++) {
            await svc.addSubInspection(TENANT, created.id, { templateId: TPL1 }); // 2..5
        }
        await expect(svc.addSubInspection(TENANT, created.id, { templateId: TPL1 }))
            .rejects.toMatchObject({ status: 402, code: 'QUOTA_EXHAUSTED' });

        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(5);
        const inspRows = await testDb.select().from(schema.inspections)
            .where(eq(schema.inspections.requestId, created.id)).all();
        expect(inspRows).toHaveLength(5);
    });

    it('addSubInspection: a rejected validation (unknown request) does not consume quota', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = new InspectionRequestService(testD1, guard);

        await expect(svc.addSubInspection(TENANT, 'no-such-request', { templateId: TPL1 }))
            .rejects.toThrow(/not found/i);
        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// BookingService.fulfillBooking (public self-serve booking, single-service /
// legacy branch — mounts the real bookingsRoutes, matching the harness in
// booking-autoassign.spec.ts).
// ---------------------------------------------------------------------------
describe('POST /book consumes the free-tier quota (public self-serve booking)', () => {
    const T1 = 'aaaaaaaa-1000-4000-8000-000000000001';
    const MONDAY = '2026-06-08'; // a Monday — mirrors booking-autoassign.spec.ts

    const FAKE_ENV: HonoConfig['Bindings'] = { DB: {} as D1Database } as unknown as HonoConfig['Bindings'];
    const FAKE_EXEC_CTX: ExecutionContext = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let testD1: D1Database;
    let svc: BookingService;

    function makeServiceStubs(bookingSvc: BookingService) {
        return {
            booking: bookingSvc,
            widget: {
                isOriginAllowed: vi.fn().mockResolvedValue(true),
                recordEvent: vi.fn().mockResolvedValue(undefined),
            },
            email: { sendBookingConfirmation: vi.fn().mockResolvedValue(undefined) },
            notification: { createForAllAdmins: vi.fn().mockResolvedValue(undefined) },
            automation: { trigger: vi.fn().mockResolvedValue(undefined) },
            inspectionRequest: {
                // multi-service path — never exercised by the single-service body below.
                create: vi.fn().mockResolvedValue({ id: 'req-x', inspections: [{ id: 'insp-x' }] }),
            },
        };
    }

    function buildApp(db: BetterSQLite3Database<typeof schema>, bookingSvc: BookingService) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            }
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        const stubs = makeServiceStubs(bookingSvc);
        app.use('*', async (c, next) => {
            c.set('services', stubs as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/', bookingsRoutes);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        return { app, stubs };
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        testD1 = toRawD1(sqlite);

        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        svc = new BookingService(testD1, guard);

        await testDb.insert(schema.tenants).values({
            id: T1, name: 'Acme', slug: 'acme', tier: 'free', status: 'active',
            maxUsers: 10, deploymentMode: 'shared', createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        // 6 qualified inspectors, all with the same Monday 08:00-10:00 window,
        // so the first 5 "morning" (fixed 08:00) bookings each auto-assign a
        // distinct free inspector and the 6th ALSO has a free slot available —
        // isolating the 6th rejection to the quota gate, not a 409 conflict.
        const inspectors = Array.from({ length: 6 }, (_, i) => ({
            id: `bbbbbbbb-1000-4000-8000-00000000000${i + 1}`,
            name: `Inspector ${i + 1}`,
        }));
        await testDb.insert(schema.users).values(inspectors.map(insp => ({
            id: insp.id, tenantId: T1, email: `${insp.id}@acme.com`, passwordHash: 'h',
            role: 'inspector' as const, name: insp.name, createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any);
        await testDb.insert(schema.availability).values(inspectors.map(insp => ({
            id: `avail-${insp.id}`, tenantId: T1, inspectorId: insp.id, dayOfWeek: 1,
            startTime: '08:00', endTime: '10:00', createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any);
    });

    afterEach(() => sqlite.close());

    function morningBody(overrides: Record<string, unknown> = {}) {
        return {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant: 'acme', address: '123 Main St', clientName: 'Test Client',
                clientEmail: 'client@test.com', date: MONDAY, timeSlot: 'morning',
                ...overrides,
            }),
        };
    }

    it('blocks the 6th booking for a free tenant with 402/QUOTA_EXHAUSTED and leaves no orphaned rows', async () => {
        const { app } = buildApp(testDb, svc);

        for (let i = 0; i < 5; i++) {
            const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
            expect(res.status).toBe(200);
        }

        const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(402);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('QUOTA_EXHAUSTED');

        // Graceful failure — the request row inserted BEFORE the inspection row
        // in the legacy single-service branch must never be left orphaned:
        // both tables stay at exactly 5 rows (the 6th, blocked, attempt wrote
        // nothing at all, since quota is consumed before either insert).
        expect(await new MeteringService(testD1).lifetimeTotal(T1, 'inspections')).toBe(5);
        const reqRows  = await testDb.select().from(schema.inspectionRequests).all();
        const inspRows = await testDb.select().from(schema.inspections).all();
        expect(reqRows).toHaveLength(5);
        expect(inspRows).toHaveLength(5);
    });

    it('a rejected validation (booking not open — no qualified availability) does not consume quota', async () => {
        // A second, freshly-seeded tenant with zero availability rows: the
        // "booking not open" Conflict fires before quota is ever touched.
        await testDb.insert(schema.tenants).values({
            id: 'tt-empty', name: 'Empty Co', slug: 'emptyco', tier: 'free', status: 'active',
            maxUsers: 10, deploymentMode: 'shared', createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await testDb.insert(schema.users).values({
            id: 'ue1', tenantId: 'tt-empty', email: 'e@empty.com', passwordHash: 'h',
            role: 'inspector', name: 'Emptyman', createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const { app } = buildApp(testDb, svc);
        const res = await app.request('/book', morningBody({ tenant: 'emptyco' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);

        expect(await new MeteringService(testD1).lifetimeTotal('tt-empty', 'inspections')).toBe(0);
    });
});
