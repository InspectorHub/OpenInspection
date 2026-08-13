/**
 * IA-65 — `findOrCreate` against a LIVE envelope must merge the signer set it
 * is handed, not discard it.
 *
 * The old reuse branch returned the existing envelope the moment it found one
 * and never looked at `opts.signers`. Every caller — the admin Library send and
 * now the inspection workspace — reported success while the co-signers the
 * operator had just typed were never created. That failure is invisible from
 * the response, which is what makes it worth a test rather than a comment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGR_ID = '00000000-0000-0000-0000-000000000020';

let db: BetterSQLite3Database<typeof schema>;
let svc: AgreementService;

/** The state every case starts from: one live envelope with a single client signer. */
async function seedLiveEnvelope(completionPolicy: 'all' | 'one' = 'one') {
    const r = await svc.findOrCreate(TENANT, INSP_ID, {
        agreementId: AGR_ID,
        signers: [{ name: 'Jane Client', email: 'jane@example.com', role: 'client' }],
        completionPolicy,
    });
    expect(r.alreadyExists).toBe(false);
    return r.requestId;
}

const signersOf = (requestId: string) =>
    db.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.requestId, requestId)).all();

describe('AgreementService.findOrCreate — signer merge on a live envelope (IA-65)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement', content: 'Agreement text...', version: 1, createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        });

        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    it('adds the signers the live envelope does not have yet, and reports their ids', async () => {
        const requestId = await seedLiveEnvelope();

        const reuse = await svc.findOrCreate(TENANT, INSP_ID, {
            agreementId: AGR_ID,
            signers: [
                { name: 'Jane Client', email: 'jane@example.com', role: 'client' },
                { name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' },
            ],
            completionPolicy: 'all',
        });

        expect(reuse.alreadyExists).toBe(true);
        expect(reuse.requestId).toBe(requestId);
        expect(reuse.addedSignerIds).toHaveLength(1);

        const rows = await signersOf(requestId);
        expect(rows.map((s) => s.email).sort()).toEqual(['jane@example.com', 'sam@example.com']);
        // The newcomer is a real signer, not a placeholder: their own token is
        // what makes the link in their email theirs and nobody else's.
        const sam = rows.find((s) => s.email === 'sam@example.com')!;
        expect(sam.id).toBe(reuse.addedSignerIds[0]);
        expect(sam.role).toBe('co_client');
        expect(sam.tokenHash).toBeTruthy();
        expect(sam.tokenHash).not.toBe(rows.find((s) => s.email === 'jane@example.com')!.tokenHash);
    });

    it('re-sending the same people adds nobody (send is not duplicate-invite)', async () => {
        const requestId = await seedLiveEnvelope();

        const reuse = await svc.findOrCreate(TENANT, INSP_ID, {
            agreementId: AGR_ID,
            // Same person, different capitalisation and padding — the email is
            // the identity, and the UNIQUE index agrees.
            signers: [{ name: 'Jane Client', email: '  JANE@example.com ', role: 'client' }],
        });

        expect(reuse.addedSignerIds).toEqual([]);
        expect(await signersOf(requestId)).toHaveLength(1);
    });

    it('applies a new completion policy while the envelope is untouched', async () => {
        const requestId = await seedLiveEnvelope('one');

        await svc.findOrCreate(TENANT, INSP_ID, {
            agreementId: AGR_ID,
            signers: [{ name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' }],
            completionPolicy: 'all',
        });

        const env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, requestId)).get();
        expect(env?.completionPolicy).toBe('all');
    });

    it('refuses to relax the policy once someone has signed', async () => {
        const requestId = await seedLiveEnvelope('all');
        const [jane] = await signersOf(requestId);
        await db.update(schema.agreementSigners)
            .set({ status: 'signed', signedAt: new Date() })
            .where(eq(schema.agreementSigners.id, jane.id));

        await svc.findOrCreate(TENANT, INSP_ID, {
            agreementId: AGR_ID,
            signers: [{ name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' }],
            completionPolicy: 'one',
        });

        const env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, requestId)).get();
        // Switching to 'one' here would complete the envelope off Jane's
        // signature alone and fire the completion pipeline for a co-signer who
        // was added seconds ago and has signed nothing.
        expect(env?.completionPolicy).toBe('all');
        // The co-signer still joins — only the policy is pinned.
        expect(await signersOf(requestId)).toHaveLength(2);
    });

    it('leaves the envelope alone when no signers are supplied', async () => {
        const requestId = await seedLiveEnvelope('one');

        const reuse = await svc.findOrCreate(TENANT, INSP_ID);

        expect(reuse.requestId).toBe(requestId);
        expect(reuse.addedSignerIds).toEqual([]);
        expect(await signersOf(requestId)).toHaveLength(1);
    });
});
