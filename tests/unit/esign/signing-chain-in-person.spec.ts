/**
 * The in-person signing door (staff-operated) and its audit rows: the same rules as the public door.
 *   - a signature whose audit row cannot be written is REFUSED (503), nothing is kept, and a retry starts clean;
 *   - of two requests for one signer exactly one is stored, and the row appended names that drawing;
 *   - a signer who already signed adds nothing; one who declined cannot sign.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AgreementService } from '../../../server/services/agreement.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(undefined) }));

import {
    INSP_ID, FAKE_ENV, makeExecCtx, buildApp, seedBase, createTwoSignerEnvelope, SIG, postSign,
} from '../helpers/inspection-sign-unification-setup';

const SIG_B = 'data:image/png;base64,d29ybGQ=';

async function imageHash(dataUrl: string): Promise<string> {
    const bytes = Uint8Array.from(atob(dataUrl.replace(/^data:image\/[a-z]+;base64,/, '')), (ch) => ch.charCodeAt(0));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return 'sha256:' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the in-person signing door and the audit chain', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        await seedBase(db);
    });
    afterEach(() => sqlite.close());

    const sign = (app: ReturnType<typeof buildApp>['app'], body: Record<string, unknown>) => app.request(`/${INSP_ID}/sign`, postSign(body), FAKE_ENV, makeExecCtx().ctx);
    const signerRows = (requestId: string) => db.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.requestId, requestId)).all();
    const signedCalls = (append: ReturnType<typeof vi.fn>) => append.mock.calls.filter((c) => c[2] === 'signer.signed');

    it('when the audit row cannot be written the signature is refused, nothing is kept, and a retry with another drawing is stored and named', async () => {
        const append = vi.fn().mockImplementation(async (_t: string, _r: string, event: string) => {
            if (event === 'signer.signed' && append.mock.calls.filter((c) => c[2] === 'signer.signed').length === 1) throw new Error('D1_ERROR: network connection lost');
            return { id: 'a', hash: 'h' };
        });
        const { app } = buildApp(db, { auditAppend: append });
        const { requestId } = await createTwoSignerEnvelope(db);

        const refused = await sign(app, { signatureBase64: SIG });
        expect(refused.status).toBe(503);
        const afterRefusal = (await signerRows(requestId)).find((s) => s.email === 'jane@test.com')!;
        expect(afterRefusal.status).not.toBe('signed');
        expect(afterRefusal.signatureBase64 ?? null).toBeNull();
        expect(afterRefusal.signedAt ?? null).toBeNull();

        const ok = await sign(app, { signatureBase64: SIG_B });
        expect(ok.status).toBe(200);
        const stored = (await signerRows(requestId)).find((s) => s.email === 'jane@test.com')!;
        expect(stored.signatureBase64).toBe(SIG_B);
        const newest = signedCalls(append).at(-1)![3] as { signatureImageHash: string };
        expect(newest.signatureImageHash).toBe(await imageHash(SIG_B));
    });

    it('two requests for one signer with different drawings: one stored, one signed row, naming the stored drawing', async () => {
        const append = vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
        const { app } = buildApp(db, { auditAppend: append });
        const { requestId } = await createTwoSignerEnvelope(db);
        const [a, b] = await Promise.all([sign(app, { signatureBase64: SIG }), sign(app, { signatureBase64: SIG_B })]);
        // The loser is told to retry (409, a signing in flight) or, if the winner had already confirmed, that it is signed (200).
        expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
        expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
        const stored = (await signerRows(requestId)).find((s) => s.email === 'jane@test.com')!;
        expect([SIG, SIG_B]).toContain(stored.signatureBase64);
        const calls = signedCalls(append);
        expect(calls).toHaveLength(1);
        expect((calls[0]![3] as { signatureImageHash: string }).signatureImageHash).toBe(await imageHash(stored.signatureBase64!));
    });

    it('two requests while the audit row of the winner cannot be written: the loser never gets 200, and nothing ends up signed', async () => {
        const append = vi.fn().mockImplementation(async (_t: string, _r: string, event: string) => {
            if (event === 'signer.signed') throw new Error('D1_ERROR: network connection lost');
            return { id: 'a', hash: 'h' };
        });
        const { app } = buildApp(db, { auditAppend: append });
        const { requestId, signers } = await createTwoSignerEnvelope(db);
        const [a, b] = await Promise.all([
            sign(app, { signatureBase64: SIG, signerId: signers[0]!.id }),
            sign(app, { signatureBase64: SIG_B, signerId: signers[0]!.id }),
        ]);
        expect([a.status, b.status].every((s) => s === 409 || s === 503)).toBe(true);
        expect([a.status, b.status]).toContain(503);
        const row = (await signerRows(requestId)).find((s) => s.id === signers[0]!.id)!;
        expect(['signed', 'signing']).not.toContain(row.status);
    });

    it('a failure after the signing was confirmed: the retry rolls the envelope forward, and a further repeat adds nothing', async () => {
        const append = vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
        const { app } = buildApp(db, { auditAppend: append });
        const { requestId, signers } = await createTwoSignerEnvelope(db);
        const resume = vi.spyOn(AgreementService.prototype, 'resumeConfirmedSigning');
        const finish = vi.spyOn(AgreementService.prototype, 'finishSignedBySigner');
        finish.mockRejectedValueOnce(new Error('store down'));
        const failed = await sign(app, { signatureBase64: SIG, signerId: signers[0]!.id });
        expect(failed.status).toBeGreaterThanOrEqual(500);
        expect((await signerRows(requestId)).find((s) => s.id === signers[0]!.id)!.status).toBe('signed');
        const retry = await sign(app, { signatureBase64: SIG, signerId: signers[0]!.id });
        expect(retry.status).toBe(200);
        expect(resume).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(2);
        expect(signedCalls(append)).toHaveLength(1);
        expect((await sign(app, { signatureBase64: SIG, signerId: signers[0]!.id })).status).toBe(200);
        expect(signedCalls(append)).toHaveLength(1);
        resume.mockRestore();
        finish.mockRestore();
    });

    it('a repeat for a signer who already signed adds nothing; a signer who declined cannot sign', async () => {
        const append = vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
        const { app } = buildApp(db, { auditAppend: append });
        const { requestId, signers } = await createTwoSignerEnvelope(db);
        expect((await sign(app, { signatureBase64: SIG, signerId: signers[0]!.id })).status).toBe(200);
        expect(signedCalls(append)).toHaveLength(1);
        const again = await sign(app, { signatureBase64: SIG_B, signerId: signers[0]!.id });
        expect(again.status).toBe(200);
        expect(signedCalls(append)).toHaveLength(1);
        expect((await signerRows(requestId)).find((s) => s.id === signers[0]!.id)!.signatureBase64).toBe(SIG);

        await db.update(schema.agreementSigners).set({ status: 'declined' }).where(eq(schema.agreementSigners.id, signers[1]!.id));
        const declined = await sign(app, { signatureBase64: SIG, signerId: signers[1]!.id });
        expect(declined.status).toBe(409);
        expect(signedCalls(append)).toHaveLength(1);
    });
});
