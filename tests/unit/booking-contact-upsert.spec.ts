/**
 * Task 12 (#111 / IA-18) — POST /api/public/book client-contact upsert tests.
 *
 * Mirrors booking-autoassign.spec.ts: mounts real bookingsRoutes on
 * OpenAPIHono with onError mapping, uses the REAL BookingService + REAL
 * ContactService over an in-memory better-sqlite3 DB (via vi.mock of
 * drizzle-orm/d1). Other services the handler touches (widget, email,
 * notification, automation, inspectionRequest) are stubbed to no-ops.
 *
 * Verifies: a public booking find-or-creates ONE client contact and stamps
 * inspections.clientContactId, the upsert is idempotent per email, and a
 * contact-upsert failure NEVER fails the booking (non-fatal guarantee).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from './db';
import {
    tenants,
    users,
    availability,
    inspections,
    contacts,
} from '../../server/lib/db/schema';
import * as schema from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import { AppError } from '../../server/lib/errors';
import { BookingService } from '../../server/services/booking.service';
import { ContactService } from '../../server/services/contact.service';
import { logger } from '../../server/lib/logger';
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

// 2026-06-08 is a Monday (dayOfWeek = 1) — mirrors booking-autoassign.spec.ts.
const MONDAY = '2026-06-08';

const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const U2 = 'bbbbbbbb-0000-4000-8000-000000000002';

const FAKE_ENV: HonoConfig['Bindings'] = {
    DB: {} as D1Database,
} as unknown as HonoConfig['Bindings'];

function makeServiceStubs(bookingSvc: BookingService, contactSvc: ContactService) {
    return {
        booking: bookingSvc,
        contact: contactSvc,
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
            create: vi.fn().mockResolvedValue({ id: 'req-x', inspections: [{ id: 'insp-x' }] }),
        },
    };
}

const FAKE_EXEC_CTX: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
};

function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    bookingSvc: BookingService,
    contactSvc: ContactService,
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

    const stubs = makeServiceStubs(bookingSvc, contactSvc);
    app.use('*', async (c, next) => {
        c.set('services', stubs as unknown as HonoConfig['Variables']['services']);
        await next();
    });

    app.route('/', bookingsRoutes);

    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);

    return { app, stubs };
}

async function seedBaseTenant(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(tenants).values({
        id: T1, name: 'Acme', slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    } as any);
    await db.insert(users).values([
        { id: U1, tenantId: T1, email: 'alice@acme.com', passwordHash: 'h', role: 'owner',     name: 'Alice', createdAt: new Date() },
        { id: U2, tenantId: T1, email: 'bob@acme.com',   passwordHash: 'h', role: 'inspector', name: 'Bob',   createdAt: new Date() },
    ] as any);
    await db.insert(availability).values([
        { id: 'a1', tenantId: T1, inspectorId: U1, dayOfWeek: 1, startTime: '08:00', endTime: '12:00', createdAt: new Date() },
        { id: 'a2', tenantId: T1, inspectorId: U2, dayOfWeek: 1, startTime: '08:00', endTime: '12:00', createdAt: new Date() },
    ] as any);
}

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

describe('POST /book — client contact upsert (#111 / IA-18)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let booking: BookingService;
    let contact: ContactService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);

        booking = new BookingService({} as D1Database);
        contact = new ContactService({} as D1Database);
        await seedBaseTenant(db);
    });

    afterEach(() => {
        sqlite.close();
        vi.restoreAllMocks();
    });

    // 1. Successful booking → a client contact row exists AND the inspection
    //    row's clientContactId points at it.
    it('creates a client contact and stamps inspection.clientContactId', async () => {
        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);

        const { eq, and } = await import('drizzle-orm');

        const contactRows = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.type, 'client'))).all();
        expect(contactRows.length).toBe(1);
        expect(contactRows[0].email).toBe('client@test.com');

        const insp = await db.select().from(inspections)
            .where(eq(inspections.id, body.data.inspectionId)).get();
        expect(insp?.clientContactId).toBe(contactRows[0].id);
    });

    // 2. Same email books twice → ONE contact row (idempotent upsert); both
    //    inspections point at the same contact.
    it('reuses the same contact when the same email books twice', async () => {
        const { app } = buildApp(db, booking, contact);

        const res1 = await app.request('/book', morningBody({ timeSlot: 'custom', customTime: '08:00' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res1.status).toBe(200);
        const body1 = await res1.json() as any;

        const res2 = await app.request('/book', morningBody({ timeSlot: 'custom', customTime: '10:00' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res2.status).toBe(200);
        const body2 = await res2.json() as any;

        const { eq, and } = await import('drizzle-orm');

        const contactRows = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.type, 'client'))).all();
        expect(contactRows.length).toBe(1);
        const contactId = contactRows[0].id;

        const insp1 = await db.select().from(inspections)
            .where(eq(inspections.id, body1.data.inspectionId)).get();
        const insp2 = await db.select().from(inspections)
            .where(eq(inspections.id, body2.data.inspectionId)).get();
        expect(insp1?.clientContactId).toBe(contactId);
        expect(insp2?.clientContactId).toBe(contactId);
    });

    // 3. Contact-upsert failure → booking still succeeds (200), inspection row
    //    exists with clientContactId null, and a warn was logged.
    it('does not fail the booking when contact upsert throws (non-fatal)', async () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const upsertSpy = vi.spyOn(contact, 'upsertClientContact')
            .mockRejectedValue(new Error('boom'));

        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);

        expect(upsertSpy).toHaveBeenCalled();

        const { eq } = await import('drizzle-orm');
        const insp = await db.select().from(inspections)
            .where(eq(inspections.id, body.data.inspectionId)).get();
        expect(insp).toBeTruthy();
        expect(insp?.clientContactId).toBeNull();

        // A warn was logged, and it must NOT contain the client's email.
        expect(warnSpy).toHaveBeenCalled();
        const loggedPayloads = JSON.stringify(warnSpy.mock.calls);
        expect(loggedPayloads).not.toContain('client@test.com');
    });
});
