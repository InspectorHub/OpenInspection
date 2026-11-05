/**
 * The drawn signatures on the public render pages are shown only to the request that carries a render token minted for that envelope
 * (the sign-completion workflow's own Browser Rendering fetch). Everyone else holding the envelope id gets the same document with a
 * "signature on file" note, and both pages say they are not for caches or search indexes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import agreementsRenderRoutes from '../../../server/api/agreements-render';
import { signAgreementRenderToken, signRenderToken } from '../../../server/lib/render-token';
import { SignCompletionWorkflow } from '../../../server/workflows/sign-completion-workflow';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = '00000000-0000-0000-0000-000000000010';
const REQ = '00000000-0000-0000-0000-000000000100';
const OTHER_REQ = '00000000-0000-0000-0000-000000000101';
const AGR = '00000000-0000-0000-0000-000000000020';
const SECRET = 'render-token-test-secret-0123456789';
const DRAWING = 'data:image/png;base64,aGVsbG8=';
const INSPECTOR_DRAWING = 'data:image/png;base64,d29ybGQ=';

describe('who sees the drawn signatures on the render pages', () => {
    let db: BetterSQLite3Database<typeof schema>;
    const env = () => ({ DB: {} as D1Database, JWT_SECRET: SECRET, APP_BASE_URL: '' });
    const render = (path: string) => agreementsRenderRoutes.request(path, {}, env() as never);

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        } as never);
        await db.insert(schema.agreements).values({ id: AGR, tenantId: TENANT, name: 'Standard', content: 'Body', version: 1, createdAt: new Date() });
        await db.insert(schema.agreementRequests).values({
            id: REQ, tenantId: TENANT, inspectionId: INSP, agreementId: AGR, clientEmail: 'jane@client.test', clientName: 'Jane Doe',
            status: 'signed', signedAt: new Date(), contentSnapshot: 'Body', contentHash: 'h', createdAt: new Date(),
            inspectorSignatureBase64: INSPECTOR_DRAWING, inspectorSignedAt: new Date(),
        } as never);
        await db.insert(schema.agreementSigners).values({
            id: 'sig-1', tenantId: TENANT, requestId: REQ, name: 'Jane Doe', email: 'jane@client.test', role: 'client', status: 'signed',
            signatureBase64: DRAWING, channel: 'remote', signedAt: new Date(), createdAt: new Date(1),
        });
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    const tokenPath = (token: string) => `/agreement-render/acme/${REQ}?render=${encodeURIComponent(token)}`;

    it('with a token minted for this envelope the signer and the inspector drawings are present', async () => {
        const res = await render(tokenPath(await signAgreementRenderToken(REQ, SECRET)));
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).toContain(`<img src="${DRAWING}"`);
        expect(html).toContain(`<img src="${INSPECTOR_DRAWING}"`);
    });

    it('without a token the document is served, with names and times but no drawings and no email address', async () => {
        const res = await render(`/agreement-render/acme/${REQ}`);
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).not.toContain('<img');
        expect(html).not.toContain('aGVsbG8=');
        expect(html).not.toContain('d29ybGQ=');
        expect(html).toContain('[signature on file]');
        expect(html).toContain('Jane Doe');
        expect(html).not.toContain('jane@client.test');
    });

    it.each([
        ['an expired token', async () => signAgreementRenderToken(REQ, SECRET, -1000)],
        ['a tampered token', async () => `${await signAgreementRenderToken(REQ, SECRET)}x`],
        ['a token signed with another secret', async () => signAgreementRenderToken(REQ, 'another-secret-another-secret-12345')],
        ['a token for another envelope', async () => signAgreementRenderToken(OTHER_REQ, SECRET)],
        ['a report token whose subject is the envelope id', async () => signRenderToken(REQ, SECRET)],
        ['garbage', async () => 'not.a.token'],
    ])('%s behaves as no token', async (_name, mint) => {
        const html = await (await render(tokenPath(await mint()))).text();
        expect(html).not.toContain('<img');
        expect(html).toContain('[signature on file]');
    });

    it('both pages say they are not to be cached or indexed', async () => {
        for (const path of [`/agreement-render/acme/${REQ}`, tokenPath(await signAgreementRenderToken(REQ, SECRET)), `/cert-render/${REQ}`]) {
            const res = await render(path);
            expect(res.status, path).toBe(200);
            expect(res.headers.get('cache-control'), path).toBe('no-store');
            expect(res.headers.get('x-robots-tag'), path).toBe('noindex');
        }
    });

    it('every 404 of both pages carries the same no-store and noindex headers', async () => {
        await db.insert(schema.agreementRequests).values({
            id: OTHER_REQ, tenantId: TENANT, inspectionId: INSP, agreementId: AGR, clientEmail: 'x@client.test', clientName: 'X', status: 'sent', createdAt: new Date(),
        } as never);
        for (const path of [
            '/agreement-render/acme/00000000-0000-0000-0000-0000000000ff', `/agreement-render/acme/${OTHER_REQ}`,
            '/cert-render/00000000-0000-0000-0000-0000000000ff', `/cert-render/${OTHER_REQ}`,
        ]) {
            const res = await render(path);
            expect(res.status, path).toBe(404);
            expect(res.headers.get('cache-control'), path).toBe('no-store');
            expect(res.headers.get('x-robots-tag'), path).toBe('noindex');
        }
    });

    it('the render URL the sign-completion workflow fetches carries a token that opens the drawings', async () => {
        const fetched: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(url); return new Response('<html></html>', { status: 200 }); }));
        const quickAction = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer }));
        const workflowEnv = { DB: {} as D1Database, JWT_SECRET: SECRET, APP_BASE_URL: 'https://app.example', PHOTOS: { put: vi.fn(async () => undefined) }, BROWSER: { quickAction } };
        const workflow = new SignCompletionWorkflow({} as never, workflowEnv as never);
        const stop = new Error('stop after the renders');
        const step = {
            sleep: async () => undefined,
            do: async (name: string, a: unknown, b?: () => Promise<unknown>) => {
                if (name === 'build-evidence-pack') throw stop;
                return (typeof a === 'function' ? a : b!)();
            },
        };
        await expect(workflow.run({ payload: { requestId: REQ, tenantId: TENANT, tenantSlug: 'acme' } } as never, step as never)).rejects.toBe(stop);
        const agreementUrl = fetched.find((u) => u.includes('/m2m/agreement-render/'));
        expect(agreementUrl).toBeTruthy();
        const html = await (await render(new URL(agreementUrl!).pathname.replace(/^\/m2m/, '') + new URL(agreementUrl!).search)).text();
        expect(html).toContain(`<img src="${DRAWING}"`);
        // The certificate has no drawings to gate, so its URL needs no token.
        expect(fetched.some((u) => u.includes('/m2m/cert-render/'))).toBe(true);
    });
});
