/**
 * The public signing door and the audit chain it writes to (C3, C13, C14):
 *   - a signer who has already signed, or who declined, adds no `signer.signed` row on a repeat;
 *   - a signature is REFUSED (and nothing is stored, the state does not advance) when its audit row cannot be written;
 *   - reloading the signing page does not append a presentation row each time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { AgreementService } from '../../../server/services/agreement.service';
import { createHarness, TENANT_ID, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';
import { watchDb } from '../helpers/verify-export-kit';
import { logger } from '../../../server/lib/logger';

const INSPECTION_ID = '66666666-0000-4000-8000-000000000a01';
const AGREEMENT_ID = '66666666-0000-4000-8000-000000000b01';
const SIG = 'data:image/png;base64,aGVsbG8=';
const SIG_B = 'data:image/png;base64,d29ybGQ=';

/** The hash the chain records for a drawing: SHA-256 of the image bytes, as the signing routes compute it. */
async function imageHash(dataUrl: string): Promise<string> {
    const bytes = Uint8Array.from(atob(dataUrl.replace(/^data:image\/[a-z]+;base64,/, '')), (ch) => ch.charCodeAt(0));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return 'sha256:' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the signing door and the audit chain', () => {
    let h: Harness;
    let caseyToken: string;
    let drewToken: string;

    const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'signing-chain' });
        const res = await app.request(path, init, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const view = (token: string) => call(`/api/public/agreements/${token}`);
    const sign = (token: string, image = SIG) => call(`/api/public/agreements/${token}/sign`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatureBase64: image }),
    });
    const decline = (token: string) => call(`/api/public/agreements/${token}/decline`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'not now' }),
    });
    const eventRows = async (event: string) => h.db.select().from(schema.esignAuditLogs)
        .where(and(eq(schema.esignAuditLogs.tenantId, TENANT_ID), eq(schema.esignAuditLogs.event, event as 'signer.signed'))).all();
    const signerRow = (email: string) => h.db.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.email, email)).get();

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

    it('C3: a repeat sign by a signer who already signed records nothing more', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        expect((await sign(caseyToken)).status).toBe(200);
        expect(await eventRows('signer.signed')).toHaveLength(1);
        expect((await sign(caseyToken)).status).toBe(200);
        expect((await sign(caseyToken)).status).toBe(200);
        expect(await eventRows('signer.signed')).toHaveLength(1);
        // Control: the other signer still signs and gets a row of their own.
        expect((await view(drewToken)).status).toBe(200);
        expect((await sign(drewToken)).status).toBe(200);
        expect(await eventRows('signer.signed')).toHaveLength(2);
    });

    it('C3: a signer who declined cannot sign, and no signed event is recorded for them', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        expect((await decline(caseyToken)).status).toBe(200);
        const res = await sign(caseyToken);
        expect(res.status).toBe(409);
        expect(await eventRows('signer.signed')).toHaveLength(0);
        expect((await signerRow('casey@client.test'))?.status).toBe('declined');
    });

    it('C14: when the audit row cannot be written the signature is refused, nothing is stored, and the signer can retry', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        const watch = watchDb(h, 'into "esign_audit_logs"');
        const refused = await sign(caseyToken);
        watch.restore();
        expect(refused.status).toBe(503);
        expect(JSON.stringify(await refused.json())).toMatch(/try again/i);
        const row = await signerRow('casey@client.test');
        expect(row?.status).not.toBe('signed');
        expect(row?.signatureBase64 ?? null).toBeNull();
        expect(await eventRows('signer.signed')).toHaveLength(0);
        // The retry goes through once the record can be written.
        expect((await sign(caseyToken)).status).toBe(200);
        expect((await signerRow('casey@client.test'))?.status).toBe('signed');
        expect(await eventRows('signer.signed')).toHaveLength(1);
    });

    it('C13: reloading the signing page adds no presentation row; a different signer does', async () => {
        for (let i = 0; i < 6; i++) expect((await view(caseyToken)).status).toBe(200);
        expect(await eventRows('signer.presented')).toHaveLength(1);
        expect((await view(drewToken)).status).toBe(200);
        expect(await eventRows('signer.presented')).toHaveLength(2);
    });

    /** The `signatureImageHash` named by the newest `signer.signed` row of a signer (by the chain's own order). */
    const newestSignedImage = async (signerId: string): Promise<string | null | undefined> => {
        const rows = (await eventRows('signer.signed'))
            .map((r) => ({ ...r, payload: JSON.parse(r.payloadJson) as { signerId: string; signatureImageHash: string | null } }))
            .filter((r) => r.payload.signerId === signerId);
        return rows.length === 0 ? undefined : rows[rows.length - 1]!.payload.signatureImageHash;
    };

    it('the chain names the drawing that was stored: a failed first attempt, then a retry with another drawing', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        const watch = watchDb(h, 'into "esign_audit_logs"');
        expect((await sign(caseyToken, SIG)).status).toBe(503);
        watch.restore();
        // Nothing of the failed attempt is kept, so the retry is a fresh signing.
        expect((await signerRow('casey@client.test'))?.signatureBase64 ?? null).toBeNull();
        expect((await sign(caseyToken, SIG_B)).status).toBe(200);
        const row = await signerRow('casey@client.test');
        expect(row?.signatureBase64).toBe(SIG_B);
        expect(await newestSignedImage(row!.id)).toBe(await imageHash(SIG_B));
        expect(await eventRows('signer.signed')).toHaveLength(1);
    });

    it('a failure of the claim itself, then a retry with another drawing: the stored drawing is the one the chain names', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        const watch = watchDb(h, 'update "agreement_signers"');
        const failed = await sign(caseyToken, SIG);
        watch.restore();
        expect(failed.status).toBeGreaterThanOrEqual(500);
        expect((await sign(caseyToken, SIG_B)).status).toBe(200);
        const row = await signerRow('casey@client.test');
        expect(row?.signatureBase64).toBe(SIG_B);
        expect(await newestSignedImage(row!.id)).toBe(await imageHash(SIG_B));
    });

    it('two requests for one signer with different drawings: one is stored, one row, and it names the stored drawing', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        const [a, b] = await Promise.all([sign(caseyToken, SIG), sign(caseyToken, SIG_B)]);
        // The loser is told to retry (409, a signing in flight) or, if the winner had already confirmed, that it is signed (200).
        expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
        expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
        const row = await signerRow('casey@client.test');
        expect([SIG, SIG_B]).toContain(row?.signatureBase64);
        expect(await eventRows('signer.signed')).toHaveLength(1);
        expect(await newestSignedImage(row!.id)).toBe(await imageHash(row!.signatureBase64!));
    });

    it('a signature and a decline for one signer at the same moment: one wins, and the chain shows only the winner', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        const [signed, declined] = await Promise.all([sign(caseyToken), decline(caseyToken)]);
        const row = await signerRow('casey@client.test');
        const signedRows = await eventRows('signer.signed');
        const declinedRows = await eventRows('signer.declined');
        if (row?.status === 'signed') {
            expect(signed.status).toBe(200);
            expect(declined.status).toBe(409);
            expect(signedRows).toHaveLength(1);
            expect(declinedRows).toHaveLength(0);
        } else {
            expect(row?.status).toBe('declined');
            expect(declined.status).toBe(200);
            expect(signed.status).toBe(409);
            expect(declinedRows).toHaveLength(1);
            expect(signedRows).toHaveLength(0);
        }
    });

    it('two requests while the audit row of the winner cannot be written: the loser never gets 200, and nothing ends up signed', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        const watch = watchDb(h, 'into "esign_audit_logs"');
        const [a, b] = await Promise.all([sign(caseyToken, SIG), sign(caseyToken, SIG_B)]);
        watch.restore();
        expect([a.status, b.status].every((s) => s === 409 || s === 503)).toBe(true);
        expect([a.status, b.status]).toContain(503);
        const row = await signerRow('casey@client.test');
        expect(row?.status).not.toBe('signed');
        expect(row?.status).not.toBe('signing');
        expect(await eventRows('signer.signed')).toHaveLength(0);
    });

    it('a signing in flight is not a signature: the page shows the signer as viewed with nothing signed, and a second sign or a decline gets 409 and writes nothing', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        await h.db.update(schema.agreementSigners).set({ status: 'signing', signatureBase64: SIG, signedAt: new Date() }).where(eq(schema.agreementSigners.email, 'casey@client.test'));
        const page = await (await view(caseyToken)).json() as { data: { signer: { status: string }; progress: { signed: number } } };
        expect(page.data.signer.status).toBe('viewed');
        expect(page.data.progress.signed).toBe(0);
        const watch = watchDb(h);
        const second = await sign(caseyToken, SIG_B);
        const declined = await decline(caseyToken);
        const writes = watch.writes();
        watch.restore();
        expect(second.status).toBe(409);
        expect(JSON.stringify(await second.json())).toMatch(/try again in a moment/i);
        expect(declined.status).toBe(409);
        expect(writes.filter((q) => /agreement_signers|esign_audit_logs/.test(q))).toEqual([]);
        expect((await signerRow('casey@client.test'))?.signatureBase64).toBe(SIG);
        expect(await eventRows('signer.signed')).toHaveLength(0);
    });

    it('a signing that died is taken over after the stale window: the new drawing is stored and the chain names it', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        await h.db.update(schema.agreementSigners).set({ status: 'signing', signatureBase64: SIG, signedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.agreementSigners.email, 'casey@client.test'));
        expect((await sign(caseyToken, SIG_B)).status).toBe(200);
        const row = await signerRow('casey@client.test');
        expect(row?.status).toBe('signed');
        expect(row?.signatureBase64).toBe(SIG_B);
        expect(await newestSignedImage(row!.id)).toBe(await imageHash(SIG_B));
    });

    it('a failure after the signing was confirmed leaves the envelope open; a retry completes it exactly once and a second retry does nothing', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        expect((await view(drewToken)).status).toBe(200);
        expect((await sign(drewToken)).status).toBe(200);
        const completions = async () => (await eventRows('agreement.signed')).length;
        const envelope = () => h.db.select().from(schema.agreementRequests).get();
        // Casey's signing is claimed, recorded and confirmed; rolling the envelope forward then fails.
        const watch = watchDb(h, 'update "agreement_requests"');
        const failed = await sign(caseyToken);
        watch.restore();
        expect(failed.status).toBeGreaterThanOrEqual(500);
        expect((await signerRow('casey@client.test'))?.status).toBe('signed');
        expect((await envelope())?.status).not.toBe('signed');
        expect(await completions()).toBe(0);
        expect(await eventRows('signer.signed')).toHaveLength(2);
        // The retry sees a confirmed signer, re-runs the roll-forward and completes the envelope once.
        expect((await sign(caseyToken)).status).toBe(200);
        expect((await envelope())?.status).toBe('signed');
        expect(await completions()).toBe(1);
        expect((await sign(caseyToken)).status).toBe(200);
        expect(await completions()).toBe(1);
        expect(await eventRows('signer.signed')).toHaveLength(2);
    });

    it('a decline after a signature is refused (409) and records nothing; a repeat decline is 200 and records nothing more', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        expect((await sign(caseyToken)).status).toBe(200);
        expect((await decline(caseyToken)).status).toBe(409);
        expect(await eventRows('signer.declined')).toHaveLength(0);
        expect((await signerRow('casey@client.test'))?.status).toBe('signed');

        expect((await view(drewToken)).status).toBe(200);
        expect((await decline(drewToken)).status).toBe(200);
        expect((await decline(drewToken)).status).toBe(200);
        expect(await eventRows('signer.declined')).toHaveLength(1);
    });

    it('a decline whose audit row cannot be written still declines, and says so loudly under a stable message', async () => {
        expect((await view(caseyToken)).status).toBe(200);
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const watch = watchDb(h, 'into "esign_audit_logs"');
        const res = await decline(caseyToken);
        watch.restore();
        expect(res.status).toBe(200);
        expect((await signerRow('casey@client.test'))?.status).toBe('declined');
        expect(error.mock.calls.some((c) => c[0] === 'audit.append.signer-declined.failed')).toBe(true);
        error.mockRestore();
    });
});
