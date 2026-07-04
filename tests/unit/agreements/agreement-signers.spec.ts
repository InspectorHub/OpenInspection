import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { deadTokenSentinel, hashToken } from '../../../server/lib/token-hash';
import { TENANT_A, INSP_ID, AGR_ID, seedBase } from '../helpers/agreement-signers-setup';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('AgreementService — signer-level envelope state machine', () => {
    let svc: AgreementService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedBase(testDb);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    it('findOrCreate with 2 signers: envelope + 2 signer rows, snapshot+hash pinned, tier-2 tokens, token resolves to first signer', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com', role: 'client' },
                { name: 'John', email: 'john@test.com', role: 'co_client' },
            ],
        });
        expect(r.alreadyExists).toBe(false);
        expect(r.requestId).toBeTruthy();
        expect(r.token).toBeTruthy();

        const env = await testDb.select().from(schema.agreementRequests).all();
        expect(env.length).toBe(1);
        expect(env[0].contentSnapshot).toBe('Agreement text...');
        expect(env[0].contentHash).toBe(await hashToken('Agreement text...'));
        expect(env[0].completionPolicy).toBe('all');

        // mutate the live template — snapshot must be unchanged
        await testDb.update(schema.agreements).set({ content: 'MUTATED' }).where(eq(schema.agreements.id, AGR_ID));
        const envAfter = await testDb.select().from(schema.agreementRequests).all();
        expect(envAfter[0].contentSnapshot).toBe('Agreement text...');

        const signers = await testDb.select().from(schema.agreementSigners)
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        expect(signers.length).toBe(2);
        for (const s of signers) {
            expect(s.tokenHash).toBeTruthy();
            expect(s.tokenEnc).toBeTruthy();
            expect(s.tokenEnc!.startsWith('t1:')).toBe(true);
            expect(s.status).toBe('sent');
        }

        // returned token resolves to FIRST signer
        const resolved = await svc.getSignerByPresentedToken(r.token);
        expect(resolved).not.toBeNull();
        expect(resolved!.signer.email).toBe('jane@test.com');
    });

    it('findOrCreate default (no opts) -> one client-role signer from inspection', async () => {
        await svc.findOrCreate(TENANT_A, INSP_ID);
        const signers = await testDb.select().from(schema.agreementSigners).all();
        expect(signers.length).toBe(1);
        expect(signers[0].role).toBe('client');
        expect(signers[0].name).toBe('Jane');
        expect(signers[0].email).toBe('jane@test.com');
    });

    it('findOrCreate idempotency: second call alreadyExists=true, still 2 signer rows', async () => {
        const a = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com' },
                { name: 'John', email: 'john@test.com' },
            ],
        });
        const b = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com' },
                { name: 'John', email: 'john@test.com' },
            ],
        });
        expect(b.alreadyExists).toBe(true);
        expect(b.requestId).toBe(a.requestId);
        const signers = await testDb.select().from(schema.agreementSigners).all();
        expect(signers.length).toBe(2);
    });

    it('duplicate signer email input -> Conflict, no rows inserted', async () => {
        await expect(svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'dup@test.com' },
                { name: 'Janet', email: 'dup@test.com' },
            ],
        })).rejects.toThrow(/Duplicate signer email/);
        const env = await testDb.select().from(schema.agreementRequests).all();
        expect(env.length).toBe(0);
        const signers = await testDb.select().from(schema.agreementSigners).all();
        expect(signers.length).toBe(0);
    });

    it('legacy envelope plaintext token resolves to first signer AND upgrades envelope', async () => {
        // Hand-build a legacy envelope (plaintext token, no tokenHash) with one signer that has no token
        const legacyToken = 'legacy-plain-token-123';
        const reqId = crypto.randomUUID();
        await testDb.insert(schema.agreementRequests).values({
            id: reqId, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: legacyToken,
            status: 'sent', completionPolicy: 'all', createdAt: new Date(),
        });
        await testDb.insert(schema.agreementSigners).values({
            id: crypto.randomUUID(), tenantId: TENANT_A, requestId: reqId,
            name: 'Jane', email: 'jane@test.com', role: 'client', status: 'sent', createdAt: new Date(),
        });

        const resolved = await svc.getSignerByPresentedToken(legacyToken);
        expect(resolved).not.toBeNull();
        expect(resolved!.signer.email).toBe('jane@test.com');

        const env = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, reqId)).get();
        expect(env!.tokenHash).toBe(await hashToken(legacyToken));
        expect(env!.token).toBe(deadTokenSentinel(reqId));
    });

    it("'all' policy: sign 1/2 -> not complete, envelope viewed; sign 2/2 -> complete, signed + signedAt + mirror", async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com' },
                { name: 'John', email: 'john@test.com' },
            ],
            completionPolicy: 'all',
        });
        const signers = await testDb.select().from(schema.agreementSigners)
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        const link1 = await svc.getSignerLink(TENANT_A, r.requestId, signers[0].id);
        const link2 = await svc.getSignerLink(TENANT_A, r.requestId, signers[1].id);

        const first = await svc.markSignedBySigner(link1, 'sig-jane', { signedAtMs: 1000, channel: 'remote' });
        expect(first.envelopeCompletedNow).toBe(false);
        expect(first.envelopeStatus).toBe('viewed');

        const second = await svc.markSignedBySigner(link2, 'sig-john', { signedAtMs: 2000, channel: 'remote' });
        expect(second.envelopeCompletedNow).toBe(true);
        expect(second.envelopeStatus).toBe('signed');

        const env = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(env!.status).toBe('signed');
        expect(env!.signedAt).toBeTruthy();
        expect(env!.signatureBase64).toBe('sig-john');
    });

    it("'one' policy: first sign -> completedNow=true", async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com' },
                { name: 'John', email: 'john@test.com' },
            ],
            completionPolicy: 'one',
        });
        const signers = await testDb.select().from(schema.agreementSigners)
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        const link1 = await svc.getSignerLink(TENANT_A, r.requestId, signers[0].id);
        const res = await svc.markSignedBySigner(link1, 'sig-jane', { signedAtMs: 1000, channel: 'in_person' });
        expect(res.envelopeCompletedNow).toBe(true);
        expect(res.envelopeStatus).toBe('signed');
    });

    it("decline under 'all' -> envelope declined + lastError; under 'one' w/ other pending -> NOT declined", async () => {
        // all
        const rAll = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com' }, { name: 'John', email: 'john@test.com' }],
            completionPolicy: 'all',
        });
        const sAll = await testDb.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, rAll.requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        const linkAll = await svc.getSignerLink(TENANT_A, rAll.requestId, sAll[0].id);
        const decAll = await svc.markDeclinedBySigner(linkAll, 'Price too high');
        expect(decAll.envelopeStatus).toBe('declined');
        const envAll = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, rAll.requestId)).get();
        expect(envAll!.lastError).toBe('Price too high');

        // one — second inspection/envelope to keep them separate
        const INSP2 = '00000000-0000-0000-0000-000000000011';
        await testDb.insert(schema.inspections).values({ id: INSP2, tenantId: TENANT_A, propertyAddress: '2 Main', clientName: 'X', clientEmail: 'x@test.com', date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 1, createdAt: new Date() });
        const rOne = await svc.findOrCreate(TENANT_A, INSP2, {
            signers: [{ name: 'Jane', email: 'jane@test.com' }, { name: 'John', email: 'john@test.com' }],
            completionPolicy: 'one',
        });
        const sOne = await testDb.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, rOne.requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        const linkOne = await svc.getSignerLink(TENANT_A, rOne.requestId, sOne[0].id);
        const decOne = await svc.markDeclinedBySigner(linkOne, 'No');
        expect(decOne.envelopeStatus).not.toBe('declined');
    });

    it('already-signed signer re-sign -> idempotent, completedNow=false', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com' }],
            completionPolicy: 'one',
        });
        const s = await testDb.select().from(schema.agreementSigners).all();
        const link = await svc.getSignerLink(TENANT_A, r.requestId, s[0].id);
        const first = await svc.markSignedBySigner(link, 'sig', { signedAtMs: 1000, channel: 'remote' });
        expect(first.envelopeCompletedNow).toBe(true);
        const second = await svc.markSignedBySigner(link, 'sig-again', { signedAtMs: 2000, channel: 'remote' });
        expect(second.envelopeCompletedNow).toBe(false);
    });

    it('getSignerLink: roundtrip resolves to that signer; backfilled (tokenHash NULL) mints + persists', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com' }],
        });
        const s = await testDb.select().from(schema.agreementSigners).all();
        const link = await svc.getSignerLink(TENANT_A, r.requestId, s[0].id);
        const resolved = await svc.getSignerByPresentedToken(link);
        expect(resolved!.signer.id).toBe(s[0].id);

        // backfilled signer: NULL tokenHash + tokenEnc
        const reqId = crypto.randomUUID();
        await testDb.insert(schema.agreementRequests).values({
            id: reqId, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'b@test.com', clientName: 'B', token: crypto.randomUUID(),
            status: 'sent', completionPolicy: 'all', createdAt: new Date(),
        });
        const backfillId = crypto.randomUUID();
        await testDb.insert(schema.agreementSigners).values({
            id: backfillId, tenantId: TENANT_A, requestId: reqId,
            name: 'B', email: 'b@test.com', role: 'client', status: 'sent', createdAt: new Date(),
        });
        const backfillLink = await svc.getSignerLink(TENANT_A, reqId, backfillId);
        expect(backfillLink).toBeTruthy();
        const row = await testDb.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.id, backfillId)).get();
        expect(row!.tokenHash).toBe(await hashToken(backfillLink));
        expect(row!.tokenEnc).toBeTruthy();
    });

    it('getFirstOutstandingSignerLink: returns first non-terminal signer link; null when none outstanding', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com', role: 'client' },
                { name: 'John', email: 'john@test.com', role: 'co_client' },
            ],
            completionPolicy: 'all',
        });
        const signers = await testDb.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, r.requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();

        // First outstanding link resolves to signer 1.
        const link = await svc.getFirstOutstandingSignerLink(TENANT_A, INSP_ID);
        expect(link).toBeTruthy();
        expect((await svc.getSignerByPresentedToken(link!))!.signer.id).toBe(signers[0].id);

        // Sign signer 1 -> first outstanding is now signer 2.
        await testDb.update(schema.agreementSigners)
            .set({ status: 'signed' }).where(eq(schema.agreementSigners.id, signers[0].id));
        const link2 = await svc.getFirstOutstandingSignerLink(TENANT_A, INSP_ID);
        expect((await svc.getSignerByPresentedToken(link2!))!.signer.id).toBe(signers[1].id);

        // No outstanding signers -> null.
        await testDb.update(schema.agreementSigners)
            .set({ status: 'signed' }).where(eq(schema.agreementSigners.requestId, r.requestId));
        await testDb.update(schema.agreementRequests)
            .set({ status: 'signed' }).where(eq(schema.agreementRequests.id, r.requestId));
        expect(await svc.getFirstOutstandingSignerLink(TENANT_A, INSP_ID)).toBeNull();

        // No envelope at all -> null.
        const otherInsp = '00000000-0000-0000-0000-0000000000ff';
        expect(await svc.getFirstOutstandingSignerLink(TENANT_A, otherInsp)).toBeNull();
    });

    it('getSnapshotForRequest: snapshot set -> returned; NULL + non-terminal -> live template fallback AND persists', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, { signers: [{ name: 'Jane', email: 'jane@test.com' }] });
        const env = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, r.requestId)).get();
        const snap = await svc.getSnapshotForRequest(env!);
        expect(snap.content).toBe('Agreement text...');
        expect(snap.hash).toBe(await hashToken('Agreement text...'));

        // NULL snapshot, non-terminal
        const reqId = crypto.randomUUID();
        await testDb.insert(schema.agreementRequests).values({
            id: reqId, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'c@test.com', token: crypto.randomUUID(),
            status: 'viewed', completionPolicy: 'all', contentSnapshot: null, contentHash: null, createdAt: new Date(),
        });
        const nullEnv = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, reqId)).get();
        const snap2 = await svc.getSnapshotForRequest(nullEnv!);
        expect(snap2.content).toBe('Agreement text...');
        const persisted = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, reqId)).get();
        expect(persisted!.contentSnapshot).toBe('Agreement text...');
        expect(persisted!.contentHash).toBeTruthy();
    });

    it('expireOlderThan cascades: envelope + non-terminal signers expired; already-signed signer stays signed', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com' }, { name: 'John', email: 'john@test.com' }],
            completionPolicy: 'one',
        });
        const signers = await testDb.select().from(schema.agreementSigners)
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        // sign signer[0]
        await testDb.update(schema.agreementSigners).set({ status: 'signed' })
            .where(eq(schema.agreementSigners.id, signers[0].id));
        // backdate envelope sentAt
        const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        await testDb.update(schema.agreementRequests).set({ sentAt: old })
            .where(eq(schema.agreementRequests.id, r.requestId));

        await svc.expireOlderThan(14);
        const env = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(env!.status).toBe('expired');
        const after = await testDb.select().from(schema.agreementSigners)
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        expect(after.find((s) => s.id === signers[0].id)!.status).toBe('signed');
        expect(after.find((s) => s.id === signers[1].id)!.status).toBe('expired');
    });

    it('on-behalf + channel + ip/ua persist on signer through markSignedBySigner', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, { signers: [{ name: 'Agent', email: 'agent@test.com', role: 'agent' }], completionPolicy: 'one' });
        const s = await testDb.select().from(schema.agreementSigners).all();
        const link = await svc.getSignerLink(TENANT_A, r.requestId, s[0].id);
        await svc.markSignedBySigner(link, 'sig', {
            signedAtMs: 5000, channel: 'in_person',
            ipAddress: '1.2.3.4', userAgent: 'UA/1.0',
            onBehalfOf: 'Jane Buyer', onBehalfDisclaimer: 'authorized agent',
        });
        const row = await testDb.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.id, s[0].id)).get();
        expect(row!.channel).toBe('in_person');
        expect(row!.ipAddress).toBe('1.2.3.4');
        expect(row!.userAgent).toBe('UA/1.0');
        expect(row!.onBehalfOf).toBe('Jane Buyer');
        expect(row!.onBehalfDisclaimer).toBe('authorized agent');
        expect(row!.signatureBase64).toBe('sig');
    });

    it('single-fire: sign A (1/2) then sign B TWICE -> exactly one envelopeCompletedNow=true', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com' },
                { name: 'John', email: 'john@test.com' },
            ],
            completionPolicy: 'all',
        });
        const signers = await testDb.select().from(schema.agreementSigners)
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        const linkA = await svc.getSignerLink(TENANT_A, r.requestId, signers[0].id);
        const linkB = await svc.getSignerLink(TENANT_A, r.requestId, signers[1].id);

        // A signs first: envelope 1/2, not complete.
        const a = await svc.markSignedBySigner(linkA, 'sig-jane', { signedAtMs: 1000, channel: 'remote' });
        expect(a.envelopeCompletedNow).toBe(false);

        // B signs (2/2) — this completes the envelope. Second call is the
        // idempotent re-sign of an already-signed signer.
        const b1 = await svc.markSignedBySigner(linkB, 'sig-john', { signedAtMs: 2000, channel: 'remote' });
        const b2 = await svc.markSignedBySigner(linkB, 'sig-john-again', { signedAtMs: 3000, channel: 'remote' });

        const fires = [a, b1, b2].filter((x) => x.envelopeCompletedNow).length;
        expect(fires).toBe(1);
        expect(b1.envelopeCompletedNow).toBe(true);
        expect(b2.envelopeCompletedNow).toBe(false);

        const env = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(env!.status).toBe('signed');
        // Envelope signature is the WINNING write's signature, not the loser's.
        expect(env!.signatureBase64).toBe('sig-john');
    });

    it('concurrent: Promise.all two markSignedBySigner for the same last signer -> at most one envelopeCompletedNow=true', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com' }],
            completionPolicy: 'one',
        });
        const s = await testDb.select().from(schema.agreementSigners).all();
        const link = await svc.getSignerLink(TENANT_A, r.requestId, s[0].id);

        // better-sqlite3 is synchronous under the hood so this resolves
        // deterministically, but the service awaits between read + write, so the
        // atomic claim (conditional UPDATE row-count) is what guarantees single-fire.
        const [c1, c2] = await Promise.all([
            svc.markSignedBySigner(link, 'sig-1', { signedAtMs: 1000, channel: 'remote' }),
            svc.markSignedBySigner(link, 'sig-2', { signedAtMs: 1000, channel: 'remote' }),
        ]);
        const fires = [c1, c2].filter((x) => x.envelopeCompletedNow).length;
        expect(fires).toBeLessThanOrEqual(1);
        expect(fires).toBe(1);

        const env = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(env!.status).toBe('signed');
    });

    it('no-secrets degraded path: findOrCreate works (tokenEnc NULL), getSignerLink rejects with Internal', async () => {
        const noSecretSvc = new AgreementService({} as D1Database); // no secrets
        const r = await noSecretSvc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com' },
                { name: 'John', email: 'john@test.com' },
            ],
        });
        expect(r.alreadyExists).toBe(false);
        expect(r.requestId).toBeTruthy();
        // No secrets -> the returned token is the freshly-minted first-signer
        // plaintext (findOrCreate returns it directly, never via getSignerLink).
        expect(r.token).toBeTruthy();

        const signers = await testDb.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, r.requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        expect(signers.length).toBe(2);
        for (const s of signers) {
            expect(s.tokenHash).toBeTruthy(); // hash is still persisted
            expect(s.tokenEnc).toBeNull();     // sealing skipped without a key
        }

        // getSignerLink cannot reconstruct the link without a sealing key.
        await expect(noSecretSvc.getSignerLink(TENANT_A, r.requestId, signers[0].id))
            .rejects.toThrow(/Token sealing key unavailable/);
    });

    describe('getSignerLinkByEmail (portal Hub — email-matched signer token)', () => {
        // A two-signer envelope so we can prove the email match never returns the
        // WRONG signer's token (the cross-signer security property).
        async function seedTwoSigners() {
            return svc.findOrCreate(TENANT_A, INSP_ID, {
                completionPolicy: 'all',
                signers: [
                    { name: 'Jane Client', email: 'jane@test.com', role: 'client' },
                    { name: 'Bob CoClient', email: 'BOB@test.com', role: 'co_client' },
                ],
            });
        }

        it('returns the token of the signer whose email matches', async () => {
            await seedTwoSigners();
            const token = await svc.getSignerLinkByEmail(TENANT_A, INSP_ID, 'jane@test.com');
            expect(token).toBeTruthy();
            // The returned token must resolve back to JANE's signer row, never Bob's.
            const resolved = await svc.getSignerByPresentedToken(token!);
            expect(resolved?.signer.email.toLowerCase()).toBe('jane@test.com');
        });

        it('matches case-insensitively and never leaks a different signer', async () => {
            await seedTwoSigners();
            // Bob's row was seeded as 'BOB@test.com'; the caller's verified email is
            // lower-cased 'bob@test.com'. It must match BOB, not fall back to Jane.
            const token = await svc.getSignerLinkByEmail(TENANT_A, INSP_ID, 'bob@test.com');
            expect(token).toBeTruthy();
            const resolved = await svc.getSignerByPresentedToken(token!);
            expect(resolved?.signer.email.toLowerCase()).toBe('bob@test.com');
        });

        it('returns null when no signer email matches (never a fallback token)', async () => {
            await seedTwoSigners();
            const token = await svc.getSignerLinkByEmail(TENANT_A, INSP_ID, 'stranger@test.com');
            expect(token).toBeNull();
        });

        it('returns null when no envelope exists for the inspection', async () => {
            const token = await svc.getSignerLinkByEmail(TENANT_A, INSP_ID, 'jane@test.com');
            expect(token).toBeNull();
        });

        it('returns null for a blank email', async () => {
            await seedTwoSigners();
            expect(await svc.getSignerLinkByEmail(TENANT_A, INSP_ID, '')).toBeNull();
        });

        it('returns a token even when the envelope is already signed (still viewable)', async () => {
            const { token: janeToken } = await seedTwoSigners();
            // Sign as Jane → envelope may stay 'viewed' (policy 'all', Bob outstanding),
            // but Jane's signer row becomes 'signed'. Her token must still resolve.
            await svc.markViewedBySigner(janeToken);
            await svc.markSignedBySigner(janeToken, 'data:image/png;base64,XX', { signedAtMs: Date.now(), channel: 'remote' });
            const link = await svc.getSignerLinkByEmail(TENANT_A, INSP_ID, 'jane@test.com');
            expect(link).toBeTruthy();
        });
    });
});
