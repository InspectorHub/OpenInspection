/**
 * Archive-backed evidence verification tests. An imported envelope has no live
 * esign/key rows; verification reads the byte-identical archive and checks the
 * chain for that one envelope. A missing archive and a tampered chain are
 * reported, never fabricated from live tables.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { asc } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { lazyD1 } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { importArchives } from '../../../server/lib/db/schema/data-package';
import { verifyArchivedEnvelope, loadArchivedEvidence, type ArchivedEsignRow } from '../../../server/services/data-package/archived-evidence.service';
import type { PackKey } from '../../../server/lib/esign/chain-verify';
import { AuditLogService } from '../../../server/services/audit-log.service';
import { SigningKeyService } from '../../../server/services/signing-key.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const REQ = '00000000-0000-0000-0000-000000000100';
const OTHER_REQ = '00000000-0000-0000-0000-000000000101';
const PKG = 'pkg-1';

function mockBucket() {
    const objects = new Map<string, string>();
    return {
        objects,
        async put(key: string, bytes: ArrayBuffer | Uint8Array) {
            objects.set(key, new TextDecoder().decode(new Uint8Array(bytes as ArrayBuffer)));
            return { key };
        },
        async get(key: string) {
            const body = objects.get(key);
            if (body === undefined) return null;
            return { text: async () => body } as any;
        },
    };
}

describe('archived evidence verification', () => {
    let db: any;
    let bucket: ReturnType<typeof mockBucket>;
    let rows: ArchivedEsignRow[];
    let keys: PackKey[];

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db;
        await setupSchema(fx.sqlite);
        const testD1 = lazyD1();
        testD1.use(db);
        bucket = mockBucket();
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        const keySvc = new SigningKeyService(testD1.binding, 'unit-test-key-encryption-secret-32b');
        const audit = new AuditLogService(testD1.binding, keySvc);
        await audit.append(TENANT, REQ, 'request.created', { at: 1 });
        await audit.append(TENANT, REQ, 'signer.signed', { signerId: 's1', onBehalfOf: null, tsMs: 5, name: 'A' });
        await audit.append(TENANT, OTHER_REQ, 'request.created', { at: 2 });
        const raw = await db.select().from(schema.esignAuditLogs).orderBy(asc(schema.esignAuditLogs.createdAt)).all() as Array<typeof schema.esignAuditLogs.$inferSelect>;
        rows = raw.map((r) => ({
            id: r.id, request_id: r.requestId, event: r.event, payload_json: r.payloadJson,
            prev_hash: r.prevHash, hash: r.hash, signature: r.signature,
            key_fingerprint: r.keyFingerprint, created_at: r.createdAt.getTime(),
        }));
        const fps = [...new Set(rows.map((r) => r.key_fingerprint))];
        keys = (await Promise.all(fps.map((fp) => keySvc.getPublicKeyByFingerprint(TENANT, fp))))
            .filter(Boolean).map((k) => ({ fingerprint: k!.fingerprint, pem: k!.pem }));
        await bucket.put(`evidence-archives/${TENANT}/${PKG}/`, new TextEncoder().encode(JSON.stringify({ events: rows, keys })));
        await db.insert(importArchives).values({
            id: 'arc-1', tenantId: TENANT, packageId: PKG, sha256: 'a'.repeat(64),
            counts: null, sourceIds: JSON.stringify([REQ, OTHER_REQ]), createdAt: new Date(),
        } as never);
    });

    it('loads archived evidence for a recorded envelope', async () => {
        const loaded = await loadArchivedEvidence(db, bucket as any, TENANT, REQ);
        expect(loaded).not.toBeNull();
        expect(loaded!.events.length).toBe(3); // both envelopes' rows in the file
    });

    it('verifies one envelope chain with no problems and only its own events', async () => {
        const result = await verifyArchivedEnvelope(db, bucket as any, TENANT, REQ);
        expect(result).not.toBeNull();
        expect(result!.events).toBe(2); // REQ has 2 events, OTHER_REQ has 1
        expect(result!.verdict.problems).toEqual([]);
    });

    it('returns null for an envelope with no archive', async () => {
        expect(await verifyArchivedEnvelope(db, bucket as any, TENANT, 'unknown-envelope')).toBeNull();
    });

    it('reports a tampered archived chain (hash problem)', async () => {
        const tampered = rows.map((r) => r.request_id === REQ && r.event === 'request.created'
            ? { ...r, payload_json: '{"tampered":true}' } : r);
        await bucket.put(`evidence-archives/${TENANT}/${PKG}/`, new TextEncoder().encode(JSON.stringify({ events: tampered, keys })));
        const result = await verifyArchivedEnvelope(db, bucket as any, TENANT, REQ);
        expect(result).not.toBeNull();
        expect(result!.verdict.problems.some((p) => p.reason === 'hash' || p.reason === 'signature')).toBe(true);
    });
});
