/**
 * The drawn signature a signer submits is stored and hashed, so it has a ceiling (the same 500,000 characters the other signature doors
 * already have). Over it, the public signing door and the in-person door refuse at validation and store nothing; at the ceiling the request
 * is not refused for its size.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { AgreementService } from '../../../server/services/agreement.service';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import inPersonSignRoutes from '../../../server/api/inspections/agreement-sign';
import { createHarness, TENANT_ID, TENANT_SLUG, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';

const INSPECTION_ID = '55555555-0000-4000-8000-000000000d01';
const AGREEMENT_ID = '55555555-0000-4000-8000-000000000e01';

describe('signature size', () => {
    let h: Harness;
    let signerToken: string;

    const sign = async (signatureBase64: string): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'signature-size' });
        const res = await app.request(`/api/public/agreements/${signerToken}/sign`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatureBase64 }),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const stored = async () => (await h.db.select({ s: schema.agreementSigners.signatureBase64 }).from(schema.agreementSigners)
        .where(eq(schema.agreementSigners.email, 'casey@client.test')).get())?.s ?? null;

    beforeEach(async () => {
        h = await createHarness('standalone');
        const now = new Date();
        await h.db.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '12 Lighthouse Road', date: '2026-06-01', status: 'requested',
            paymentStatus: 'unpaid', price: 0, agreementRequired: true, paymentRequired: false, createdAt: now,
        } as never);
        await h.db.insert(schema.agreements).values({ id: AGREEMENT_ID, tenantId: TENANT_ID, name: 'Standard Agreement', content: 'Text', version: 1, createdAt: now });
        const agreements = new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
        await agreements.findOrCreate(TENANT_ID, INSPECTION_ID, { signers: [{ name: 'Casey Client', email: 'casey@client.test', role: 'client' }], completionPolicy: 'one' });
        signerToken = (await agreements.getSignerLinkByEmail(TENANT_ID, INSPECTION_ID, 'casey@client.test'))!;
        void TENANT_SLUG;
    });
    afterEach(() => h.close());

    /** The signer opens the page first, so the presentation is on record: a refusal below is then about the signature and nothing else. */
    const present = async (): Promise<void> => {
        const exec = makeExecutionContext({ label: 'signature-size-view' });
        expect((await app.request(`/api/public/agreements/${signerToken}`, {}, h.env, exec.ctx)).status).toBe(200);
        await exec.settle();
    };

    it('refuses a signature over the ceiling at validation and stores nothing', async () => {
        await present();
        const res = await sign('A'.repeat(500_001));
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toContain('VALIDATION_ERROR');
        expect(await stored()).toBeNull();
        // Control: the same signer with a signature inside the ceiling signs, so the refusal above was the size.
        expect((await sign('A'.repeat(1000))).status).toBe(200);
        expect(await stored()).not.toBeNull();
    });

    it('does not refuse one exactly at the ceiling for its size (it may be refused for another reason, never validation)', async () => {
        await present();
        const res = await sign('A'.repeat(500_000));
        const body = await res.clone().text();
        expect(body).not.toMatch(/too_big|Too big|exceeds|maximum/i);
        expect(res.status).not.toBe(413);
    });

    describe('the in-person signing door', () => {
        // The route is mounted bare with the company set, as the session would: the handler's own body check answers 400 for a body that
        // is too large, and a body within the ceiling goes past it (and fails later for want of services, never with a 400).
        const post = async (signatureBase64: string, signerId = 'x'): Promise<Response> => {
            const bare = new OpenAPIHono<HonoConfig>();
            bare.onError((_err, c) => c.json({ error: 'past the body check' }, 500));
            bare.use('*', async (c, next) => { c.set('tenantId', TENANT_ID); c.set('userRole', 'owner'); c.set('user', { sub: INSPECTOR_ID, role: 'owner', tenantId: TENANT_ID } as never); c.set('services', { agreement: {} } as never); await next(); });
            bare.route('/api/inspections', inPersonSignRoutes);
            return bare.request(`/api/inspections/${INSPECTION_ID}/sign`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatureBase64, signerId }),
            }, h.env, makeExecutionContext({ label: 'in-person-size' }).ctx);
        };

        it('refuses a signature over the ceiling, and a signer id that is far too long', async () => {
            expect((await post('A'.repeat(500_001))).status).toBe(400);
            expect((await post('A'.repeat(100), 'x'.repeat(101))).status).toBe(400);
        });

        it('control: a signature exactly at the ceiling is not refused for its size', async () => {
            expect((await post('A'.repeat(500_000))).status).not.toBe(400);
        });
    });
});
