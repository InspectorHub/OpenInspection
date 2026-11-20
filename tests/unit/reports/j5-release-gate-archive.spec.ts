/**
 * J5 release gate — an inspection restored from a data package has its signed
 * agreement archived byte-for-byte, not written to the live table. A VERIFIED
 * archived signature satisfies the agreement leg (no unlocked_at, no live
 * signing row); an inspection with no valid archive is still held, and a normal
 * inspection is unaffected.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { lazyD1 } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { importIdMap, importArchives } from '../../../server/lib/db/schema/data-package';
import { InspectionService } from '../../../server/services/inspection.service';
import { AuditLogService } from '../../../server/services/audit-log.service';
import { SigningKeyService } from '../../../server/services/signing-key.service';
import type { PackEvent, PackKey } from '../../../server/lib/esign/chain-verify';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = '00000000-0000-0000-0000-0000000000d1';
const REQ = '00000000-0000-0000-0000-000000000100';

function mockR2(archiveBytes: string | null) {
    return {
        get: async () => archiveBytes === null ? null : ({ text: async () => archiveBytes } as any),
    } as any;
}

describe('J5 release gate archived-signature fallback', () => {
    let db: any;
    let testD1: ReturnType<typeof lazyD1>;
    let validArchive: string;
    let tamperedArchive: string;

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db;
        await setupSchema(fx.sqlite);
        testD1 = lazyD1();
        testD1.use(db);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-06-01',
            agreementRequired: true, paymentRequired: false, status: 'completed',
            reportStatus: 'published', createdAt: new Date(),
        } as never);
        // Build a genuine signed chain via the real audit service.
        const keySvc = new SigningKeyService(testD1.binding, 'unit-test-key-encryption-secret-32b');
        const audit = new AuditLogService(testD1.binding, keySvc);
        await audit.append(TENANT, REQ, 'request.created', { at: 1 });
        await audit.append(TENANT, REQ, 'signer.signed', { signerId: 's1', onBehalfOf: null, tsMs: 2, name: 'A' });
        const raw = await db.select().from(schema.esignAuditLogs).orderBy(asc(schema.esignAuditLogs.createdAt)).all() as Array<typeof schema.esignAuditLogs.$inferSelect>;
        const events = raw.map((r) => ({
            id: r.id, request_id: r.requestId, event: r.event, payload_json: r.payloadJson,
            prev_hash: r.prevHash, hash: r.hash, signature: r.signature,
            key_fingerprint: r.keyFingerprint, created_at: r.createdAt.getTime(),
        }));
        const fps = [...new Set(events.map((e) => e.key_fingerprint))];
        const keys: PackKey[] = (await Promise.all(fps.map((fp) => keySvc.getPublicKeyByFingerprint(TENANT, fp))))
            .filter(Boolean).map((k) => ({ fingerprint: k!.fingerprint, pem: k!.pem }));
        validArchive = JSON.stringify({ events, keys });
        tamperedArchive = JSON.stringify({
            events: events.map((e, i) => i === 0 ? { ...e, payload_json: '{"tampered":true}' } : e), keys,
        });
        // Clear live signing rows — the restored workspace has none.
        await db.delete(schema.esignAuditLogs);
    });

    const gate = (r2: any) => new InspectionService(testD1.binding, r2).resolveReleaseGate(INSP, TENANT);
    const markImported = () => db.insert(importIdMap).values({
        id: 'map-1', tenantId: TENANT, packageId: 'pkg', tableName: 'inspections',
        sourceId: INSP, newId: INSP, createdAt: new Date(),
    } as never);
    const addArchive = () => db.insert(importArchives).values({
        id: 'arc-1', tenantId: TENANT, packageId: 'pkg', sha256: 'a'.repeat(64),
        counts: null, sourceIds: JSON.stringify([REQ]), createdAt: new Date(),
    } as never);

    it('holds an imported inspection with no archive', async () => {
        await markImported();
        expect((await gate(mockR2(null)))?.reason).toBe('agreement');
    });

    it('releases an imported inspection with a VERIFIED archived signature', async () => {
        await markImported();
        await addArchive();
        expect(await gate(mockR2(validArchive))).toBeNull();
        // never sets unlocked_at
        const row = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP)).get();
        expect(row!.unlockedAt).toBeNull();
    });

    it('still holds when the archived chain is tampered', async () => {
        await markImported();
        await addArchive();
        expect((await gate(mockR2(tamperedArchive)))?.reason).toBe('agreement');
    });

    it('does not release a NORMAL inspection via an unrelated archive', async () => {
        // no import_id_map marker → archive cannot satisfy the gate
        await addArchive();
        expect((await gate(mockR2(validArchive)))?.reason).toBe('agreement');
    });
});
