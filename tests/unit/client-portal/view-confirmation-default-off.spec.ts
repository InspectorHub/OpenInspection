/**
 * OI #271 — the counter's default position is SHUT.
 *
 * This file exists separately from `view-confirmation.spec.ts` for one reason:
 * that suite mocks `report-views.gate` to force the counter ON, because its
 * subject is the counting behaviour. A default assertion made inside a file
 * that mocks the thing it is asserting about tests the mock. So the default is
 * pinned HERE, where nothing is mocked and the real constant is imported.
 *
 * ⚠️ The trap this guards is specific and easy to walk into: a test that only
 * proves "the switch works when flipped on" is **equally green against a switch
 * that defaults on**. Two of the four tests below therefore assert the closed
 * state directly — the literal value, and the absence of any database contact —
 * rather than inferring it from behaviour that a default-on gate would also
 * produce.
 *
 * Delete this file together with `server/lib/report-views.gate.ts`, in the
 * change that satisfies LIA conditions 4, 5 and 6.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { buildKeyring, type JwtKeyring } from '../../../server/lib/jwt-keyring';
import { REPORT_VIEW_COUNTING_ENABLED } from '../../../server/lib/report-views.gate';
import { recordReportView, shouldCountReportView } from '../../../server/lib/report-views';
import publicReportRoutes from '../../../server/api/public-report';

const TENANT = '00000000-0000-0000-0000-0000000000c2';
const SECRET = 'test-jwt-secret';
const INSP = 'insp-271-off';

/** Mirrors the helper in `view-confirmation.spec.ts`; dies with the same migration. */
function ensureViewSchema(sqlite: { exec: (s: string) => void }) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS report_views (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        inspection_id text NOT NULL,
        access_token_id text NOT NULL,
        first_viewed_at integer,
        last_viewed_at integer,
        view_count integer DEFAULT 0 NOT NULL
    );`);
    sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_report_views_scope
        ON report_views (tenant_id, inspection_id, access_token_id);`);
    try {
        sqlite.exec('ALTER TABLE inspection_access_tokens ADD COLUMN view_tracking_objected_at integer;');
    } catch {
        /* already present — the real migration landed */
    }
}

async function genKeypairPem() {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair;
    const pem = (buf: ArrayBuffer, label: string) => {
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END ${label}-----`;
    };
    return {
        privatePem: pem(await crypto.subtle.exportKey('pkcs8', privateKey), 'PRIVATE KEY'),
        publicPem: pem(await crypto.subtle.exportKey('spki', publicKey), 'PUBLIC KEY'),
    };
}

/**
 * A `db` that cannot be used without saying so.
 *
 * Every property access is recorded and returns a thrower, so "no write
 * happened" is proved by the absence of contact rather than by the absence of a
 * row — a distinction that matters because `recordReportView` swallows its own
 * errors. Against an ungated implementation this same object produces the
 * outcome `'skipped'` (the objection read throws and is caught), which is how
 * the test below tells a shut gate apart from a failed write.
 */
function tripwireDb() {
    const touched: string[] = [];
    const db = new Proxy({}, {
        get(_t, prop) {
            const name = String(prop);
            touched.push(name);
            return () => { throw new Error(`db.${name}() called while the counter is disabled`); };
        },
    });
    return { db: db as never, touched };
}

describe('OI #271 — the counter is off by default', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let portalAccess: PortalAccessService;
    let keyring: JwtKeyring;

    beforeAll(async () => {
        const v1 = await genKeypairPem();
        keyring = await buildKeyring({
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1: v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        });
    });

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {}, JWT_SECRET: SECRET };
            c.set('keyringPromise', Promise.resolve(keyring) as never);
            c.set('services', {
                portalAccess,
                inspection: {
                    getReportData: vi.fn().mockResolvedValue({ inspectionId: INSP, sections: [] }),
                    resolveAgentViewToken: vi.fn().mockResolvedValue(null),
                },
                reportVersion: { getLatestPublished: vi.fn().mockResolvedValue(null) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        ensureViewSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(testDb, TENANT);
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
            price: 0, createdAt: new Date(),
        });
        portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
    });

    const issue = () => portalAccess.issueToken({
        tenantId: TENANT, inspectionId: INSP, recipientEmail: 'client@x.com', role: 'client',
    });

    it('the constant itself is false — the shut position is the default, not a deployment choice', () => {
        // The whole point of the gate. If this line ever needs changing, the
        // change that does it is the one that deletes the gate (conditions 4,
        // 5 and 6), not a release that wants the counter early.
        expect(REPORT_VIEW_COUNTING_ENABLED).toBe(false);
    });

    it('recordReportView refuses BEFORE touching the database, for a request it would otherwise count', async () => {
        const signals = {
            accessTokenId: 'tok-1', renderMode: false, ownerPreview: false, method: 'GET',
        };
        // Not a request the human-filter would have dropped anyway: the filter
        // says yes, and the gate overrules it. Without this line the test would
        // pass against a gate that does nothing, because a non-human request
        // writes nothing either.
        expect(shouldCountReportView(signals)).toBe(true);

        const { db, touched } = tripwireDb();
        const outcome = await recordReportView(db, { tenantId: TENANT, inspectionId: INSP }, signals);

        // `'disabled'`, not `'skipped'` — an ungated build reaches the objection
        // read, throws against this db, catches, and reports `'skipped'`.
        expect(outcome).toBe('disabled');
        // Not even a read. The Art. 21 lookup is itself a query about an
        // identified recipient for a purpose the assessment does not yet cover.
        expect(touched).toEqual([]);
    });

    it('rendering the report over a live recipient link writes no report_views row', async () => {
        const token = await issue();
        const res = await buildApp().request(`/api/public/report/acme/${INSP}?token=${token}`);
        expect(res.status).toBe(200);
        expect(await testDb.select().from(schema.reportViews)).toEqual([]);
    });

    it('the Art. 21 objection route stays live while the counter is off', async () => {
        // Deliberately NOT gated with the counter. The suppression marker is the
        // recipient's entry point to a right; with the counter shut there is
        // nothing to suppress, but the route going 404 for a release would mean
        // rebuilding the reasoning when the counter opens — and a recipient who
        // objects early should have that date on record, not be told to come
        // back later.
        const token = await issue();
        const app = buildApp();
        const res = await app.request(
            `/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objected: true }) },
        );
        expect(res.status).toBe(200);
        expect((await testDb.select().from(schema.inspectionAccessTokens))[0].viewTrackingObjectedAt).not.toBeNull();

        const state = await app.request(`/api/public/inspections/${INSP}/view-tracking?token=${token}`);
        expect(await state.json()).toMatchObject({ data: { objected: true } });
    });
});
