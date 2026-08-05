/**
 * Task 12 (#111 / IA-18) — POST /api/public/book client-contact upsert tests.
 *
 * Mirrors booking-autoassign.spec.ts: mounts real bookingsRoutes on
 * OpenAPIHono with onError mapping, uses the REAL BookingService + REAL
 * ContactService over an in-memory better-sqlite3 DB (via vi.mock of
 * drizzle-orm/d1). Other services the handler touches (widget, email,
 * notification, automation, inspectionRequest) are stubbed to no-ops.
 *
 * Verifies: a public booking find-or-creates ONE client contact and links it
 * as the inspection's primary client via inspection_people (Task 13 dropped
 * the legacy inspections.clientContactId column — see booking.service.ts),
 * the upsert is idempotent per email, and a contact-upsert failure NEVER
 * fails the booking (non-fatal guarantee).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import {
    tenants,
    users,
    availability,
    inspections,
    contacts,
} from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { BookingService } from '../../../server/services/booking.service';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { logger } from '../../../server/lib/logger';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Must mock BEFORE importing the routes module.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Rate-limit is a no-op in tests (no KV).
vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

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
    // Task 13 — client identity is persisted ONLY via inspection_people now;
    // booking.service.ts's people-write resolves role profile ids by key, so
    // the role profiles must exist for the write to land.
    const { seedRoleProfiles } = await import('../../../server/services/seed/seed-role-profiles');
    await seedRoleProfiles(db, T1, new Date());
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

    // 1. Successful booking → a client contact row exists AND is linked as
    //    the inspection's primary client via inspection_people.
    it('creates a client contact and links it as the inspection primary client (inspection_people)', async () => {
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
        expect(insp).toBeTruthy();
        const primary = await new PeopleService({ DB: {} as D1Database }).getPrimaryClient(T1, insp!.id);
        expect(primary?.contactId).toBe(contactRows[0].id);
    });

    // 2. Same email books twice → ONE contact row (idempotent upsert); both
    //    inspections link to the same contact via inspection_people.
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

        const people = new PeopleService({ DB: {} as D1Database });
        const primary1 = await people.getPrimaryClient(T1, body1.data.inspectionId);
        const primary2 = await people.getPrimaryClient(T1, body2.data.inspectionId);
        expect(primary1?.contactId).toBe(contactId);
        expect(primary2?.contactId).toBe(contactId);
    });

    // 3. A stated language preference lands on the contact, and its ABSENCE
    //    stays absent. These two are one pair: the field exists so someone can
    //    count who asked for another language, and that count only means
    //    anything if a booking that said nothing is distinguishable from one
    //    that chose English.
    it('stores the language the client chose on their contact', async () => {
        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody({ locale: 'es-419' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const { eq, and } = await import('drizzle-orm');
        const row = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.email, 'client@test.com'))).get();
        expect(row?.locale).toBe('es-419');
    });

    it('never clears a stored language when a later booking says nothing', async () => {
        // Silence is not a retraction — only a NEW answer replaces the old one.
        const { app } = buildApp(db, booking, contact);
        await app.request('/book', morningBody({ timeSlot: 'custom', customTime: '08:00', locale: 'es-419' }), FAKE_ENV, FAKE_EXEC_CTX);
        await app.request('/book', morningBody({ timeSlot: 'custom', customTime: '10:00' }), FAKE_ENV, FAKE_EXEC_CTX);

        const { eq, and } = await import('drizzle-orm');
        const rows = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.type, 'client'))).all();
        expect(rows.length).toBe(1);
        expect(rows[0].locale).toBe('es-419');
    });

    it('leaves the locale NULL when the client did not choose one', async () => {
        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const { eq, and } = await import('drizzle-orm');
        const row = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.email, 'client@test.com'))).get();
        // NULL means "fall through to the tenant default", never "English".
        expect(row?.locale).toBeNull();
    });

    it('stores a regional variant as the catalogue we can actually speak', async () => {
        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody({ locale: 'es-MX' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const { eq, and } = await import('drizzle-orm');
        const row = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.email, 'client@test.com'))).get();
        expect(row?.locale).toBe('es-419');
    });

    it('accepts a booking in a language we do not speak, and stores no promise', async () => {
        // Rejecting the booking would be the worse failure by far: the request
        // is for an inspection, not for a translation.
        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody({ locale: 'fr-FR' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const { eq, and } = await import('drizzle-orm');
        const row = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.email, 'client@test.com'))).get();
        expect(row?.locale).toBeNull();
    });

    it('lets a returning client change their mind about the language', async () => {
        // Unlike name and phone, which fill forward, the newer answer wins:
        // being written to in English after asking for Spanish is the failure.
        const { app } = buildApp(db, booking, contact);
        await app.request('/book', morningBody({ timeSlot: 'custom', customTime: '08:00', locale: 'en' }), FAKE_ENV, FAKE_EXEC_CTX);
        await app.request('/book', morningBody({ timeSlot: 'custom', customTime: '10:00', locale: 'es-419' }), FAKE_ENV, FAKE_EXEC_CTX);

        const { eq, and } = await import('drizzle-orm');
        const rows = await db.select().from(contacts)
            .where(and(eq(contacts.tenantId, T1), eq(contacts.type, 'client'))).all();
        expect(rows.length).toBe(1);
        expect(rows[0].locale).toBe('es-419');
    });

    // 4. Contact-upsert failure → booking still succeeds (200), inspection row
    //    exists with NO primary client linked (inspection_people write never
    //    ran since there is no contact id to link), and a warn was logged.
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
        const primary = await new PeopleService({ DB: {} as D1Database }).getPrimaryClient(T1, insp!.id);
        expect(primary).toBeNull();

        // A warn was logged, and it must NOT contain the client's email.
        expect(warnSpy).toHaveBeenCalled();
        const loggedPayloads = JSON.stringify(warnSpy.mock.calls);
        expect(loggedPayloads).not.toContain('client@test.com');
    });
});
