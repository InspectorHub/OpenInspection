// tests/unit/report-access-gate.spec.ts
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { publicReportAccessAllowed, shouldPinLatestPublished } from '../../../server/lib/report-access';

describe('publicReportAccessAllowed', () => {
  it('client token: allowed only when published', () => {
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: 'published' })).toBe(true);
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: 'in_progress' })).toBe(false);
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: 'submitted' })).toBe(false);
  });
  it('render mode bypasses (drafts must render headless)', () => {
    expect(publicReportAccessAllowed({ renderMode: true, ownerPreview: false, reportStatus: 'in_progress' })).toBe(true);
  });
  it('owner preview bypasses', () => {
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: true, reportStatus: 'in_progress' })).toBe(true);
  });
});

/**
 * Integration gate tests for GET /api/public/report/:tenant/:id.
 *
 * The publish gate runs a RAW drizzle() query against the inspection row, so we
 * mock drizzle('drizzle-orm/d1') to return a REAL seeded in-memory DB while
 * stubbing the service layer (portalAccess.resolveToken / inspection.getReportData).
 * Client/token access must be revoked (403 NOT_PUBLISHED) while the report is not
 * published; owner-preview and render-token paths bypass.
 */
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import publicReportRoutes from '../../../server/api/public-report';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { buildKeyring, signJwt, type JwtKeyring } from '../../../server/lib/jwt-keyring';

const TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const INSP_ID = '00000000-0000-0000-0000-0000000000b1';

// --- ES256 P-256 keypair helpers (copied from owner-preview-access.spec.ts) ---
interface Pem { privatePem: string; publicPem: string }
function bufToPem(buf: ArrayBuffer, label: string): string {
    const bin = String.fromCharCode(...new Uint8Array(buf));
    const b64 = btoa(bin);
    const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
    return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}
async function genKeypair(): Promise<Pem> {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair;
    return {
        privatePem: bufToPem(await crypto.subtle.exportKey('pkcs8', privateKey), 'PRIVATE KEY'),
        publicPem:  bufToPem(await crypto.subtle.exportKey('spki',  publicKey),  'PUBLIC KEY'),
    };
}

describe('GET /api/public/report/:tenant/:id — publish gate', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let keyring: JwtKeyring;

    beforeAll(async () => {
        const v1 = await genKeypair();
        keyring = await buildKeyring({
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        });
    });

    async function seedInspection(reportStatus: string) {
        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'completed',
            reportStatus, paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as any);
    }

    function buildApp(opts: { withKeyring?: boolean } = {}) {
        const resolveToken = vi.fn().mockResolvedValue({
            inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'client',
            recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null,
        });
        const getReportData = vi.fn().mockResolvedValue({ inspectionId: INSP_ID });
        const resolveAgentViewToken = vi.fn().mockResolvedValue(null);
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            // The gate runs drizzle(c.env.DB); the drizzle mock ignores its arg and
            // returns the seeded db, but c.env.DB must be a defined property.
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} };
            c.set('services', {
                portalAccess: { resolveToken },
                inspection: { getReportData, resolveAgentViewToken },
                // Option A resolves the latest published version on the recipient
                // track. `null` = no version row, which keeps these cases about
                // the PUBLISH GATE rather than about snapshot selection.
                reportVersion: { getLatestPublished: vi.fn().mockResolvedValue(null) },
            } as unknown as HonoConfig['Variables']['services']);
            if (opts.withKeyring) c.set('keyringPromise', Promise.resolve(keyring));
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getReportData };
    }

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    it('403 NOT_PUBLISHED for a client token when report_status=in_progress', async () => {
        await seedInspection('in_progress');
        const { app, getReportData } = buildApp();
        const res = await app.request(`/api/public/report/acme/${INSP_ID}?token=tok`);
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
        expect(getReportData).not.toHaveBeenCalled();
    });

    it('200 for a client token when report_status=published', async () => {
        await seedInspection('published');
        const { app, getReportData } = buildApp();
        const res = await app.request(`/api/public/report/acme/${INSP_ID}?token=tok`);
        expect(res.status).toBe(200);
        // 5th arg: `undefined` HERE because this harness seeds no version row —
        // not because a recipient read is meant to be live. Option A pins that
        // read to the latest published version; public-report-endpoint.spec.ts
        // owns that assertion.
        expect(getReportData).toHaveBeenCalledWith(INSP_ID, TENANT_ID, expect.any(Function), expect.any(Object), undefined);
    });

    it('owner-preview bypasses the gate (200 even when report_status=in_progress)', async () => {
        await seedInspection('in_progress');
        const { app, getReportData } = buildApp({ withKeyring: true });
        const ownerJwt = await signJwt(
            { sub: 'u1', 'custom:userRole': 'admin', 'custom:tenantId': TENANT_ID },
            keyring,
        );
        // No token query param → falls through to the owner-preview path.
        const res = await app.request(`/api/public/report/acme/${INSP_ID}`, {
            headers: { Authorization: `Bearer ${ownerJwt}` },
        });
        expect(res.status).toBe(200);
        expect(getReportData).toHaveBeenCalledWith(INSP_ID, TENANT_ID, expect.any(Function), expect.any(Object),
            // 5th arg: the pinned version. `undefined` on every path that is not
            // materialising a specific published version — asserted rather than
            // omitted, because a NUMBER leaking in here would mean an ordinary
            // client read was being served a frozen snapshot.
            undefined);
    });
});

