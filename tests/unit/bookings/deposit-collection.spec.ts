/**
 * Collecting a deposit at booking, against a real database.
 *
 * The one that matters commercially is the FIRST one. A declined card that
 * also loses the appointment is worse than having no deposit feature at all,
 * so `POST /book` never charges anything: it creates the booking, freezes what
 * is owed, and hands the amount back. Everything about payment happens
 * afterwards, and the only thing that can write a deposit into the ledger is
 * the Stripe webhook.
 *
 * The rest guard the numbers around it: nothing is owed when nothing is
 * configured, the frozen amount survives a later reprice, and a multi-service
 * booking has ONE deposit rather than N.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { asD1Db } from '../helpers/test-db';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import {
    tenants, users, availability, tenantConfigs, inspections, services, orderPayments,
} from '../../../server/lib/db/schema';
import { BookingService } from '../../../server/services/booking.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { recordPayment, getHeldDepositCents } from '../../../server/services/payment-ledger.service';
import { outstandingDepositCents } from '../../../server/services/booking/deposit';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000000dep1';
const TENANT_SLUG = 'deposit-co';
/** A Friday, not a US federal holiday. */
const FRIDAY = '2026-07-17';
const SVC_MAIN = 'svc-main';
const SVC_RADON = 'svc-radon';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const FAKE_EXEC_CTX = {
    waitUntil: (p: Promise<unknown>) => { void p.catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

let db: BetterSQLite3Database<typeof schema>;
/**
 * The same handle presented to the payment-ledger helpers, whose `AnyDb`
 * parameter is the `Record<string, unknown>` schema-generic form of
 * `DrizzleD1Database` (Drizzle's schema generic is invariant, so the bare
 * `asD1Db(db)` return does not satisfy it).
 */
let ledgerDb: DrizzleD1Database<Record<string, unknown>>;
let sqlite: ReturnType<typeof createTestDb>['sqlite'];
let svc: BookingService;

beforeEach(async () => {
    const setup = createTestDb();
    db = setup.db as BetterSQLite3Database<typeof schema>;
    ledgerDb = asD1Db<Record<string, unknown>>(db);
    sqlite = setup.sqlite;
    await setupSchema(sqlite);
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    svc = new BookingService({} as D1Database);

    await db.insert(tenants).values({
        id: TENANT_ID, name: 'Deposit Co', slug: TENANT_SLUG,
        tier: 'pro', status: 'active', maxUsers: 5,
        deploymentMode: 'shared', createdAt: new Date(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(users).values({
        id: 'insp-1', tenantId: TENANT_ID, email: 'insp1@x.com',
        passwordHash: 'h', role: 'inspector', name: 'Solo', createdAt: new Date(),
    });
    await db.insert(availability).values({
        id: 'av-1', tenantId: TENANT_ID, inspectorId: 'insp-1',
        dayOfWeek: 5, startTime: '08:00', endTime: '12:00', createdAt: new Date(),
    });
    // The multi-service branch refuses a service with no template, so both
    // carry one — this spec is about money, not about that guard.
    await db.insert(schema.templates).values({
        id: 'tpl-1', tenantId: TENANT_ID, name: 'Standard', version: 1,
        schema: { sections: [] }, createdAt: new Date(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(services).values([
        { id: SVC_MAIN,  tenantId: TENANT_ID, name: 'Home inspection', price: 45000, templateId: 'tpl-1', createdAt: new Date() },
        { id: SVC_RADON, tenantId: TENANT_ID, name: 'Radon',           price: 9500,  templateId: 'tpl-1', createdAt: new Date() },
    ]);
});

afterEach(() => sqlite.close());

async function setTenantDeposit(policy: typeof schema.tenantConfigs.$inferInsert['depositPolicy'] | null) {
    await db.insert(tenantConfigs)
        .values({ tenantId: TENANT_ID, updatedAt: new Date(), defaultTimezone: 'UTC', depositPolicy: policy })
        .onConflictDoUpdate({ target: tenantConfigs.tenantId, set: { depositPolicy: policy } });
}

/**
 * The multi-service branch delegates to InspectionRequestService, which is
 * stubbed here — but it must produce REAL inspection rows, or the deposit
 * snapshot would silently update nothing and the test would pass on air.
 */
function buildApp(createdInspectionIds: string[]) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as 400);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('services', {
            booking: svc,
            widget: { isOriginAllowed: vi.fn().mockResolvedValue(true), recordEvent: vi.fn().mockResolvedValue(undefined) },
            email: { sendBookingConfirmation: vi.fn().mockResolvedValue(undefined) },
            notification: { createForAllAdmins: vi.fn().mockResolvedValue(undefined) },
            automation: { trigger: vi.fn().mockResolvedValue(undefined) },
            contact: { upsertClientContact: vi.fn().mockResolvedValue({ id: 'c1' }) },
            inspectionRequest: {
                create: vi.fn(async () => {
                    await db.insert(schema.inspectionRequests).values({
                        id: 'req-x', tenantId: TENANT_ID, clientName: 'Client',
                        propertyAddress: '1 Oak St', scheduledAt: new Date(`${FRIDAY}T08:00:00Z`),
                        createdAt: new Date(), updatedAt: new Date(),
                    });
                    await db.insert(inspections).values(createdInspectionIds.map((id, i) => ({
                        id, tenantId: TENANT_ID, inspectorId: 'insp-1',
                        propertyAddress: '1 Oak St', date: `${FRIDAY}T08:00:00Z`,
                        status: 'requested' as const, paymentStatus: 'unpaid' as const,
                        price: i === 0 ? 45000 : 9500, requestId: 'req-x', createdAt: new Date(),
                    })));
                    return { id: 'req-x', inspections: createdInspectionIds.map(id => ({ id })) };
                }),
            },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', bookingsRoutes);
    return app;
}

function book(app: ReturnType<typeof buildApp>, serviceIds: string[]) {
    return app.request('/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tenant: TENANT_SLUG,
            address: '1 Oak St, City, ST 12345',
            clientName: 'Client', clientEmail: 'c@example.com',
            date: FRIDAY, timeSlot: 'morning',
            services: serviceIds.map(serviceId => ({ serviceId })),
        }),
    }, FAKE_ENV, FAKE_EXEC_CTX);
}

const bodyOf = async (res: Response) =>
    (await res.json()) as { data: { success: boolean; inspectionId: string; depositRequiredCents?: number } };

describe('POST /book with a deposit configured', () => {
    it('books the appointment and owes the deposit — no charge, no ledger row', async () => {
        // The commercially load-bearing case. Nothing in this request talks to
        // Stripe, so there is no card to decline: whatever happens next, the
        // client has the appointment they believe they made, and the tenant can
        // see exactly what is unpaid.
        await setTenantDeposit({ type: 'percent', percent: 20 });
        const res = await book(buildApp(['insp-a']), [SVC_MAIN]);
        if (res.status !== 200) throw new Error(await res.text());
        expect(res.status).toBe(200);

        const body = await bodyOf(res);
        expect(body.data.success).toBe(true);
        expect(body.data.depositRequiredCents).toBe(9000);

        const row = await db.select().from(inspections).where(eq(inspections.id, 'insp-a')).get();
        expect(row!.depositRequiredCents).toBe(9000);
        expect(row!.depositOverridden).toBe(false);

        // Owed, not collected. Nothing may write this row but the webhook.
        expect(await getHeldDepositCents(ledgerDb, TENANT_ID, 'insp-a')).toBe(0);
        const ledger = await db.select().from(orderPayments).where(eq(orderPayments.tenantId, TENANT_ID)).all();
        expect(ledger).toHaveLength(0);
    });

    it('freezes the amount, so repricing the service later does not move it', async () => {
        await setTenantDeposit({ type: 'percent', percent: 20 });
        await book(buildApp(['insp-a']), [SVC_MAIN]);

        await db.update(services).set({ price: 90000 }).where(eq(services.id, SVC_MAIN));

        const row = await db.select().from(inspections).where(eq(inspections.id, 'insp-a')).get();
        expect(row!.depositRequiredCents).toBe(9000);
        const owed = await outstandingDepositCents(asD1Db(db), TENANT_ID, 'insp-a');
        expect(owed!.outstandingCents).toBe(9000);
    });

    it('puts ONE deposit on the order, on the primary, with the siblings at zero', async () => {
        // Not NULL on the siblings: NULL reads as "no deposit configured", and
        // what is true is "covered by the order's".
        await setTenantDeposit({ type: 'percent', percent: 20 });
        const res = await book(buildApp(['insp-a', 'insp-b']), [SVC_MAIN, SVC_RADON]);
        expect((await bodyOf(res)).data.depositRequiredCents).toBe(10900);

        const rows = await db.select().from(inspections).where(eq(inspections.tenantId, TENANT_ID)).all();
        expect(rows.map(r => [r.id, r.depositRequiredCents]).sort()).toEqual([
            ['insp-a', 10900],
            ['insp-b', 0],
        ]);
    });

    it('honours a service that opted out of the workspace default', async () => {
        await setTenantDeposit({ type: 'percent', percent: 20 });
        await db.update(services).set({ depositPolicy: { type: 'none' } }).where(eq(services.id, SVC_RADON));
        const res = await book(buildApp(['insp-a', 'insp-b']), [SVC_MAIN, SVC_RADON]);
        expect((await bodyOf(res)).data.depositRequiredCents).toBe(9000);
    });
});

describe('POST /book with no deposit configured', () => {
    it('asks for nothing and leaves the column untouched', async () => {
        await setTenantDeposit(null);
        const res = await book(buildApp(['insp-a']), [SVC_MAIN]);
        expect(res.status).toBe(200);
        expect((await bodyOf(res)).data.depositRequiredCents).toBe(0);

        const row = await db.select().from(inspections).where(eq(inspections.id, 'insp-a')).get();
        // NULL, not 0: this workspace has no deposit at all, which is different
        // from "this order's deposit is zero". The booking form reads the
        // response, and 0 there is what makes it render no payment step.
        expect(row!.depositRequiredCents).toBeNull();
    });

    it('books normally when the workspace has no config row at all', async () => {
        const res = await book(buildApp(['insp-a']), [SVC_MAIN]);
        expect(res.status).toBe(200);
        expect((await bodyOf(res)).data.depositRequiredCents).toBe(0);
    });
});

describe('the deposit becomes real only when Stripe says so', () => {
    beforeEach(async () => {
        await setTenantDeposit({ type: 'percent', percent: 20 });
        await book(buildApp(['insp-a']), [SVC_MAIN]);
    });

    const settle = (providerRef: string, amountCents = 9000) =>
        recordPayment(ledgerDb, TENANT_ID, {
            inspectionId: 'insp-a', invoiceId: null, kind: 'deposit',
            amountCents, method: 'card', provider: 'stripe', providerRef,
        });

    it('records it on webhook confirmation, held against the order with no invoice', async () => {
        expect(await getHeldDepositCents(ledgerDb, TENANT_ID, 'insp-a')).toBe(0);
        await settle('pi_1');
        expect(await getHeldDepositCents(ledgerDb, TENANT_ID, 'insp-a')).toBe(9000);

        const row = await db.select().from(orderPayments).where(eq(orderPayments.providerRef, 'pi_1')).get();
        expect(row!.invoiceId).toBeNull();
        expect(row!.kind).toBe('deposit');
    });

    it('is idempotent across redelivery — the second call appends nothing', async () => {
        expect(await settle('pi_1')).not.toBeNull();
        // Null is the contract for "already recorded", and it is what the
        // handler keys its "did anything happen" decision on.
        expect(await settle('pi_1')).toBeNull();
        expect(await getHeldDepositCents(ledgerDb, TENANT_ID, 'insp-a')).toBe(9000);
    });

    it('nets what has landed against what is owed', async () => {
        await settle('pi_partial', 4000);
        const owed = await outstandingDepositCents(asD1Db(db), TENANT_ID, 'insp-a');
        expect(owed).toEqual({ requiredCents: 9000, heldCents: 4000, outstandingCents: 5000 });
    });

    it('does not go negative when more lands than was asked for', async () => {
        await settle('pi_big', 15000);
        expect((await outstandingDepositCents(asD1Db(db), TENANT_ID, 'insp-a'))!.outstandingCents).toBe(0);
    });
});
