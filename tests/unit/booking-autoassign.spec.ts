/**
 * Task 5 (Track G) — IA-26: POST /api/public/book auto-assign tests.
 *
 * Mounts real bookingsRoutes on OpenAPIHono with onError mapping (mirrors the
 * company-endpoints spec pattern). Uses REAL BookingService (so aggregation
 * logic drives auto-assignment) and real better-sqlite3 DB (via vi.mock of
 * drizzle-orm/d1). Other services the handler touches (widget, email,
 * notification, automation, inspectionRequest) are stubbed to no-ops.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from './db';
import {
    tenants,
    users,
    availability,
    inspections,
    inspectionInspectors,
} from '../../server/lib/db/schema';
import * as schema from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import { AppError } from '../../server/lib/errors';
import { BookingService } from '../../server/services/booking.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Must mock BEFORE importing the routes module.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Rate-limit is a no-op in tests (no KV).
vi.mock('../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../server/api/bookings';

// 2026-06-08 is a Monday (dayOfWeek = 1) — mirrors booking-aggregation.spec.ts.
// Must stay future-dated if a past-date guard ever lands in the booking handler.
const MONDAY = '2026-06-08';

// Stable UUIDs so test assertions are readable.
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';   // tenant t1
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002';   // tenant t2
const U1 = 'bbbbbbbb-0000-4000-8000-000000000001';   // Alice (owner)
const U2 = 'bbbbbbbb-0000-4000-8000-000000000002';   // Bob (inspector)
const U9 = 'bbbbbbbb-0000-4000-8000-000000000009';   // other-tenant user

/** Fake env bindings — no TURNSTILE_SECRET_KEY so bot-check is skipped. */
const FAKE_ENV: HonoConfig['Bindings'] = {
    DB: {} as D1Database,
} as unknown as HonoConfig['Bindings'];

/** Minimal no-op stubs for services the handler touches but we don't care about here. */
function makeServiceStubs(bookingSvc: BookingService) {
    return {
        booking: bookingSvc,
        widget: {
            isOriginAllowed: vi.fn().mockResolvedValue(true),
            recordEvent: vi.fn().mockResolvedValue(undefined),
        },
        email: {
            sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
        },
        notification: {
            createForAllAdmins: vi.fn().mockResolvedValue(undefined),
        },
        automation: {
            trigger: vi.fn().mockResolvedValue(undefined),
        },
        inspectionRequest: {
            // multi-service path; never exercised in single-service tests.
            create: vi.fn().mockResolvedValue({ id: 'req-x', inspections: [{ id: 'insp-x' }] }),
        },
    };
}

/** Mock ExecutionContext — passed as the 4th arg to app.request(). */
const FAKE_EXEC_CTX: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
};

function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    bookingSvc: BookingService,
) {
    const app = new OpenAPIHono<HonoConfig>();

    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json(
                { success: false, error: { code: err.code, message: err.message } },
                err.status,
            );
        }
        return c.json(
            { success: false, error: { code: 'internal_error', message: String(err) } },
            500,
        );
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

// ---------------------------------------------------------------------------
// Shared seed helpers
// ---------------------------------------------------------------------------

async function seedBaseTenant(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(tenants).values({
        id: T1, name: 'Acme', slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    } as any);
    await db.insert(users).values([
        { id: U1, tenantId: T1, email: 'alice@acme.com', passwordHash: 'h', role: 'owner',     name: 'Alice', createdAt: new Date() },
        { id: U2, tenantId: T1, email: 'bob@acme.com',   passwordHash: 'h', role: 'inspector', name: 'Bob',   createdAt: new Date() },
    ] as any);
    // Weekly windows: Monday 08:00-10:00 for both U1 and U2.
    await db.insert(availability).values([
        { id: 'a1', tenantId: T1, inspectorId: U1, dayOfWeek: 1, startTime: '08:00', endTime: '10:00', createdAt: new Date() },
        { id: 'a2', tenantId: T1, inspectorId: U2, dayOfWeek: 1, startTime: '08:00', endTime: '10:00', createdAt: new Date() },
    ] as any);
    // Existing inspection for U2 at 09:00 on MONDAY.
    await db.insert(inspections).values({
        id: 'i-existing', tenantId: T1, inspectorId: U2,
        propertyAddress: '1 Old St', date: `${MONDAY}T09:00:00Z`,
        status: 'scheduled', createdAt: new Date(),
    } as any);
    await db.insert(inspectionInspectors).values({
        inspectionId: 'i-existing', userId: U2, tenantId: T1, role: 'lead', createdAt: new Date(),
    } as any);
}

