/**
 * The embedded widget's origin allowlist applies to the surface it was written
 * for — and an allowlist nobody has written is not an empty allowlist.
 *
 * TWO HALVES, BOTH BROKEN.
 *
 * `admitBooking` gates the check on `c.req.query('embed') === '1'`. The embed
 * posts to a bare `/api/public/book`, so the flag was never set and
 * `widget.isOriginAllowed` had never once run for a booking. A tenant-facing
 * restriction that never executes is not a restriction.
 *
 * Wiring it as written would have been worse. `isOriginAllowed` is fail-closed
 * — `if (allowed.length === 0) return false` — and the schema comment states
 * the intent outright: "the widget embeds nowhere until an origin is saved".
 * But NOTHING IN `app/` CAN SAVE ONE. The only writer is an admin-config API
 * endpoint; the embed settings panel hands the tenant a copy-paste iframe
 * snippet and never mentions origins. Switching the check on as designed would
 * have 403'd every embed in existence, with no self-service way out. A lock
 * with no key is not a security posture.
 *
 * So the rule this pins is: enforce what the tenant configured, and treat "not
 * configured" as what it is. Every tenant is strictly better off than today —
 * one who has saved origins gets them honoured for the first time, and one who
 * has not is exactly where they already were.
 *
 * `isOriginAllowed` keeps its fail-closed contract, because its other caller
 * (`server/api/widget.ts`, which silently drops unauthorised analytics events)
 * wants precisely that. The new rule lives at the booking call site.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import { tenants, users, availability, tenantConfigs } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { BookingService } from '../../../server/services/booking.service';
import { WidgetService } from '../../../server/services/widget.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { nextWeekday } from '../helpers/bookable-date';

const MONDAY = nextWeekday(1);
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const HOST = 'https://acme-inspections.example';

const FAKE_ENV = { DB: {} as D1Database } as unknown as HonoConfig['Bindings'];
const FAKE_EXEC_CTX: ExecutionContext = makeExecutionContext().ctx;

function buildApp(db: BetterSQLite3Database<typeof schema>, bookingSvc: BookingService) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    // The REAL WidgetService, so the allowlist under test is the stored one.
    const widget = new WidgetService({} as D1Database);
    const stubs = {
        booking: bookingSvc,
        widget,
        email: { sendBookingConfirmation: vi.fn().mockResolvedValue(undefined) },
        notification: { createForAllAdmins: vi.fn().mockResolvedValue(undefined) },
        automation: { trigger: vi.fn().mockResolvedValue(undefined) },
        inspectionRequest: {
            create: vi.fn().mockResolvedValue({ id: 'req-x', inspections: [{ id: 'insp-x' }] }),
        },
    };
    app.use('*', async (c, next) => {
        c.set('services', stubs as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', bookingsRoutes);
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    return app;
}

async function seed(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(tenants).values({
        id: T1, slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    } as never);
    await db.insert(users).values({
        id: U1, tenantId: T1, email: 'alice@acme.com', passwordHash: 'h',
        role: 'inspector', name: 'Alice', createdAt: new Date(),
    } as never);
    await db.insert(availability).values({
        id: 'a1', tenantId: T1, inspectorId: U1, dayOfWeek: 1,
        startTime: '09:00', endTime: '17:00', createdAt: new Date(),
    } as never);
    // A DECLARED company timezone. Public booking refuses a workspace that never
    // set one (the NOT NULL default 'UTC' is the unset sentinel).
    await db.insert(tenantConfigs).values({
        tenantId: T1, updatedAt: new Date(), defaultTimezone: 'America/New_York',
    } as never);
}

/** What the embedded widget posts: the flag, and the host page's Origin. */
function embedSubmit(origin: string | null, i: number) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (origin) headers.origin = origin;
    return {
        method: 'POST',
        headers,
        body: JSON.stringify({
            tenant: 'acme',
            address: `${i} Main St Anytown`,
            clientName: 'Test Client',
            clientEmail: `client${i}@test.com`,
            date: MONDAY,
            timeSlot: 'all-day',
        }),
    };
}

describe('embedded booking submissions and the origin allowlist', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };
    let svc: BookingService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new BookingService({} as D1Database);
        await seed(db);
    });

    afterEach(() => sqlite.close());

    async function saveOrigins(origins: string[]) {
        // An UPSERT now: the seed already wrote this row to declare the company
        // timezone, and a second plain insert would collide with it.
        await db.insert(tenantConfigs).values({
            tenantId: T1, widgetAllowedOrigins: origins, updatedAt: new Date(),
        } as never).onConflictDoUpdate({
            target: tenantConfigs.tenantId, set: { widgetAllowedOrigins: origins },
        });
    }

    /**
     * The change that makes the other three meaningful. Nothing had ever set
     * `embed=1`, so the block below `isWidgetSubmit` was unreachable code.
     */
    it('refuses an embed submission from an origin the tenant did not list', async () => {
        await saveOrigins([HOST]);
        const app = buildApp(db, svc);
        const res = await app.request('/book?embed=1', embedSubmit('https://somewhere-else.example', 1), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(403);
    });

    // POSITIVE CONTROL: the allowlist must still let the tenant's own site in,
    // or the test above would pass on a rule that simply refuses everything.
    it('accepts an embed submission from an origin the tenant listed', async () => {
        await saveOrigins([HOST]);
        const app = buildApp(db, svc);
        const res = await app.request('/book?embed=1', embedSubmit(HOST, 2), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
    });

    /**
     * THE LOCK WITH NO KEY. No tenant has ever configured origins, because no
     * screen in the product offers to. Enforcing an unwritten list would end
     * every embedded booking everywhere the moment this shipped.
     */
    it('does not lock out a tenant who has configured no allowlist at all', async () => {
        const app = buildApp(db, svc);
        const res = await app.request('/book?embed=1', embedSubmit('https://anywhere.example', 3), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
    });

    // A booking from the tenant's own /book page is not a widget submission and
    // must not start consulting a widget allowlist.
    it('leaves a non-embed booking alone even when an allowlist exists', async () => {
        await saveOrigins([HOST]);
        const app = buildApp(db, svc);
        const res = await app.request('/book', embedSubmit('https://not-listed.example', 4), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
    });
});
