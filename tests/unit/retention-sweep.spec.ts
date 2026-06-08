import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from './db';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';
import { tenants, tenantConfigs, agreements, agreementRequests, agreementSigners, esignAuditLogs } from '../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import { runRetentionSweep } from '../../server/lib/compliance/retention-sweep';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 8); // 2026-06-08

describe('runRetentionSweep', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        // Two tenants with different retention windows.
        await testDb.insert(tenants).values([
            { id: 't1', name: 'T1', slug: 't1', createdAt: new Date(NOW) },
            { id: 't2', name: 'T2', slug: 't2', createdAt: new Date(NOW) },
        ]);
        await testDb.insert(tenantConfigs).values([
            { tenantId: 't1', agreementRetentionYears: 6, updatedAt: new Date(NOW) },
            { tenantId: 't2', agreementRetentionYears: 2, updatedAt: new Date(NOW) },
        ] as any);
        // Shared agreement template referenced by the envelopes.
        await testDb.insert(agreements).values({
            id: 'agr-tpl', tenantId: 't1', name: 'Tpl', content: 'b', createdAt: new Date(NOW),
        } as any);
        await testDb.insert(agreements).values({
            id: 'agr-tpl2', tenantId: 't2', name: 'Tpl', content: 'b', createdAt: new Date(NOW),
        } as any);
    });

    afterEach(() => {
        sqlite.close();
    });

    /** Seed a signed (already-anonymized) envelope + signer + one audit row. */
    async function seedSignedEnvelope(opts: {
        id: string; tenantId: string; agreementId: string; signedAtMs: number;
    }) {
        await testDb.insert(agreementRequests).values({
            id: opts.id,
            tenantId: opts.tenantId,
            agreementId: opts.agreementId,
            clientEmail: '[erased]',
            clientName: null,
            token: `tok-${opts.id}`,
            status: 'signed',
            signatureBase64: 'data:image/png;base64,ENVSIG',
            signedAt: new Date(opts.signedAtMs),
            createdAt: new Date(opts.signedAtMs),
        } as any);
        await testDb.insert(agreementSigners).values({
            id: `${opts.id}-s1`,
            tenantId: opts.tenantId,
            requestId: opts.id,
            name: '[erased]',
            email: '[erased]',
            role: 'client',
            status: 'signed',
            signatureBase64: 'data:image/png;base64,SIGNERSIG',
            signedAt: new Date(opts.signedAtMs),
            createdAt: new Date(opts.signedAtMs),
        } as any);
        await testDb.insert(esignAuditLogs).values({
            id: `${opts.id}-audit`,
            tenantId: opts.tenantId,
            requestId: opts.id,
            event: 'agreement.signed',
            payloadJson: '{}',
            hash: 'h',
            signature: 'sig',
            keyFingerprint: 'fp',
            createdAt: opts.signedAtMs,
        } as any);
    }

    it('destroys signatures + sets purgedAt on past-window signed rows; keeps audit chain', async () => {
        // t1 (6y): signed 7 years ago -> past window -> purge.
        await seedSignedEnvelope({ id: 'e-old', tenantId: 't1', agreementId: 'agr-tpl', signedAtMs: NOW - 7 * YEAR_MS });

        const summary = await runRetentionSweep(testDb as any, NOW);
        expect(summary.purgedEnvelopes).toBe(1);

        const env = await testDb.select().from(agreementRequests).where(eq(agreementRequests.id, 'e-old')).get();
        expect(env!.signatureBase64).toBeNull();
        expect(env!.purgedAt).not.toBeNull();
        // status stays the truthful 'signed' (the agreement WAS signed).
        expect(env!.status).toBe('signed');

        const signer = await testDb.select().from(agreementSigners).where(eq(agreementSigners.id, 'e-old-s1')).get();
        expect(signer!.signatureBase64).toBeNull();

        // Audit chain row count unchanged.
        const audits = await testDb.select().from(esignAuditLogs).where(eq(esignAuditLogs.requestId, 'e-old')).all();
        expect(audits.length).toBe(1);
    });

    it('leaves within-window signed rows UNTOUCHED', async () => {
        // t1 (6y): signed 3 years ago -> within window.
        await seedSignedEnvelope({ id: 'e-recent', tenantId: 't1', agreementId: 'agr-tpl', signedAtMs: NOW - 3 * YEAR_MS });

        const summary = await runRetentionSweep(testDb as any, NOW);
        expect(summary.purgedEnvelopes).toBe(0);

        const env = await testDb.select().from(agreementRequests).where(eq(agreementRequests.id, 'e-recent')).get();
        expect(env!.signatureBase64).toBe('data:image/png;base64,ENVSIG');
        expect(env!.purgedAt).toBeNull();
        const signer = await testDb.select().from(agreementSigners).where(eq(agreementSigners.id, 'e-recent-s1')).get();
        expect(signer!.signatureBase64).toBe('data:image/png;base64,SIGNERSIG');
    });

    it('applies the PER-TENANT retention year (t2 = 2y purges a 3-year-old row)', async () => {
        // Same 3-year age, but t2 has a 2-year window -> purged.
        await seedSignedEnvelope({ id: 'e-t2', tenantId: 't2', agreementId: 'agr-tpl2', signedAtMs: NOW - 3 * YEAR_MS });

        const summary = await runRetentionSweep(testDb as any, NOW);
        expect(summary.purgedEnvelopes).toBe(1);
        const env = await testDb.select().from(agreementRequests).where(eq(agreementRequests.id, 'e-t2')).get();
        expect(env!.signatureBase64).toBeNull();
        expect(env!.purgedAt).not.toBeNull();
    });

    it('applies the DEFAULT 6y when a tenant has NO tenant_configs row (leftJoin null -> coalesce 6)', async () => {
        // A third tenant with NO tenant_configs row -> years comes back null from
        // the leftJoin and the sweep must coalesce it to DEFAULT_RETENTION_YEARS (6).
        await testDb.insert(tenants).values({ id: 't3', name: 'T3', slug: 't3', createdAt: new Date(NOW) });
        await testDb.insert(agreements).values({
            id: 'agr-tpl3', tenantId: 't3', name: 'Tpl', content: 'b', createdAt: new Date(NOW),
        } as any);
        // Older than 6y -> swept under the default window.
        await seedSignedEnvelope({ id: 'e-noconf-old', tenantId: 't3', agreementId: 'agr-tpl3', signedAtMs: NOW - 7 * YEAR_MS });
        // Younger than 6y -> kept.
        await seedSignedEnvelope({ id: 'e-noconf-young', tenantId: 't3', agreementId: 'agr-tpl3', signedAtMs: NOW - 5 * YEAR_MS });

        const summary = await runRetentionSweep(testDb as any, NOW);
        expect(summary.purgedEnvelopes).toBe(1);

        const old = await testDb.select().from(agreementRequests).where(eq(agreementRequests.id, 'e-noconf-old')).get();
        expect(old!.signatureBase64).toBeNull();
        expect(old!.purgedAt).not.toBeNull();

        const young = await testDb.select().from(agreementRequests).where(eq(agreementRequests.id, 'e-noconf-young')).get();
        expect(young!.signatureBase64).toBe('data:image/png;base64,ENVSIG');
        expect(young!.purgedAt).toBeNull();
    });

    it('leaves never-signed (draft) rows untouched', async () => {
        await testDb.insert(agreementRequests).values({
            id: 'e-draft', tenantId: 't1', agreementId: 'agr-tpl',
            clientEmail: 'client@example.com', token: 'tok-draft',
            status: 'sent', signatureBase64: null, signedAt: null,
            createdAt: new Date(NOW - 7 * YEAR_MS),
        } as any);

        const summary = await runRetentionSweep(testDb as any, NOW);
        expect(summary.purgedEnvelopes).toBe(0);
        const env = await testDb.select().from(agreementRequests).where(eq(agreementRequests.id, 'e-draft')).get();
        expect(env!.purgedAt).toBeNull();
    });

    it('is idempotent — a second run skips already-purged rows', async () => {
        await seedSignedEnvelope({ id: 'e-old2', tenantId: 't1', agreementId: 'agr-tpl', signedAtMs: NOW - 8 * YEAR_MS });

        const first = await runRetentionSweep(testDb as any, NOW);
        expect(first.purgedEnvelopes).toBe(1);
        const second = await runRetentionSweep(testDb as any, NOW);
        expect(second.purgedEnvelopes).toBe(0);
    });
});
