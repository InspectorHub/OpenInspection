/**
 * C18: an envelope-level token from before signer links is still looked up, but it is held to the same rules as a signer link: a revoked
 * or expired first signer, or an expired envelope, resolves to nothing (it used to ignore all of that). An expired envelope is refused
 * before anything is written; a live signer-less one still gets its one default signer on first open, and only one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { signViaClaim } from '../helpers/sign-via-claim';
import { hashToken } from '../../../server/lib/token-hash';
import { TENANT_A, INSP_ID, AGR_ID, seedBase } from '../helpers/agreement-signers-setup';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('the legacy envelope token', () => {
    let svc: AgreementService;
    let db: BetterSQLite3Database<typeof schema>;
    const LEGACY = 'legacy-envelope-token-0001';
    const ENVELOPE = '00000000-0000-0000-0000-0000000000e1';

    async function legacyEnvelope(status: 'sent' | 'expired' | 'signed' | 'declined' = 'sent') {
        await db.insert(schema.agreementRequests).values({
            id: ENVELOPE, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID, status,
            clientName: 'Jane', clientEmail: 'jane@test.com', token: 'unused-placeholder', tokenHash: await hashToken(LEGACY),
            contentSnapshot: 'Agreement text...', completionPolicy: 'all', createdAt: new Date(),
        } as never);
    }
    const signers = () => db.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.requestId, ENVELOPE)).all();

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedBase(db);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    it('an expired signer-less envelope is refused and nothing is written; a live one gets one default signer however often it is opened', async () => {
        await legacyEnvelope('expired');
        expect(await svc.getSignerByPresentedToken(LEGACY)).toBeNull();
        expect(await signers()).toHaveLength(0);
        await db.update(schema.agreementRequests).set({ status: 'sent' }).where(eq(schema.agreementRequests.id, ENVELOPE));
        const first = await svc.getSignerByPresentedToken(LEGACY);
        const second = await svc.getSignerByPresentedToken(LEGACY);
        expect(first?.signer.id).toBeTruthy();
        expect(second?.signer.id).toBe(first?.signer.id);
        expect(await signers()).toHaveLength(1);
    });

    it('is refused when the first signer\'s link has ended, and when the envelope itself expired', async () => {
        await legacyEnvelope();
        await db.insert(schema.agreementSigners).values({
            id: 'legacy-signer-1', tenantId: TENANT_A, requestId: ENVELOPE, name: 'Jane', email: 'jane@test.com', role: 'client',
            status: 'sent', createdAt: new Date(), expiresAt: new Date(Date.now() - 1000),
        } as never);
        expect(await svc.getSignerByPresentedToken(LEGACY)).toBeNull();
        await db.update(schema.agreementSigners).set({ expiresAt: null, revokedAt: new Date() }).where(eq(schema.agreementSigners.id, 'legacy-signer-1'));
        expect(await svc.getSignerByPresentedToken(LEGACY)).toBeNull();
        await db.update(schema.agreementSigners).set({ revokedAt: null }).where(eq(schema.agreementSigners.id, 'legacy-signer-1'));
        // Control: with a live signer the legacy token still resolves, so the refusals above are the new rules and not a dead lookup.
        expect((await svc.getSignerByPresentedToken(LEGACY))?.signer.id).toBe('legacy-signer-1');
        await db.update(schema.agreementRequests).set({ status: 'expired' }).where(eq(schema.agreementRequests.id, ENVELOPE));
        expect(await svc.getSignerByPresentedToken(LEGACY)).toBeNull();
    });

    it('two requests opening a signer-less envelope together get one and the same signer, and that signer can complete the envelope', async () => {
        await legacyEnvelope('sent');
        // Hold both opens at the point where each has just found no signer, so they really do race to create the default one.
        let arrived = 0;
        let open!: () => void;
        const gate = new Promise<void>((resolve) => { open = resolve; });
        const real = svc.loadSigners.bind(svc);
        vi.spyOn(svc, 'loadSigners').mockImplementation(async (requestId: string) => {
            const rows = await real(requestId);
            arrived += 1;
            if (arrived === 2) open();
            await gate;
            return rows;
        });
        const [a, b] = await Promise.all([svc.getSignerByPresentedToken(LEGACY), svc.getSignerByPresentedToken(LEGACY)]);
        expect(a?.signer.id).toBeTruthy();
        expect(b?.signer.id).toBe(a?.signer.id);
        vi.restoreAllMocks();
        expect(await signers()).toHaveLength(1);
        const done = await signViaClaim(svc, LEGACY, 'data:image/png;base64,aGVsbG8=', { signedAtMs: Date.now(), channel: 'remote', languageDisclosureVersion: null });
        expect(done.envelopeCompletedNow).toBe(true);
        expect((await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, ENVELOPE)).get())?.status).toBe('signed');
        expect(await signers()).toHaveLength(1);
    });

    it.each(['signed', 'declined', 'expired'] as const)('opening a %s envelope that has no signer rows adds no row to the record', async (status) => {
        await legacyEnvelope(status);
        const before = await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, ENVELOPE)).get();
        const resolved = await svc.getSignerByPresentedToken(LEGACY);
        if (status === 'expired') expect(resolved).toBeNull();
        else expect(resolved?.signer.status).toBe(status);
        await svc.getSignerByPresentedToken(LEGACY);
        expect(await signers()).toHaveLength(0);
        expect(await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, ENVELOPE)).get()).toEqual(before);
    });

});
