/**
 * A signature and the documents holding its picture expire together.
 *
 * Counsel's round-26 finding, and it is the whole task: nulling
 * `agreement_signers.signature_base64` while `signed.pdf` still embeds the same
 * image is DATABASE retention wearing the name of retention. The column and the
 * three artefacts are representations of one evidence object. They expire as
 * one — unless the PDF were deliberately declared an independent contract
 * record with its own authority and its own window, which it is not.
 *
 * The one thing that must NOT go is `esign_audit_logs`. It is hash-chained, so
 * removing any row breaks verification for every row after it, and it is the
 * minimal PII-light record that deliberately survives even final destruction.
 * The sweep already treats that as a hard rule; a test pins it here because a
 * change that widened this pass to "delete everything about the envelope" would
 * otherwise look like tidying up.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import {
    agreementRequests, agreementSigners, agreements, esignAuditLogs, inspections,
    tenantConfigs, tenants,
} from '../../../server/lib/db/schema';
import { runRetentionSweep } from '../../../server/lib/compliance/retention-sweep';
import { r2Keys } from '../../../server/lib/r2-keys';

const TENANT = '00000000-0000-0000-0000-0000000000b1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000b2';
const INSPECTION = 'insp-sig-1';
const ENVELOPE = 'env-sig-1';
const NOW = Date.UTC(2026, 7, 17);
const yearsAgo = (n: number) => NOW - Math.round(n * 365.25 * 24 * 60 * 60 * 1000);

const ARTEFACTS = ['signed.pdf', 'certificate.pdf', 'evidence.zip'] as const;
const keysFor = (tenantId: string, inspectionId: string, envelopeId: string) =>
    ARTEFACTS.map((n) => r2Keys.agreementFile(tenantId, inspectionId, envelopeId, n));

/** An R2 stub that actually holds objects. A no-op bucket makes every assertion below vacuous. */
function makeR2(seed: string[] = []) {
    const store = new Set(seed);
    return {
        store,
        bucket: {
            delete: async (keys: string | string[]) => {
                for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
            },
            get: async (k: string) => (store.has(k) ? ({} as R2ObjectBody) : null),
        } as unknown as R2Bucket,
    };
}

