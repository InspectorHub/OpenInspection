/**
 * Task 7b (people-role-profiles) — the legacy single-service booking path in
 * BookingService.fulfillBooking inserts `inspections` directly (line ~580,
 * not routed through InspectionCoreService.createInspection, which already
 * got the Task 7 people-write). This mirrors that pattern for the direct
 * insert: after the client contact is resolved (bookingClientContactId,
 * set ~line 684) and any agent referral is resolved (resolvedAgentContactId),
 * both are mirrored into inspection_people (client / buyer_agent) alongside
 * the legacy clientContactId / referredByAgentId columns.
 *
 * Mirrors booking-contact-upsert.spec.ts's harness: mounts the real
 * bookingsRoutes on OpenAPIHono with onError mapping, real BookingService +
 * ContactService over an in-memory better-sqlite3 DB (via vi.mock of
 * drizzle-orm/d1). Other services are stubbed to no-ops.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import {
    tenants,
    users,
    availability,
    inspections,
    agentTenantLinks,
} from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { BookingService } from '../../../server/services/booking.service';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
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
const AGENT_USER = 'cccccccc-0000-4000-8000-000000000001';
const AGENT_CONTACT = 'dddddddd-0000-4000-8000-000000000001';

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
    await seedRoleProfiles(db as any, T1, new Date(1));
}

async function seedAgentReferral(db: BetterSQLite3Database<typeof schema>) {
    // Global agent user (tenantId null) with a slug + an active link to T1
    // whose inspectorContactId points at the agent's contact row in T1.
    await db.insert(users).values({
        id: AGENT_USER, tenantId: null, email: 'jane@realty.com', passwordHash: 'h',
        role: 'agent', name: 'Jane Agent', slug: 'jane-tester', createdAt: new Date(),
    } as any);
    await db.insert(schema.contacts).values({
        id: AGENT_CONTACT, tenantId: T1, type: 'agent', name: 'Jane Agent',
        email: 'jane@realty.com', createdAt: new Date(),
    } as any);
    await db.insert(agentTenantLinks).values({
        id: crypto.randomUUID(),
        agentUserId: AGENT_USER,
        tenantId: T1,
        inspectorContactId: AGENT_CONTACT,
        status: 'active',
        invitedByUserId: U1,
        createdAt: new Date(),
    } as any);
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

describe('POST /book — writes inspection_people (Task 7b)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let booking: BookingService;
    let contact: ContactService;
    let people: PeopleService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);

        booking = new BookingService({} as D1Database);
        contact = new ContactService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });
        await seedBaseTenant(db);
    });

    afterEach(() => {
        sqlite.close();
        vi.restoreAllMocks();
    });

    it('writes the client role for a plain single-service booking', async () => {
        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);

        const rows = await people.listPeople(T1, body.data.inspectionId);
        expect(rows.map(r => r.roleKey).sort()).toEqual(['client']);
        expect(rows.find(r => r.roleKey === 'client')?.email).toBe('client@test.com');
    });

    it('writes client + buyer_agent when the booking carries an agent referral', async () => {
        await seedAgentReferral(db);
        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody({ agentRefSlug: 'jane-tester' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);

        // Task 13 dropped inspections.referredByAgentId — the buyer_agent link
        // now lives ONLY in inspection_people.
        const rows = await people.listPeople(T1, body.data.inspectionId);
        expect(rows.map(r => r.roleKey).sort()).toEqual(['buyer_agent', 'client']);
        expect(rows.find(r => r.roleKey === 'buyer_agent')?.contactId).toBe(AGENT_CONTACT);
    });

    it('does not fail the booking when the people-write throws (non-fatal)', async () => {
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const addPersonSpy = vi.spyOn(PeopleService.prototype, 'addPerson').mockRejectedValue(new Error('boom'));

        const { app } = buildApp(db, booking, contact);
        const res = await app.request('/book', morningBody(), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);

        expect(addPersonSpy).toHaveBeenCalled();
        const insp = await db.select().from(inspections)
            .where((await import('drizzle-orm')).eq(inspections.id, body.data.inspectionId)).get();
        expect(insp).toBeTruthy();
        expect(errorSpy).toHaveBeenCalled();
    });
});

describe('POST /book — writes inspection_people for ALL booking inspections (multi-service fix)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let booking: BookingService;
    let contact: ContactService;
    let people: PeopleService;

    const SVC_1 = 'a1a1a1a1-0000-4000-8000-000000000001';
    const SVC_2 = 'a1a1a1a1-0000-4000-8000-000000000002';
    const TPL_1 = '11111111-0000-4000-8000-000000000001';
    const TPL_2 = '11111111-0000-4000-8000-000000000002';
    const MULTI_INSP_A = 'ffffffff-0000-4000-8000-000000000001';
    const MULTI_INSP_B = 'ffffffff-0000-4000-8000-000000000002';

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);

        booking = new BookingService({} as D1Database);
        contact = new ContactService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });
        await seedBaseTenant(db);

        // Real service (+ backing template) rows so the pre-flight lookup in
        // fulfillBooking (which validates serviceIds against `services` before
        // delegating to InspectionRequestService.create) succeeds.
        // InspectionRequestService itself is stubbed (see makeServiceStubs) so
        // these templates are never actually used to build inspection rows.
        await db.insert(schema.templates).values([
            { id: TPL_1, tenantId: T1, name: 'Residential', version: 1, schema: { sections: [] } as any, createdAt: new Date() },
            { id: TPL_2, tenantId: T1, name: 'Radon',       version: 1, schema: { sections: [] } as any, createdAt: new Date() },
        ]);
        await db.insert(schema.services).values([
            {
                id: SVC_1, tenantId: T1, name: 'Full Inspection', price: 40000,
                durationMinutes: 120, templateId: TPL_1,
                active: true, sortOrder: 0, createdAt: new Date(),
            },
            {
                id: SVC_2, tenantId: T1, name: 'Radon Test', price: 15000,
                durationMinutes: 60, templateId: TPL_2,
                active: true, sortOrder: 1, createdAt: new Date(),
            },
        ] as any);
    });

    afterEach(() => {
        sqlite.close();
        vi.restoreAllMocks();
    });

    it('writes the client role for EVERY inspection created by a multi-service booking, not just the first', async () => {
        const { app, stubs } = buildApp(db, booking, contact);
        (stubs.inspectionRequest.create as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 'req-multi',
            inspections: [{ id: MULTI_INSP_A }, { id: MULTI_INSP_B }],
        });

        const res = await app.request('/book', morningBody({
            services: [{ serviceId: SVC_1 }, { serviceId: SVC_2 }],
        }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect([...body.data.inspectionIds].sort()).toEqual([MULTI_INSP_A, MULTI_INSP_B].sort());

        for (const id of [MULTI_INSP_A, MULTI_INSP_B]) {
            const rows = await people.listPeople(T1, id);
            expect(rows.map(r => r.roleKey)).toEqual(['client']);
            expect(rows[0]?.email).toBe('client@test.com');
        }
    });
});
