/**
 * The signing claim and its release. A claim is the one conditional update that moves a signer to `signed`; its `release` puts the signer
 * back when the audit row cannot be written. These pin what release may and may not do:
 *   - it exists only on a result that CLAIMED, so a request that found the signer already signed has nothing to release;
 *   - it reverts a row only while the row still shows this very claim (status, drawing, time), and then only the columns the claim set;
 *   - the log lines of a refused signing carry identifiers only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TENANT_A, INSP_ID, seedBase } from '../helpers/agreement-signers-setup';
import { STALE_SIGNING_MS } from '../../../server/services/agreement/signer-state';
import { computeEnvelopeStatus } from '../../../server/services/agreement/base';
import { refuseUnrecordedSignature } from '../../../server/lib/esign/claim-failure';
import { logger } from '../../../server/lib/logger';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const OPTS = (signedAtMs: number) => ({
    signedAtMs, channel: 'remote' as const, ipAddress: '203.0.113.9', userAgent: 'Agent/1.0',
    onBehalfOf: 'Acme LLC', onBehalfDisclaimer: 'authorized', languageDisclosureVersion: 1,
});
const A = 'data:image/png;base64,aGVsbG8=';
const B = 'data:image/png;base64,d29ybGQ=';

describe('claimSignedBySigner and release', () => {
    let svc: AgreementService;
    let db: BetterSQLite3Database<typeof schema>;
    let token: string;
    let signerId: string;

    const row = () => db.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.id, signerId)).get();

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedBase(db);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
        const created = await svc.findOrCreate(TENANT_A, INSP_ID, { signers: [{ name: 'Jane', email: 'jane@test.com', role: 'client' }], completionPolicy: 'one' });
        token = created.token;
        signerId = (await db.select().from(schema.agreementSigners).all())[0]!.id;
    });
    afterEach(() => vi.restoreAllMocks());

    it('release puts back exactly the columns the claim set, and nothing else', async () => {
        const before = (await row())!;
        const claim = await svc.claimSignedBySigner(token, A, OPTS(1_800_000_000_000));
        expect(claim.kind).toBe('claimed');
        expect((await row())!.status).toBe('signing');
        if (claim.kind !== 'claimed') throw new Error('not claimed');
        await claim.release();
        const after = (await row())!;
        expect(after).toEqual(before);
    });

    it('a second request finds the signer already signed, claims nothing and has no release; the first claim stands', async () => {
        const first = await svc.claimSignedBySigner(token, A, OPTS(1_800_000_000_000));
        expect(first.kind).toBe('claimed');
        if (first.kind !== 'claimed') throw new Error('not claimed');
        await first.confirm();
        const second = await svc.claimSignedBySigner(token, B, OPTS(1_800_000_000_500));
        expect(second.kind).toBe('already_signed');
        expect('release' in second).toBe(false);
        const stored = (await row())!;
        expect(stored.signatureBase64).toBe(A);
        expect(stored.signedAt?.getTime()).toBe(1_800_000_000_000);
    });

    it('release does nothing once the row no longer shows this claim: another drawing, another time, or another status (a signing confirmed meanwhile included)', async () => {
        const claim = await svc.claimSignedBySigner(token, A, OPTS(1_800_000_000_000));
        if (claim.kind !== 'claimed') throw new Error('not claimed');
        const changes: Array<Partial<typeof schema.agreementSigners.$inferInsert>> = [
            { signatureBase64: B },
            { signedAt: new Date(1_800_000_001_000) },
            { status: 'declined' },
            { status: 'signed' },
        ];
        for (const change of changes) {
            await db.update(schema.agreementSigners).set({ status: 'signing', signatureBase64: A, signedAt: new Date(1_800_000_000_000) }).where(eq(schema.agreementSigners.id, signerId));
            await db.update(schema.agreementSigners).set(change).where(eq(schema.agreementSigners.id, signerId));
            const before = (await row())!;
            await claim.release();
            expect(await row(), JSON.stringify(change)).toEqual(before);
        }
    });

    it('a signing in flight is not counted as signed by the envelope aggregate', () => {
        expect(computeEnvelopeStatus('all', [{ status: 'signing' }, { status: 'signed' }])).toBe('viewed');
        expect(computeEnvelopeStatus('one', [{ status: 'signing' }, { status: 'sent' }])).toBe('viewed');
        expect(computeEnvelopeStatus('one', [{ status: 'signed' }, { status: 'sent' }])).toBe('signed');
    });

    it('a signing in flight answers a second claim with 409 and writes nothing; a decline is refused the same way', async () => {
        const first = await svc.claimSignedBySigner(token, A, OPTS(Date.now()));
        expect(first.kind).toBe('claimed');
        const before = (await row())!;
        await expect(svc.claimSignedBySigner(token, B, OPTS(Date.now()))).rejects.toMatchObject({ status: 409 });
        await expect(svc.markDeclinedBySigner(token, 'no')).rejects.toMatchObject({ status: 409 });
        expect(await row()).toEqual(before);
    });

    it('a signing older than the stale window is taken over, and the new drawing replaces the stored one', async () => {
        const dead = await svc.claimSignedBySigner(token, A, OPTS(Date.now() - STALE_SIGNING_MS - 1000));
        expect(dead.kind).toBe('claimed');
        const taken = await svc.claimSignedBySigner(token, B, OPTS(Date.now()));
        expect(taken.kind).toBe('claimed');
        expect((await row())!.signatureBase64).toBe(B);
        expect((await row())!.status).toBe('signing');
    });

    it('the claim pins the status it read: from a stale snapshot it re-reads, and a release goes back to the status the claim replaced', async () => {
        const real = svc.getSignerByPresentedToken.bind(svc);
        const fresh = (await real(token))!;
        await db.update(schema.agreementSigners).set({ status: 'viewed' }).where(eq(schema.agreementSigners.id, signerId));
        vi.spyOn(svc, 'getSignerByPresentedToken').mockResolvedValue({ ...fresh, signer: { ...fresh.signer, status: 'sent' } });
        const claim = await svc.claimSignedBySigner(token, A, OPTS(Date.now()));
        if (claim.kind !== 'claimed') throw new Error('not claimed');
        expect(claim.signer.status).toBe('viewed');
        await claim.release();
        expect((await row())!.status).toBe('viewed');
    });

    it('release after the envelope expired meanwhile leaves the signer expired with it, not viewed under an expired envelope', async () => {
        await db.update(schema.agreementSigners).set({ status: 'viewed' }).where(eq(schema.agreementSigners.id, signerId));
        const claim = await svc.claimSignedBySigner(token, A, OPTS(Date.now()));
        if (claim.kind !== 'claimed') throw new Error('not claimed');
        await db.update(schema.agreementRequests).set({ status: 'expired' });
        await claim.release();
        expect((await row())!.status).toBe('expired');
    });

    const expireEnvelope = () => db.update(schema.agreementRequests).set({ status: 'expired' });

    it('an expired envelope cannot be signed: not on the normal path, and not by taking over a crashed signing', async () => {
        await db.update(schema.agreementSigners).set({ status: 'viewed' }).where(eq(schema.agreementSigners.id, signerId));
        await expireEnvelope();
        const before = (await row())!;
        await expect(svc.claimSignedBySigner(token, A, OPTS(Date.now()))).rejects.toMatchObject({ status: 409 });
        expect(await row()).toEqual(before);

        // A crash left a `signing` row; the envelope expired afterwards (the cron skips `signing`); the retry comes after the window.
        await db.update(schema.agreementSigners).set({ status: 'signing', signatureBase64: A, signedAt: new Date(Date.now() - STALE_SIGNING_MS - 5000) }).where(eq(schema.agreementSigners.id, signerId));
        const orphan = (await row())!;
        await expect(svc.claimSignedBySigner(token, B, OPTS(Date.now()))).rejects.toMatchObject({ status: 409 });
        expect(await row()).toEqual(orphan);
        expect((await row())!.status).not.toBe('signed');
    });

    it('an envelope that expires between the claim and the confirm is not signed: the confirm answers 409 and the signer is put back', async () => {
        await db.update(schema.agreementSigners).set({ status: 'viewed' }).where(eq(schema.agreementSigners.id, signerId));
        const claim = await svc.claimSignedBySigner(token, A, OPTS(Date.now()));
        if (claim.kind !== 'claimed') throw new Error('not claimed');
        await expireEnvelope();
        await expect(claim.confirm()).rejects.toMatchObject({ status: 409 });
        const after = (await row())!;
        expect(after.status).toBe('expired');
        expect(after.signatureBase64 ?? null).toBeNull();
    });

    it('a signing that is still live cannot be declined (409); a stale one can, and only the decline machinery writes the row', async () => {
        await svc.claimSignedBySigner(token, A, OPTS(Date.now()));
        await expect(svc.markDeclinedBySigner(token, 'no')).rejects.toMatchObject({ status: 409 });
        expect((await row())!.status).toBe('signing');
        await db.update(schema.agreementSigners).set({ signedAt: new Date(Date.now() - STALE_SIGNING_MS - 5000) }).where(eq(schema.agreementSigners.id, signerId));
        const declined = await svc.markDeclinedBySigner(token, 'no');
        expect(declined.declinedNow).toBe(true);
        expect((await row())!.status).toBe('declined');
    });

    it('the log lines of a refused signing carry identifiers only: no email, address or browser, even when the driver error carries them', async () => {
        const claim = await svc.claimSignedBySigner(token, A, OPTS(1_800_000_000_000));
        if (claim.kind !== 'claimed') throw new Error('not claimed');
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const alert = vi.spyOn(logger, 'alert').mockImplementation(() => undefined);
        const leaky = new Error('Failed query: insert into "esign_audit_logs" values (?, ?)\nparams: jane@test.com,203.0.113.9,Agent/1.0');
        const failing = { release: async () => { throw leaky; } };
        await expect(refuseUnrecordedSignature(failing, { tenantId: TENANT_A, requestId: 'req-1', signerId }, leaky)).rejects.toMatchObject({ status: 503 });
        const logged = JSON.stringify([...error.mock.calls, ...alert.mock.calls]);
        expect(logged).toContain('req-1');
        for (const secret of ['jane@test.com', '203.0.113.9', 'Agent/1.0']) expect(logged, secret).not.toContain(secret);
        expect(alert).toHaveBeenCalledTimes(1);
        expect(alert.mock.calls[0]![0]).toBe('signing_claim_not_released');
    });
});
