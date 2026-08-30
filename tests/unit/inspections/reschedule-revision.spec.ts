/**
 * PATCH /api/inspections/:id when the date moves — and what it says about the
 * statutory revision that date now falls under.
 *
 * Rescheduling is a daily operation: a client asks for another morning. It stays
 * ALLOWED. What it must not be is silent, because moving a date can move an
 * inspection across a mandatory cutover while the template stays exactly where
 * it was, and the consequence of that is a form that cannot be produced at all.
 *
 * The pair matters more than either half. A rule that flagged every reschedule
 * would satisfy the first assertion and be useless, so the second one moves the
 * date INSIDE the same window and requires the response to say nothing is wrong.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError, Errors } from '../../../server/lib/errors';

// The shipped catalogue is empty by declaration, so a test that could not
// supply its own revisions could only ever assert that nothing is publishable.
// `7-7` becomes mandatory on 2026-03-15. Spelled out rather than built with the
// helper above: `vi.mock` is hoisted above every binding in this file.
vi.mock('../../../server/lib/statutory/forms', () => {
    const base = {
        formId: 'tx_trec_rei',
        effectiveFrom: Date.UTC(2024, 0, 1),
        mandatoryFrom: null,
        effectiveUntil: null,
        withdrawn: null,
        sourceUrl: 'https://www.trec.texas.gov/x.pdf',
        sourceHash: 'a'.repeat(64),
        publishedBy: 'platform',
        publishedAt: Date.UTC(2024, 0, 1),
    };
    return {
        PUBLISHED_FORM_VERSIONS: [
            { ...base, version: '7-6' },
            { ...base, version: '7-7', mandatoryFrom: Date.UTC(2026, 2, 15) },
        ],
        FIELD_MAPS: [],
        EMPTY_CATALOGUE_REASON: null,
        fieldMapFor: () => null,
    };
});

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const STATUTORY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDINARY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SNAPSHOT = {
    schemaVersion: 2 as const,
    sections: [],
    statutoryForm: { formId: 'tx_trec_rei', bindings: {}, revision: '7-6' },
};

function buildApp(db: BetterSQLite3Database<typeof schema>) {
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('user', { sub: ACTOR, role: 'owner', tenantId: TENANT });
        c.set('sdb', {
            getById: async () => ({ permissionOverrides: null }),
        } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: {
                getInspection: async (id: string) => {
                    const row = await db.select().from(schema.inspections)
                        .where(eq(schema.inspections.id, id)).get();
                    if (!row) throw Errors.NotFound('Inspection not found');
                    return { inspection: row };
                },
                isInspectionPhotoKey: async () => true,
            },
        } as unknown as HonoConfig['Variables']['services']);
        c.env = { DB: {} } as HonoConfig['Bindings'];
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

import { eq } from 'drizzle-orm';

async function patchDate(app: ReturnType<typeof buildApp>, id: string, date: string) {
    const res = await app.request(`/api/inspections/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date }),
    });
    return { res, body: await res.json() as { data?: { revisionStatus?: { kind: string } } } };
}

describe('rescheduling an inspection that produces a statutory form', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let app: ReturnType<typeof buildApp>;

    beforeEach(async () => {
        // The clock is pinned, and only the clock. Three of the four answers
        // this endpoint can give depend on where TODAY sits relative to a
        // cutover, so a test reading the wall clock would assert a different
        // thing every month and eventually a different thing than it was
        // written to assert. 2026-01-10 is comfortably outside the warning
        // window before 7-7's mandate on 2026-03-15.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.UTC(2026, 0, 10));
        const made = createTestDb();
        await setupSchema(made.sqlite);
        db = made.db as unknown as BetterSQLite3Database<typeof schema>;
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: STATUTORY, tenantId: TENANT, propertyAddress: '1 Cutover Way',
            date: '2026-03-10', status: 'scheduled', templateSnapshot: SNAPSHOT,
            createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: ORDINARY, tenantId: TENANT, propertyAddress: '2 Ordinary Rd',
            date: '2026-03-10', status: 'scheduled',
            templateSnapshot: { schemaVersion: 2, sections: [] },
            createdAt: new Date(),
        });
        app = buildApp(db);
    });

    afterEach(() => { vi.useRealTimers(); });

    it('a date change that crosses a cutover comes back with the consequence attached', async () => {
        // 2026-03-10 is fine on 7-6; 2026-03-20 falls under 7-7.
        const { res, body } = await patchDate(app, STATUTORY, '2026-03-20');
        // The change is ALLOWED -- rescheduling is the client's business.
        expect(res.status).toBe(200);
        const moved = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.id, STATUTORY)).get();
        expect(moved?.date).toBe('2026-03-20');
        // What it must not be is silent.
        expect(body.data?.revisionStatus?.kind).toBe('cannot_produce');
    });

    it('a date change inside the same window says nothing is wrong', async () => {
        // The positive control: a rule that flagged EVERY reschedule would pass
        // the assertion above and be useless.
        const { res, body } = await patchDate(app, STATUTORY, '2026-03-11');
        expect(res.status).toBe(200);
        expect(body.data?.revisionStatus?.kind).toBe('current');
    });

    it('an ordinary inspection is told nothing at all', async () => {
        // The second control. Every inspection in this product is this one, and
        // a revision status on a template that declares no form would be an
        // answer to a question nobody asked.
        const { res, body } = await patchDate(app, ORDINARY, '2026-03-20');
        expect(res.status).toBe(200);
        expect(body.data?.revisionStatus).toBeUndefined();
    });
});
