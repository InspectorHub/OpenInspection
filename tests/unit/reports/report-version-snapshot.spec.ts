/**
 * What a published report FROZE, and what a later edit can no longer reach.
 *
 * The report resolved credentials LIVE on every read, so an inspector who left
 * an association silently rewrote the cover of every report they had ever
 * delivered — including ones a client downloaded months earlier and may be
 * relying on. Snapshotting at publish is what makes a delivered document a
 * document (Spec B §1: report surfaces snapshot at publish; live surfaces read
 * current state).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportVersionService } from '../../../server/services/report-version.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';
const LEAD = 'user-lead';
const HELPER = 'user-helper';

async function seed(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('snapshotOnPublish — credentials and appearance', () => {
    let svc: ReportVersionService;
    let db: BetterSQLite3Database<typeof schema>;

    const snapshotOf = async (version = 1) => {
        const row = await db.select().from(schema.reportVersions)
            .where(eq(schema.reportVersions.versionNumber, version)).get();
        return JSON.parse(row!.snapshotJson) as Record<string, unknown>;
    };

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seed(db);
        svc = new ReportVersionService({} as D1Database, 'test-encryption-secret-key');

        for (const [id, name] of [[LEAD, 'Dana Lead'], [HELPER, 'Sam Helper']] as const) {
            await db.insert(schema.users).values({
                id, tenantId: TENANT, email: id + '@acme.test', name,
                passwordHash: 'x', role: 'inspector', createdAt: new Date(),
            });
        }
        await db.update(schema.inspections).set({ inspectorId: LEAD })
            .where(eq(schema.inspections.id, INSPECTION));
        await db.insert(schema.inspectionInspectors).values([
            { inspectionId: INSPECTION, userId: LEAD, tenantId: TENANT, role: 'lead', createdAt: new Date() },
            { inspectionId: INSPECTION, userId: HELPER, tenantId: TENANT, role: 'helper', createdAt: new Date() },
        ]);
        await db.insert(schema.inspectorCredentials).values([
            { id: 'c1', tenantId: TENANT, userId: LEAD, label: 'InterNACHI CPI', memberNumber: 'N-1',
              imageR2Key: 't/cred/logo.png', sortOrder: 0, active: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 'c2', tenantId: TENANT, userId: HELPER, label: 'Radon Certified', memberNumber: 'R-9',
              imageR2Key: null, sortOrder: 0, active: true, createdAt: new Date(), updatedAt: new Date() },
        ]);
    });

    it('captures the credentials each inspector held, keyed to the PERSON', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const inspectors = (await snapshotOf()).inspectors as Array<Record<string, unknown>>;

        // A badge is a claim about a person on a document about an inspection.
        // Pooling them would turn a per-person claim into a per-inspection one
        // that nobody made, so the role travels with the credentials.
        expect(inspectors.map((i) => i.role)).toEqual(['lead', 'helper']);
        expect(inspectors[0].userId).toBe(LEAD);
        expect(inspectors[0].name).toBe('Dana Lead');
        expect((inspectors[0].credentials as Array<{ label: string }>).map((c) => c.label))
            .toEqual(['InterNACHI CPI']);
        expect((inspectors[1].credentials as Array<{ label: string }>).map((c) => c.label))
            .toEqual(['Radon Certified']);
    });

    it('is a LIST even with one inspector, so crediting helpers later costs no migration', async () => {
        await db.delete(schema.inspectionInspectors)
            .where(eq(schema.inspectionInspectors.userId, HELPER));
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const inspectors = (await snapshotOf()).inspectors;
        expect(Array.isArray(inspectors)).toBe(true);
        expect(inspectors).toHaveLength(1);
    });

    it('falls back to the inspection own lead when nothing is linked', async () => {
        await db.delete(schema.inspectionInspectors);
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const inspectors = (await snapshotOf()).inspectors as Array<Record<string, unknown>>;
        expect(inspectors).toHaveLength(1);
        expect(inspectors[0].userId).toBe(LEAD);
        expect(inspectors[0].role).toBe('lead');
    });

    it('KEEPS the old badge after the inspector drops the association', async () => {
        // The assertion the whole snapshot exists for, and the one nobody writes.
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        await db.update(schema.inspectorCredentials).set({ active: false })
            .where(eq(schema.inspectorCredentials.id, 'c1'));

        const frozen = (await snapshotOf()).inspectors as Array<{ credentials: unknown[] }>;
        expect(frozen[0].credentials).toHaveLength(1);

        // ...while a NEW publish reflects the change, because that is a new
        // document. Snapshot and live are supposed to differ; that is the point.
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const fresh = (await snapshotOf(2)).inspectors as Array<{ credentials: unknown[] }>;
        expect(fresh[0].credentials).toHaveLength(0);
    });

    it('captures the RESOLVED appearance profile, not the id it came from', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const style = (await snapshotOf()).styleProfile as Record<string, unknown>;
        // Resolved, so a tenant switching their house style later cannot
        // restyle a document that was already delivered.
        expect(style).toBeTruthy();
        expect(typeof style.badgeLayout).toBe('string');
        expect(typeof style.photoColumns).toBe('number');
    });

    it('stamps the schema version, so a reader can tell absent from empty', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        // An empty `inspectors` on a v2 row means "held none"; a missing one on
        // a v1 row means "this predates the feature". Identical as JSON,
        // opposite as a claim on a cover page.
        expect((await snapshotOf()).schemaVersion).toBe(2);
    });

    it('never reaches into another tenant credentials', async () => {
        await db.insert(schema.inspectorCredentials).values({
            id: 'c3', tenantId: 'other-tenant', userId: LEAD, label: 'Not ours',
            memberNumber: null, imageR2Key: null, sortOrder: 0, active: true,
            createdAt: new Date(), updatedAt: new Date(),
        });
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const inspectors = (await snapshotOf()).inspectors as Array<{ credentials: Array<{ label: string }> }>;
        expect(inspectors[0].credentials.map((c) => c.label)).toEqual(['InterNACHI CPI']);
    });
});

/**
 * Growing the snapshot must not invalidate a signature that already exists.
 *
 * This looked like it needed a dual-basis verifier — old rows hashed one way,
 * new rows another, and something to tell them apart. It does not, and the
 * reason is worth pinning rather than re-deriving: `content_hash` is the
 * SHA-256 of the stored `snapshot_json` STRING, and `verifyByToken` recomputes
 * it from that same stored column. A row written under the old shape keeps
 * hashing to exactly what it hashed to, whatever later versions contain.
 *
 * If that ever stops being true — if the verifier is "simplified" into
 * re-serialising a parsed object, or into rebuilding the snapshot from live
 * tables — this spec fails. Without it, every report issued before the change
 * would quietly start reporting as tampered on its own verification page.
 */
