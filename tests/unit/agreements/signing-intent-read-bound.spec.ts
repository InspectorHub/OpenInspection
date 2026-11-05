/**
 * The signing-intent check reads a signer's own presentation rows, newest first and a fixed number, not the whole audit trail of the
 * envelope. Presentation rows are appended on every view of the signing page, so the full set grows with every reload by anyone holding
 * a link; reading it all on every sign attempt made each attempt cost more than the last.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { AgreementService } from '../../../server/services/agreement.service';
import { createHarness, TENANT_ID, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';
import { watchDb } from '../helpers/verify-export-kit';

const INSPECTION_ID = '44444444-0000-4000-8000-000000000a01';
const AGREEMENT_ID = '44444444-0000-4000-8000-000000000b01';
const SIG = 'data:image/png;base64,aGVsbG8=';

describe('the signing-intent read', () => {
    let h: Harness;
    let caseyToken: string;
    let drewToken: string;

    const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'intent-read' });
        const res = await app.request(path, init, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const sign = (token: string) => call(`/api/public/agreements/${token}/sign`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatureBase64: SIG }),
    });

    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '12 Lighthouse Road', date: '2026-06-01', status: 'requested',
            paymentStatus: 'unpaid', price: 0, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        } as never);
        await h.db.insert(schema.agreements).values({ id: AGREEMENT_ID, tenantId: TENANT_ID, name: 'Standard Agreement', content: 'Text', version: 1, createdAt: new Date() });
        const agreements = new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
        await agreements.findOrCreate(TENANT_ID, INSPECTION_ID, {
            signers: [{ name: 'Casey Client', email: 'casey@client.test', role: 'client' }, { name: 'Drew Client', email: 'drew@client.test', role: 'co_client' }],
            completionPolicy: 'all',
        });
        caseyToken = (await agreements.getSignerLinkByEmail(TENANT_ID, INSPECTION_ID, 'casey@client.test'))!;
        drewToken = (await agreements.getSignerLinkByEmail(TENANT_ID, INSPECTION_ID, 'drew@client.test'))!;
    });
    afterEach(() => h.close());

    it('asks the store for presentation rows of the signer, newest first, with a limit, and a co-signer reloading the page cannot block the signer', async () => {
        expect((await call(`/api/public/agreements/${caseyToken}`)).status).toBe(200);
        // The co-signer reloads the page many times: each view appends a presentation row to the same envelope.
        for (let i = 0; i < 60; i++) expect((await call(`/api/public/agreements/${drewToken}`)).status).toBe(200);
        const watch = watchDb(h);
        const res = await sign(caseyToken);
        watch.restore();
        expect(res.status).toBe(200);
        const read = watch.log.find((q) => /from "esign_audit_logs"/i.test(q) && /order by/i.test(q) && /"event"\s*=\s*\?/i.test(q));
        expect(read, watch.log.filter((q) => q.includes('esign_audit_logs')).join('\n')).toBeTruthy();
        expect(read).toMatch(/limit \?/i);
        expect(read).toMatch(/like \?/i);
    }, 120_000);

    it('control: a signer who was never presented the agreement is still refused', async () => {
        const res = await sign(drewToken);
        expect(res.status).toBe(400);
    });
});
