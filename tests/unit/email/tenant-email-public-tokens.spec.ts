/**
 * Token-authenticated public sends speak for the TENANT, in both modes.
 *
 * Both routes below are reached with nothing but a token in the URL: the
 * remote agreement signature (`POST /api/public/agreements/{token}/sign`) and
 * the repair-list share email (`POST /api/public/repair-request/share/{token}/email`).
 * The token names the tenant, and the handler learns it — after the DI
 * middleware has already run. Every email those handlers send must still carry
 * the tenant's sender name, Reply-To and brand, and be metered to it.
 *
 * Driven through the real app and middleware chain; only the provider's HTTP
 * call is intercepted (see helpers/tenant-email-harness.ts).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { AgreementService } from '../../../server/services/agreement.service';
import { RepairRequestService } from '../../../server/services/repair-request.service';
import {
    createHarness, observeIdentity, INSPECTOR_ID, TENANT_ID, TENANT_VOICE,
    type Harness, type HarnessMode,
} from '../helpers/tenant-email-harness';

const INSPECTION_ID = '33333333-0000-4000-8000-000000000001';
const AGREEMENT_ID = '33333333-0000-4000-8000-000000000002';
const SIGNATURE = 'data:image/png;base64,aGVsbG8=';

async function seedInspection(h: Harness, reportStatus: 'in_progress' | 'published', agreementRequired: boolean): Promise<void> {
    await h.db.insert(schema.inspections).values({
        id: INSPECTION_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID,
        propertyAddress: '12 Lighthouse Road', date: '2026-06-01', status: 'requested',
        paymentStatus: 'unpaid', price: 0, agreementRequired, paymentRequired: false,
        reportStatus, createdAt: new Date(),
    });
}

function post(body: Record<string, unknown>): RequestInit {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe.each<HarnessMode>(['saas', 'standalone'])('token-authenticated public sends (%s)', (mode) => {
    let h: Harness;
    afterEach(() => h.close());

    it('agreement signature: the per-signer receipt AND the completion confirmation use the tenant identity', { timeout: 60_000 }, async () => {
        h = await createHarness(mode);
        await seedInspection(h, 'in_progress', true);
        await h.db.insert(schema.agreements).values({
            id: AGREEMENT_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'Agreement text', version: 1, createdAt: new Date(),
        });
        const svc = new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
        const envelope = await svc.findOrCreate(TENANT_ID, INSPECTION_ID, {
            signers: [
                { name: 'Casey Client', email: 'casey@client.test', role: 'client' },
                { name: 'Cory Coclient', email: 'cory@client.test', role: 'co_client' },
            ],
            completionPolicy: 'all',
        });
        const signers = await h.db.select().from(schema.agreementSigners).all();
        const second = signers.find((s) => s.email === 'cory@client.test');
        const tokenTwo = await svc.getSignerLink(TENANT_ID, envelope.requestId, second!.id);

        for (const token of [envelope.token, tokenTwo]) {
            const view = makeExecutionContext({ label: `present-${mode}` });
            const presented = await app.request(`/api/public/agreements/${token}`, {}, h.env, view.ctx);
            expect(presented.status, await presented.clone().text()).toBe(200);
            await view.settle();
            const exec = makeExecutionContext({ label: `sign-${mode}` });
            const signed = await app.request(`/api/public/agreements/${token}/sign`, post({ signatureBase64: SIGNATURE }), h.env, exec.ctx);
            expect(signed.status, await signed.clone().text()).toBe(200);
            await exec.settle();
        }

        // First signature: a receipt to signer one. Second signature completes
        // the envelope: the completion confirmation to the client, and a
        // receipt to signer two (each CCs the inspector). Three sends, every
        // one in the tenant's voice.
        expect(h.sent.map((m) => m.to[0]).sort()).toEqual(
            ['casey@client.test', 'casey@client.test', 'cory@client.test'],
        );
        for (const mail of h.sent) {
            expect(observeIdentity(h, mail)).toEqual(TENANT_VOICE);
        }
    });

    it('repair-list share email uses the tenant identity of the share token', { timeout: 60_000 }, async () => {
        h = await createHarness(mode);
        // Published and not held back: no agreement or payment stands in front of it.
        await seedInspection(h, 'published', false);
        const request = await new RepairRequestService(h.env.DB)
            .create(TENANT_ID, INSPECTION_ID, { kind: 'client', ref: 'casey@client.test' });

        const exec = makeExecutionContext({ label: `share-${mode}` });
        const res = await app.request(
            `/api/public/repair-request/share/${request.shareToken}/email`,
            post({ to: 'contractor@trade.test', message: 'Please quote these items.' }),
            h.env, exec.ctx,
        );
        expect(res.status, await res.clone().text()).toBe(200);
        await exec.settle();

        const share = h.sent.find((m) => m.to.includes('contractor@trade.test'));
        expect(observeIdentity(h, share)).toEqual(TENANT_VOICE);
    });
});

describe('token-authenticated public sends from a company that signed up an hour ago (saas)', () => {
    let h: Harness;
    afterEach(() => h.close());

    it('the signature confirmation reaches the signer: the window does not hold what the recipient just triggered', { timeout: 60_000 }, async () => {
        h = await createHarness('saas', { tenantAgeMs: 60 * 60 * 1000 });
        await seedInspection(h, 'in_progress', true);
        await h.db.insert(schema.agreements).values({
            id: AGREEMENT_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'Agreement text', version: 1, createdAt: new Date(),
        });
        const svc = new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
        const envelope = await svc.findOrCreate(TENANT_ID, INSPECTION_ID, {
            signers: [{ name: 'Casey Client', email: 'casey@client.test', role: 'client' }],
            completionPolicy: 'all',
        });

        const view = makeExecutionContext({ label: 'present-first-day' });
        const presented = await app.request(`/api/public/agreements/${envelope.token}`, {}, h.env, view.ctx);
        expect(presented.status, await presented.clone().text()).toBe(200);
        await view.settle();
        const exec = makeExecutionContext({ label: 'sign-first-day' });
        const signed = await app.request(`/api/public/agreements/${envelope.token}/sign`, post({ signatureBase64: SIGNATURE }), h.env, exec.ctx);
        expect(signed.status, await signed.clone().text()).toBe(200);
        await exec.settle();

        const toSigner = h.sent.filter((m) => m.to.includes('casey@client.test'));
        expect(toSigner.length, 'no confirmation reached the signer').toBeGreaterThan(0);
        for (const mail of toSigner) {
            expect(observeIdentity(h, mail)).toEqual(TENANT_VOICE);
        }
    });

    it('control: a share email to an address the company chose is still held in the first 24 hours', { timeout: 60_000 }, async () => {
        h = await createHarness('saas', { tenantAgeMs: 60 * 60 * 1000 });
        await seedInspection(h, 'published', false);
        const request = await new RepairRequestService(h.env.DB)
            .create(TENANT_ID, INSPECTION_ID, { kind: 'client', ref: 'casey@client.test' });

        const exec = makeExecutionContext({ label: 'share-first-day' });
        await app.request(
            `/api/public/repair-request/share/${request.shareToken}/email`,
            post({ to: 'contractor@trade.test', message: 'Please quote these items.' }),
            h.env, exec.ctx,
        );
        await exec.settle();

        expect(h.sent.find((m) => m.to.includes('contractor@trade.test'))).toBeUndefined();
    });
});
