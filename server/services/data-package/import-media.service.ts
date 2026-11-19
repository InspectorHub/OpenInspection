/**
 * Import media service for the data-package importer.
 *
 * Copies one media object's bytes from a verified package into R2 under the
 * TARGET tenant. In keep-ids mode (empty target whose id equals the source)
 * the source key is preserved — its prefix already IS the target tenant, and
 * changing it would break the signed Yjs state that embeds the key. In rewrite
 * mode a fresh key is minted under the target tenant; the source key never
 * decides where bytes land.
 *
 * Per-item failures (checksum mismatch, unsafe key) reject only that object so
 * the import continues (D10). A source key already mapped is skipped, making a
 * retry idempotent. The provider verifies the sha256 on write when supported.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../lib/db/scoped';
import type { R2Bucket } from '@cloudflare/workers-types';
import { importIdMap } from '../../lib/db/schema/data-package';
import { sha256Hex } from '../../lib/sha256';
import { photoMediaId, PHOTO_FILENAME } from '../../lib/r2-keys';

export interface MediaRow {
    key: string;
    entry: string;
    bytes: number;
    sha256: string;
    volume: string;
    content_type: string;
    referenced_by: readonly { table: string; id: string }[];
}

export interface MediaImportDeps {
    now: () => number;
    genId: () => string;
    keepIds: boolean;
}

export type MediaImportResult =
    | { ok: true; newKey: string; sha256: string }
    | { ok: false; code: 'checksum_mismatch' | 'unsafe_key' | 'already_imported' | 'write_failed' };

/** Only accept the known photo/document key shape; never trust a crafted path. */
function safeSourceKey(key: string): boolean {
    if (key.length === 0 || key.length > 1024) return false;
    if (key.includes('..') || key.includes('\\') || key.includes('\0')) return false;
    return /^[A-Za-z0-9_\-/]+\.[A-Za-z0-9]{1,5}$/.test(key);
}

export class DataPackageMediaImportService {
    constructor(
        private readonly db: DrizzleDB,
        private readonly bucket: R2Bucket,
        private readonly deps: MediaImportDeps,
    ) {}

    async importOne(
        tenantId: string,
        packageId: string,
        row: MediaRow,
        bytes: Uint8Array,
    ): Promise<MediaImportResult> {
        // 1. Idempotency: an already-mapped source key is skipped.
        const existing = await this.db.select({ newId: importIdMap.newId }).from(importIdMap).where(and(
            eq(importIdMap.tenantId, tenantId), eq(importIdMap.packageId, packageId),
            eq(importIdMap.tableName, '__media'), eq(importIdMap.sourceId, row.key),
        )).limit(1).all();
        if (existing.length > 0) return { ok: false, code: 'already_imported' };

        if (!safeSourceKey(row.key)) return { ok: false, code: 'unsafe_key' };

        // 2. Verify the package-supplied digest against the actual bytes.
        const sha = await sha256Hex(bytes);
        if (sha !== row.sha256 || bytes.length !== row.bytes) {
            return { ok: false, code: 'checksum_mismatch' };
        }

        // 3. Destination key. keep-ids keeps the source key; rewrite mints one
        // under the target tenant using a fresh inspection id.
        let newKey = row.key;
        if (!this.deps.keepIds) {
            const mediaId = photoMediaId(row.key) ?? this.deps.genId();
            const ext = row.key.split('.').pop() ?? 'bin';
            newKey = `${tenantId}/inspections/${this.deps.genId()}/photos/${mediaId}.${ext}`;
            if (!PHOTO_FILENAME.test(`${mediaId}.${ext}`)) return { ok: false, code: 'unsafe_key' };
        } else if (!newKey.startsWith(`${tenantId}/`)) {
            // keep-ids precondition guarantees the prefixes match; refuse if not.
            return { ok: false, code: 'unsafe_key' };
        }

        // 4. Write with the R2 checksum option when available; the provider
        // rejects a body that does not match, a second line of defence.
        try {
            await this.bucket.put(newKey, bytes, {
                sha256: sha,
                httpMetadata: { contentType: row.content_type },
            } as { sha256: string; httpMetadata: { contentType: string } });
        } catch {
            return { ok: false, code: 'write_failed' };
        }

        // 5. Record the mapping so a retry skips and revert can find it.
        await this.db.insert(importIdMap).values([{
            id: `map:${this.deps.genId()}`, tenantId, packageId, tableName: '__media',
            sourceId: row.key, newId: newKey, createdAt: new Date(this.deps.now()),
        }]).run();

        return { ok: true, newKey, sha256: sha };
    }
}