/** POST body for a single-service morning booking (no inspectorId). */
function morningBody(overrides: Record<string, unknown> = {}) {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tenant:      'acme',
            address:     '123 Main St Anytown',
            clientName:  'Test Client',
            clientEmail: 'client@test.com',
            date:        MONDAY,
            timeSlot:    'morning',
            ...overrides,
        }),
    };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /book — IA-26 auto-assign + fail-closed', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let svc: BookingService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);

        svc = new BookingService({} as D1Database);
        await seedBaseTenant(db);
    });

    afterEach(() => sqlite.close());

    // 1. No inspectorId, free slot → auto-assign Alice (first by name).
    it('auto-assigns first free inspector (Alice) when no inspectorId supplied', async () => {
        const { app } = buildApp(db, svc);
        const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.inspectionId).toBeTruthy();

        // Verify the inspection row was created with U1 (Alice).
        const { eq } = await import('drizzle-orm');
        const row = await db.select().from(inspections)
            .where(eq(inspections.id, body.data.inspectionId)).get();
        expect(row?.inspectorId).toBe(U1);

        // inspection_inspectors lead row must exist for U1.
        const link = await db.select().from(inspectionInspectors)
            .where(eq(inspectionInspectors.inspectionId, body.data.inspectionId)).get();
        expect(link?.userId).toBe(U1);
        expect(link?.role).toBe('lead');
    });

    // 2. Both busy at the requested time → 409 slot-unavailable.
    it('returns 409 when requested slot is fully booked', async () => {
        // Make U1 also busy at 09:00 on MONDAY.
        const { eq } = await import('drizzle-orm');
        await db.insert(inspections).values({
            id: 'i-u1-busy', tenantId: T1, inspectorId: U1,
            propertyAddress: '2 Busy Rd', date: `${MONDAY}T09:00:00Z`,
            status: 'scheduled', createdAt: new Date(),
        } as any);
        await db.insert(inspectionInspectors).values({
            inspectionId: 'i-u1-busy', userId: U1, tenantId: T1, role: 'lead', createdAt: new Date(),
        } as any);

        const { app } = buildApp(db, svc);
        // Request custom 09:00 (both U1 and U2 are now busy).
        const res = await app.request('/book', morningBody({ timeSlot: 'custom', customTime: '09:00' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.message).toMatch(/no longer available/i);
    });

    // 3. Company has zero availability rows → 409 with company-wide not-open copy.
    it('returns 409 company-level not-open when no availability rows exist at all', async () => {
        // Seed a fresh tenant with no availability rows.
        await db.insert(tenants).values({
            id: 'tt2', name: 'Empty Co', slug: 'emptyco', tier: 'free', status: 'active',
            maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
        } as any);
        await db.insert(users).values([
            { id: 'ue1', tenantId: 'tt2', email: 'e@empty.com', passwordHash: 'h', role: 'inspector', name: 'Emptyman', createdAt: new Date() },
        ] as any);
        // No availability rows for 'emptyco'.

        const { app } = buildApp(db, svc);
        const res = await app.request('/book', morningBody({ tenant: 'emptyco' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
        const body = await res.json() as any;
        // Must use company-level copy, NOT the per-inspector copy.
        expect(body.error.message).toMatch(/not open yet/i);
        expect(body.error.message).not.toMatch(/this inspector/i);
    });

    // 4. inspectorId supplied but busy → 409 (do NOT silently reassign).
    it('returns 409 when a supplied inspectorId is busy (no silent reassignment)', async () => {
        const { app } = buildApp(db, svc);
        // U2 is already busy at 09:00 (seeded in beforeEach).
        const res = await app.request('/book', morningBody({
            inspectorId: U2,
            timeSlot:    'custom',
            customTime:  '09:00',
        }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.message).toMatch(/no longer available/i);
    });

    // 5. inspectorId from another tenant → 404 'Inspector not found.' (B-16 guard).
    it('returns 404 when supplied inspectorId belongs to another tenant', async () => {
        // Seed tenant t2 and user U9.
        await db.insert(tenants).values({
            id: T2, name: 'Other Co', slug: 'other', tier: 'free', status: 'active',
            maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
        } as any);
        await db.insert(users).values([
            { id: U9, tenantId: T2, email: 'u9@other.com', passwordHash: 'h', role: 'inspector', name: 'Outsider', createdAt: new Date() },
        ] as any);

        const { app } = buildApp(db, svc);
        const res = await app.request('/book', morningBody({ inspectorId: U9 }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(404);
        const body = await res.json() as any;
        expect(body.error.message).toMatch(/inspector not found/i);
    });

    // 6. inspectorId=U2 supplied and free at 08:00 → 200 assigned to U2.
    it('assigns the supplied inspectorId when supplied and free', async () => {
        const { app } = buildApp(db, svc);
        // U2 is free at 08:00 on MONDAY (only 09:00 is taken).
        const res = await app.request('/book', morningBody({ inspectorId: U2 }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);

        const { eq } = await import('drizzle-orm');
        const row = await db.select().from(inspections)
            .where(eq(inspections.id, body.data.inspectionId)).get();
        expect(row?.inspectorId).toBe(U2);
    });
});
