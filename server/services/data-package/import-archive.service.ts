/**
 * Import-archive service for the data-package importer.
 *
 * Stores a package's e-sign/history evidence as a BYTE-IDENTICAL R2 object under
 * `evidence-archives/<tenantId>/<packageId>/` plus an import_archives ledger row
 * (sha256, counts, source ids). Verification runs the SAME chain verifier a
 * downloadable evidence pack uses, over the parsed rows — no live signing table
 * is written and no key is relinked. The target's own signing keys are untouched.
 *
 * A tampered chain is still archived verbatim (the bytes are the evidence); the
 * verification verdict is reported so the viewer and audit can show the problems.
 * A (tenant, package) already archived is skipped, making a retry idempotent.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../lib/db/scoped';
import type { R2Bucket } from '@cloudflare/workers-types';
import { importArchives } from '../../lib/db/schema/data-package';
import { verifyEvidenceChainDetailed, type PackEvent, type PackKey, type ChainVerdict } from '../../lib/esign/chain-verify';
import { sha256Hex } from '../../lib/sha256';

export interface ArchiveImportDeps {
    now: () => number;
    genId: () => string;
}

export type ArchiveResult =
    | { ok: true; verdict: ChainVerdict; sha256: string; key: string }
    | { ok: false; code: 'already_archived' | 'write_failed' };

export const EVIDENCE_ARCHIVE_KEY = (tenantId: string, packageId: string): string =>
    `evidence-archives/${tenantId}/${packageId}/`;

export class DataPackageArchiveImportService {
    constructor(
        private readonly db: DrizzleDB,
        private readonly bucket: R2Bucket,
        private readonly deps: ArchiveImportDeps,
    ) {}

    async archive(
        tenantId: string,
        packageId: string,
        events: readonly PackEvent[],
        keys: readonly PackKey[],
        bytes: Uint8Array,
        sourceIds: readonly string[],
    ): Promise<ArchiveResult> {
        // 1. Idempotency: one ledger row per (tenant, package).
        const existing = await this.db.select({ id: importArchives.id }).from(importArchives).where(and(
            eq(importArchives.tenantId, tenantId), eq(importArchives.packageId, packageId),
        )).limit(1).all();
        if (existing.length > 0) return { ok: false, code: 'already_archived' };

        // 2. Verify the chain with the same verifier as a downloadable pack.
        const verdict = await verifyEvidenceChainDetailed(events, keys);
        const sha = await sha256Hex(bytes);

        // 3. Store the bytes verbatim. A problem in the chain is reported, not a
        // reason to discard the evidence — the bytes ARE the preserved record.
        const key = EVIDENCE_ARCHIVE_KEY(tenantId, packageId);
        try {
            await this.bucket.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
        } catch {
            return { ok: false, code: 'write_failed' };
        }

        // 4. Ledger row: digests/counts/ids only, never row content.
        await this.db.insert(importArchives).values([{
            id: this.deps.genId(), tenantId, packageId, sha256: sha,
            counts: JSON.stringify({ events: events.length, keys: keys.length }),
            sourceIds: JSON.stringify([...sourceIds]),
            createdAt: new Date(this.deps.now()),
        }]).run();

        return { ok: true, verdict, sha256: sha, key };
    }
}