describe('signature retention graph', () => {
    let db: BetterSQLite3Database<typeof schema>;

    async function seedDueEnvelope(opts: {
        id?: string; tenantId?: string; inspectionId?: string; signedAtMs: number;
    }) {
        const id = opts.id ?? ENVELOPE;
        const tenantId = opts.tenantId ?? TENANT;
        const inspectionId = opts.inspectionId ?? INSPECTION;
        // The agreement template and inspection the envelope hangs off. Both are
        // NOT NULL with real FKs on this table, so a fixture that skips them
        // fails on the constraint rather than on the behaviour under test.
        await db.insert(agreements).values({
            id: `${id}-agr`, tenantId, name: 'Standard', content: '<p>x</p>',
            createdAt: new Date(opts.signedAtMs),
        });
        await db.insert(inspections).values({
            id: inspectionId, tenantId, propertyAddress: '1 St', date: '2026-01-01',
            status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: true, paymentRequired: false, createdAt: new Date(opts.signedAtMs),
        });
        await db.insert(agreementRequests).values({
            id, tenantId, inspectionId, agreementId: `${id}-agr`, status: 'signed',
            signedAt: new Date(opts.signedAtMs), createdAt: new Date(opts.signedAtMs),
            clientEmail: 'client@example.com',
        });
        await db.insert(agreementSigners).values({
            id: `${id}-signer`, requestId: id, tenantId,
            name: 'A Client', email: 'client@example.com', role: 'client',
            signatureBase64: 'data:image/png;base64,AAAA',
            signedAt: new Date(opts.signedAtMs), createdAt: new Date(opts.signedAtMs),
        });
        return { id, tenantId, inspectionId };
    }

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        for (const id of [TENANT, OTHER_TENANT]) {
            await db.insert(tenants).values({
                id, slug: `t-${id.slice(-2)}`, status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
    });

    it('destroys the PDF and the evidence pack in the same pass as the column', async () => {
        const keys = keysFor(TENANT, INSPECTION, ENVELOPE);
        const r2 = makeR2([...keys]);
        await seedDueEnvelope({ signedAtMs: yearsAgo(7) });

        const out = await runRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.purgedSigners).toBe(1);
        expect(out.purgedArtefacts).toBe(3);
        for (const k of keys) expect(r2.store.has(k)).toBe(false);

        // And the column really is null — the artefacts are the ADDITION, not a
        // replacement for what the sweep already did.
        const signer = await db.select().from(agreementSigners).get();
        expect(signer?.signatureBase64).toBeNull();
    });

    it('leaves the audit chain untouched — it is the record that survives destruction', async () => {
        await seedDueEnvelope({ signedAtMs: yearsAgo(7) });
        await db.insert(esignAuditLogs).values({
            id: 'audit-1', tenantId: TENANT, requestId: ENVELOPE,
            event: 'signer.signed', payloadJson: '{}', createdAt: new Date(yearsAgo(7)),
            hash: 'h1', signature: 'sig1', keyFingerprint: 'fp1',
        });
        const before = await db.select().from(esignAuditLogs).all();
        const r2 = makeR2(keysFor(TENANT, INSPECTION, ENVELOPE));

        await runRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(await db.select().from(esignAuditLogs).all()).toEqual(before);
    });

    it('leaves an envelope inside its window entirely alone, objects included', async () => {
        const keys = keysFor(TENANT, INSPECTION, ENVELOPE);
        const r2 = makeR2([...keys]);
        await seedDueEnvelope({ signedAtMs: yearsAgo(2) });

        const out = await runRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.purgedSigners).toBe(0);
        expect(out.purgedArtefacts).toBe(0);
        for (const k of keys) expect(r2.store.has(k)).toBe(true);
        const signer = await db.select().from(agreementSigners).get();
        expect(signer?.signatureBase64).not.toBeNull();
    });

    it('never touches another envelope\'s artefacts', async () => {
        // The keys differ only by envelope id, so a sweep that built the prefix
        // from the wrong row would destroy a live agreement's evidence pack.
        const dueKeys = keysFor(TENANT, INSPECTION, ENVELOPE);
        const liveKeys = keysFor(OTHER_TENANT, 'insp-other', 'env-other');
        const r2 = makeR2([...dueKeys, ...liveKeys]);
        await seedDueEnvelope({ signedAtMs: yearsAgo(7) });
        await seedDueEnvelope({
            id: 'env-other', tenantId: OTHER_TENANT, inspectionId: 'insp-other',
            signedAtMs: yearsAgo(1),
        });

        await runRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        for (const k of dueKeys) expect(r2.store.has(k)).toBe(false);
        for (const k of liveKeys) expect(r2.store.has(k)).toBe(true);
    });

    it('applies the tenant\'s own agreement window to the artefacts too', async () => {
        // A tenant on a three-year window has a five-year-old envelope. Both the
        // column and the objects must go — a sweep that read the default for the
        // objects and the config for the column would leave the picture behind.
        await db.insert(tenantConfigs).values({
            tenantId: TENANT, agreementRetentionYears: 3, updatedAt: new Date(),
        });
        const keys = keysFor(TENANT, INSPECTION, ENVELOPE);
        const r2 = makeR2([...keys]);
        await seedDueEnvelope({ signedAtMs: yearsAgo(5) });

        const out = await runRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.purgedSigners).toBe(1);
        expect(out.purgedArtefacts).toBe(3);
        for (const k of keys) expect(r2.store.has(k)).toBe(false);
    });

    it('without a bucket it refuses rather than nulling the column and leaving the picture', async () => {
        // This is the defect in its exact original shape: the column goes, the
        // PDF holding the same image stays, and the sweep reports success. A
        // caller that cannot reach R2 must not be able to produce that state.
        await seedDueEnvelope({ signedAtMs: yearsAgo(7) });

        await expect(runRetentionSweep(asAnyDb(db), NOW, {})).rejects.toThrow(/bucket/i);

        const signer = await db.select().from(agreementSigners).get();
        expect(signer?.signatureBase64).not.toBeNull();
    });

    it('destroys the company countersignature on the same clock as the client signature', async () => {
        // Two signatures, one envelope, one purpose. The inspector's
        // countersignature is evidence that the COMPANY executed this
        // agreement, so it ends when the envelope's evidence does. The
        // inspector's saved DEFAULT signature is a different clock — an account
        // asset — and is deliberately not touched here.
        await seedDueEnvelope({ signedAtMs: yearsAgo(7) });
        await db.update(agreementRequests)
            .set({ inspectorSignatureBase64: 'data:image/png;base64,BBBB' })
            .where(eq(agreementRequests.id, ENVELOPE));
        const r2 = makeR2(keysFor(TENANT, INSPECTION, ENVELOPE));

        await runRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        const row = await db.select().from(agreementRequests).get();
        expect(row?.inspectorSignatureBase64).toBeNull();
    });

    it('needs no bucket when nothing is due', async () => {
        await seedDueEnvelope({ signedAtMs: yearsAgo(1) });
        const out = await runRetentionSweep(asAnyDb(db), NOW, {});
        expect(out.purgedSigners).toBe(0);
        expect(out.purgedArtefacts).toBe(0);
    });
});
