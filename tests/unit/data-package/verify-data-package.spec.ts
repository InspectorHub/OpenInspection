/**
 * E-4 offline verifier tests.
 *
 * Builds a minimal format-1 package with the SAME @inspectorhub/data-package
 * encoders the exporter uses (so a verifier cannot agree with a fixture about
 * a format neither implements), then proves the verifier accepts a good package and
 * refuses a tampered one. The verifier re-reads bytes from disk; it must not
 * trust the manifest's word for a digest.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import * as dp from '@core/data-package';
// @ts-expect-error - the verifier is a plain .mjs script with no .d.ts
import { verifyDataPackage as rawVerify } from '../../../scripts/verify-data-package.mjs';

// The verifier is a plain .mjs CLI (no .d.ts); give its report a local shape.
interface Check { name: string; ok: boolean; detail?: string }
interface Report { ok: boolean; checks: Check[]; failures: { name: string; detail: string }[] }
const verifyDataPackage = rawVerify as (dir: string, lib: typeof dp) => Promise<Report>;

const empty = new Uint8Array(0);

async function makePackage(over: { tamperChecksum?: boolean; tamperRow?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'dp-verify-'));
    const row = dp.encodeNdjsonRow({ id: 'insp-1', address: '1 Test Road' });
    const fileSha = await dp.sha256Hex(row);
    const indexSha = await dp.sha256Hex(empty);
    const manifestBytes = dp.serializeManifest({
        formatVersion: 1,
        schemaVersion: '0012_tenant_data_jobs',
        columnFingerprint: 'a'.repeat(64),
        engineVersion: '2.6.0',
        packageId: '3f2c0a8e-1111-4222-8333-444455556666',
        exportedAt: '2026-11-17T12:00:00.000Z',
        sourceMode: 'standalone',
        sourceTenantId: 'tenant-1',
        sourceHost: null,
        encryption: null,
        counts: { inspections: 1 },
        media: { count: 0, index: { path: dp.DATA_PACKAGE_MEDIA_INDEX_ENTRY, bytes: 0, sha256: indexSha } },
        files: [{ path: 'data/inspections.ndjson', volume: dp.ROOT_VOLUME_NAME, rows: 1, bytes: row.length, sha256: fileSha }],
        volumes: [],
        excluded: [],
    });
    const manifest = dp.parseManifest(manifestBytes);
    let checksums = dp.generateChecksums([
        { path: 'data/inspections.ndjson', sha256: fileSha },
        { path: dp.DATA_PACKAGE_MEDIA_INDEX_ENTRY, sha256: indexSha },
    ]);
    if (over.tamperChecksum) checksums = checksums.replace(fileSha, '0'.repeat(64));

    const dataBytes = over.tamperRow ? dp.encodeNdjsonRow({ id: 'insp-1', address: 'TAMPERED' }) : row;
    // The root volume stores the manifest.json that the verifier will also compare
    // against the directory copy. checksums.sha256 is the (possibly tampered) text.
    const rootZip = zipSync({
        'manifest.json': manifestBytes,
        'checksums.sha256': strToU8(checksums),
        'data/inspections.ndjson': dataBytes,
        [dp.DATA_PACKAGE_MEDIA_INDEX_ENTRY]: empty,
    });
    writeFileSync(join(dir, 'manifest.json'), manifestBytes);
    writeFileSync(join(dir, dp.ROOT_VOLUME_NAME), rootZip);
    return { dir, manifest, fileSha };
}

describe('verifyDataPackage', () => {
    it('accepts a well-formed package and runs real checks', async () => {
        const { dir } = await makePackage();
        const report = await verifyDataPackage(dir, dp);
        expect(report.failures).toEqual([]);
        expect(report.ok).toBe(true);
        expect(report.checks.length).toBeGreaterThanOrEqual(6);
        expect(report.checks.some((c) => c.name.startsWith('file '))).toBe(true);
        expect(report.checks.some((c) => c.name.includes('media index'))).toBe(true);
    });

    it('refuses a package whose checksums disagree with the manifest', async () => {
        const { dir } = await makePackage({ tamperChecksum: true });
        const report = await verifyDataPackage(dir, dp);
        expect(report.ok).toBe(false);
        expect(report.failures.some((f) => f.name.includes('checksums'))).toBe(true);
    });

    it('refuses a package whose file bytes do not match the declared digest', async () => {
        const { dir } = await makePackage({ tamperRow: true });
        const report = await verifyDataPackage(dir, dp);
        expect(report.ok).toBe(false);
        expect(report.failures.some((f) => f.name.includes('data/inspections.ndjson'))).toBe(true);
    });

    it('refuses a directory with no manifest rather than reporting zero checks as a pass', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'dp-verify-empty-'));
        await expect(verifyDataPackage(dir, dp)).rejects.toThrow(/manifest\.json missing/);
    });
});