describe('snapshot growth vs. already-signed versions', () => {
    let svc: ReportVersionService;
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seed(db);
        svc = new ReportVersionService({} as D1Database, 'test-encryption-secret-key');
    });

    it('still verifies a snapshot written in the pre-credentials shape', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const row = await db.select().from(schema.reportVersions).get();

        // Rewrite the row into the old shape and re-sign it the way the old
        // code did: hash of the stored string, signature over that hash.
        const legacyJson = JSON.stringify({
            inspection: (JSON.parse(row!.snapshotJson) as { inspection: unknown }).inspection,
            data: {}, units: [],
        });
        const { sha256Hex, SigningKeyService, base64UrlEncode } =
            await import('../../../server/services/signing-key.service');
        const legacyHash = await sha256Hex(legacyJson);
        const { privateKey } = await new SigningKeyService({} as D1Database, 'test-encryption-secret-key')
            .ensureKeypair(TENANT);
        const sig = base64UrlEncode(new Uint8Array(await crypto.subtle.sign(
            { name: 'Ed25519' }, privateKey, new TextEncoder().encode(legacyHash),
        )));
        await db.update(schema.reportVersions)
            .set({ snapshotJson: legacyJson, contentHash: legacyHash, signature: sig })
            .where(eq(schema.reportVersions.id, row!.id));

        const v = await svc.verifyByToken(row!.verificationToken!);
        expect(v!.hashValid).toBe(true);
        expect(v!.signatureValid).toBe(true);
        expect(v!.chainValid).toBe(true);
    });

    it('verifies a new-shape row on its own basis', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const row = await db.select().from(schema.reportVersions).get();
        const v = await svc.verifyByToken(row!.verificationToken!);
        expect(v!.hashValid).toBe(true);
        expect(v!.signatureValid).toBe(true);
    });

    it('still detects tampering with the larger snapshot', async () => {
        // Growing the payload must not dilute what the hash is FOR.
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const row = await db.select().from(schema.reportVersions).get();
        const tampered = JSON.parse(row!.snapshotJson) as Record<string, unknown>;
        (tampered.inspectors as Array<{ credentials: unknown[] }>)[0] = {
            credentials: [{ label: 'Board Certified Anything', memberNumber: null, imageUrl: null }],
        } as never;
        await db.update(schema.reportVersions).set({ snapshotJson: JSON.stringify(tampered) })
            .where(eq(schema.reportVersions.id, row!.id));

        const v = await svc.verifyByToken(row!.verificationToken!);
        expect(v!.hashValid).toBe(false);
        expect(v!.signatureValid).toBe(false);
    });
});