describe('GET /api/public/report/:tenant/:id/photo — publish gate', () => {
    const T = '00000000-0000-0000-0000-0000000000a3';
    const ID = '00000000-0000-0000-0000-0000000000b3';

    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        // Seed tenant + inspection with report_status='in_progress'
        await db.insert(schema.tenants).values({
            id: T, name: 'Photo', slug: 'photo', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: ID, tenantId: T, propertyAddress: '3 Main St', clientName: 'Alice',
            clientEmail: 'alice@test.com', date: '2026-06-01', status: 'completed',
            reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 20000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    it('404 for a client token when report_status=in_progress (gate fires before PHOTOS check)', async () => {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            // PHOTOS is intentionally absent — the gate must fire before the PHOTOS check
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} } as any;
            c.set('services', {
                portalAccess: { resolveToken: vi.fn().mockResolvedValue({
                    inspectionId: ID, tenantId: T, role: 'client',
                    recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null,
                }) },
                inspection: { resolveAgentViewToken: vi.fn().mockResolvedValue(null) },
            } as any);
            await next();
        });
        app.route('/api/public', publicReportRoutes);

        const key = encodeURIComponent(`${T}/${ID}/x.jpg`);
        const res = await app.request(`/api/public/report/photo/${ID}/photo?key=${key}&token=tok`);
        expect([403, 404]).toContain(res.status);
    });
});

describe('GET /api/public/report/:tenant/:id/pdf — publish gate', () => {
    const T = '00000000-0000-0000-0000-0000000000a2';
    const ID = '00000000-0000-0000-0000-0000000000b2';

    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        // Seed tenant + inspection with report_status='in_progress'
        await db.insert(schema.tenants).values({
            id: T, name: 'Demo', slug: 'demo', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: ID, tenantId: T, propertyAddress: '2 Main St', clientName: 'Bob',
            clientEmail: 'bob@test.com', date: '2026-06-01', status: 'completed',
            reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 30000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    it('403 NOT_PUBLISHED when report_status=in_progress (pure client endpoint)', async () => {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.env = { DB: {}, BROWSER: {}, PHOTOS: {} } as any; // BROWSER+PHOTOS must be truthy to pass the 503 guard
            c.set('services', {
                portalAccess: { resolveToken: vi.fn().mockResolvedValue({ inspectionId: ID, tenantId: T, role: 'client', recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null }) },
                inspection: { resolveAgentViewToken: vi.fn().mockResolvedValue(null) },
            } as any);
            await next();
        });
        app.route('/api/public', publicReportRoutes);

        const res = await app.request(`/api/public/report/demo/${ID}/pdf?token=tok&type=full`);
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });
});

