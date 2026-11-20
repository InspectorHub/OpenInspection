/**
 * J5 — report version verification falls back to the archived signing key when
 * the target workspace's live key table does not hold the key the report was
 * sealed with (a restored report was signed by the source workspace). No live
 * key row is written; a missing archive or a bad key stays unverifiable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { lazyD1 } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { ReportVersionService } from '../../../server/services/report-version.service';
import { base64UrlEncode } from '../../../server/services/signing-key.service';
import { sha256Hex } from '../../../server/lib/sha256';
import type { PackKey } from '../../../server/lib/esign/chain-verify';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = '00000000-0000-0000-0000-0000000000d1';
const TOKEN = 'verify-token-1';
const ENCRYPTION_SECRET = 'unit-test-key-encryption-secret-32b';

describe('report version verification archived-key fallback', () => {
    let db: any;
    let testD1: ReturnType<typeof lazyD1>;
    let svc: ReportVersionService;
    let archivedKeys: PackKey[];
    let goodSignature: string;
    let contentHash: string;

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db;
        await setupSchema(fx.sqlite);
        testD1 = lazyD1();
        testD1.use(db);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-06-01',
            createdAt: new Date(), reportStatus: 'published',
        } as never);
        await db.insert(schema.reports).values({
            id: 'report-1', tenantId: TENANT, inspectionId: INSP, kind: 'primary',
            title: 'Report', status: 'published', createdAt: new Date(),
        } as never);

        // A source key pair, retired from the live key table (restored report).
        const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
        const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey) as ArrayBuffer);
        const fingerprint = await sha256Hex(spki);
        const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`;
        archivedKeys = [{ fingerprint, pem }];
        // Sign exactly what verifyByToken verifies: UTF-8 bytes of the hash text.
        const snapshotJson = JSON.stringify({ schemaVersion: 2, inspection: {}, data: {} });
        contentHash = await sha256Hex(snapshotJson);
        const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(contentHash));
        goodSignature = base64UrlEncode(new Uint8Array(sig));

        await db.insert(schema.reportVersions).values({
            id: 'rv-1', tenantId: TENANT, inspectionId: INSP, reportId: 'report-1',
            versionNumber: 1, snapshotJson, contentHash, signature: goodSignature,
            keyFingerprint: fingerprint, verificationToken: TOKEN,
            publishedAt: new Date(), publishedBy: 'owner-1', createdAt: new Date(),
        } as never);
        svc = new ReportVersionService(testD1.binding, ENCRYPTION_SECRET, []);
    });

    it('verifies the signature from the archived key when the live key is absent', async () => {
        expect((await svc.verifyByToken(TOKEN))!.keyMissing).toBe(true); // no live key, no archive passed
        const result = await svc.verifyByToken(TOKEN, archivedKeys);
        expect(result).not.toBeNull();
        expect(result!.hashValid).toBe(true);
        expect(result!.keyMissing).toBe(false);
        expect(result!.signatureValid).toBe(true);
    });

    it('still fails verification with a tampered signature even with the key', async () => {
        const bad = base64UrlEncode(new Uint8Array(32).fill(0));
        await db.update(schema.reportVersions).set({ signature: bad }).where(eq(schema.reportVersions.verificationToken, TOKEN));
        const result = await svc.verifyByToken(TOKEN, archivedKeys);
        expect(result!.signatureValid).toBe(false);
        expect(result!.keyMissing).toBe(false); // key found; signature itself failed
    });

    it('does not fabricate verification when no archived key matches', async () => {
        const other = [{ fingerprint: 'f'.repeat(64), pem: archivedKeys[0]!.pem }];
        const result = await svc.verifyByToken(TOKEN, other);
        expect(result!.keyMissing).toBe(true);
        expect(result!.signatureValid).toBe(false);
    });
});