describe('GET /api/public/verify/report/:token — reflects current publish status', () => {
    const T = '00000000-0000-0000-0000-0000000000a4';
    const ID = '00000000-0000-0000-0000-0000000000b4';

    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        // Seed tenant + inspection with report_status='in_progress' (unpublished).
        await db.insert(schema.tenants).values({
            id: T, name: 'Verify', slug: 'verify', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: ID, tenantId: T, propertyAddress: '4 Main St', clientName: 'Carol',
            clientEmail: 'carol@test.com', date: '2026-06-01', status: 'completed',
            reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 40000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    function buildVerifyApp() {
        const verifyByToken = vi.fn().mockResolvedValue({
            inspectionId: ID, versionNumber: 1, isAmendment: false, publishedAt: 1000,
            contentHash: 'h', keyFingerprint: 'f', legacy: false,
            hashValid: true, signatureValid: true, chainValid: true,
        });
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} };
            c.set('services', { reportVersion: { verifyByToken } } as any);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    it('Case A — verify returns notPublished:true when report_status=in_progress', async () => {
        const app = buildVerifyApp();
        const res = await app.request('/api/public/verify/report/sometoken');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { notPublished: boolean } };
        expect(body.data.notPublished).toBe(true);
    });

    it('Case B — frozen PDF blocked (403) for an unpublished report', async () => {
        // ALSO seed the report_versions row keyed by verificationToken so the
        // raw versionRow lookup resolves; the publish gate then fires.
        await db.insert(schema.reportVersions).values({
            id: 'rv1', tenantId: T, inspectionId: ID, versionNumber: 1,
            snapshotJson: '{}', contentHash: 'h', verificationToken: 'vtok',
            publishedAt: new Date(1000), publishedBy: 'u1', createdAt: new Date(),
        } as any);

        const app = buildVerifyApp();
        const res = await app.request('/api/public/verify/report/vtok/pdf');
        expect([403, 404]).toContain(res.status);
        expect(res.status).toBe(403);
    });
});

/**
 * Which reads get the FROZEN snapshot (option A).
 *
 * The routing decision, isolated from the endpoint. It is deliberately not the
 * same shape as the access gate above: that one lets render-token and owner
 * traffic THROUGH, this one keeps both on live data, for two different reasons.
 */
describe('shouldPinLatestPublished', () => {
    it('pins the recipient track — the read that must not change after delivery', () => {
        expect(shouldPinLatestPublished({ renderMode: false, ownerPreview: false, tokenPinnedVersion: undefined })).toBe(true);
    });

    it('leaves OWNER PREVIEW live, so the author can see unpublished edits', () => {
        // Pinning here would make the preview show the last published state and
        // silently hide everything typed since — on the surface whose only job
        // is showing work in progress.
        expect(shouldPinLatestPublished({ renderMode: false, ownerPreview: true, tokenPinnedVersion: undefined })).toBe(false);
    });

    it('never overrides a version the render token already named', () => {
        // The verify page materialises ONE specific version. Replacing it with
        // "the latest" would hand back a different document than the hash the
        // verifier is checking against.
        expect(shouldPinLatestPublished({ renderMode: true, ownerPreview: false, tokenPinnedVersion: 2 })).toBe(false);
        expect(shouldPinLatestPublished({ renderMode: true, ownerPreview: false, tokenPinnedVersion: undefined })).toBe(false);
    });

    it('a token version wins even if the caller looks like a recipient', () => {
        expect(shouldPinLatestPublished({ renderMode: false, ownerPreview: false, tokenPinnedVersion: 1 })).toBe(false);
    });
});
