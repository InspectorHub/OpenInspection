/**
 * Archive-backed evidence verification for imported envelopes.
 *
 * An inspection restored from a data package has NO live agreement/esign/key
 * rows — its evidence is a byte-identical archive in R2. This loader finds that
 * archive by the envelope id recorded in import_archives.sourceIds, reads the
 * original esign rows back, selects the chain for ONE envelope, and verifies it
 * with the same verifier a downloadable evidence pack uses. No live signing row
 * is read or written.
 *
 * The id used here is the SOURCE envelope id: e-sign evidence can only be
 * imported in the id-preserving mode, so it is unchanged by the restore.
 */
import { eq, and } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import type { R2Bucket } from '@cloudflare/workers-types';
import { importArchives, importIdMap } from '../../lib/db/schema/data-package';
import { r2Get } from '../../lib/r2/objects';
import { EVIDENCE_ARCHIVE_KEY } from './import-archive.service';
import { verifyEvidenceChainDetailed, type PackEvent, type PackKey, type ChainVerdict } from '../../lib/esign/chain-verify';

/** An original esign row as stored in the package's evidence file. */
export interface ArchivedEsignRow {
    id: string;
    request_id: string;
    event: string;
    payload_json: string;
    prev_hash: string | null;
    hash: string;
    signature: string;
    key_fingerprint: string;
    created_at: number;
}

export interface ArchivedEvidence {
    events: ArchivedEsignRow[];
    keys: PackKey[];
}

/** Load the archive bytes for an envelope, or null if this tenant never archived it. */
export async function loadArchivedEvidence(
    db: ReturnType<typeof drizzle>, bucket: R2Bucket, tenantId: string | null, envelopeId: string,
): Promise<ArchivedEvidence | null> {
    // A public verifier has no tenant context (the envelope id is globally
    // unique), so fall back to scanning the ledger for the one archive whose
    // source ids name this envelope. Only digests/ids are read; no PII.
    const rows = tenantId
        ? await db.select().from(importArchives).where(eq(importArchives.tenantId, tenantId)).all()
        : await db.select().from(importArchives).all();
    const match = rows.find((r) => {
        if (!r.sourceIds) return false;
        try {
            const ids = JSON.parse(r.sourceIds) as unknown;
            return Array.isArray(ids) && ids.includes(envelopeId);
        } catch { return false; }
    });
    if (!match) return null;
    const obj = await r2Get(bucket, EVIDENCE_ARCHIVE_KEY(match.tenantId, match.packageId));
    if (!obj) return null;
    try {
        const parsed = JSON.parse(await obj.text()) as Partial<ArchivedEvidence>;
        return {
            events: Array.isArray(parsed.events) ? parsed.events : [],
            keys: Array.isArray(parsed.keys) ? parsed.keys : [],
        };
    } catch { return null; }
}

/**
 * Whether this tenant holds at least one VERIFIED archived evidence chain.
 * Used by the release gate: for an imported inspection (whose agreement was
 * archived byte-for-byte rather than written to the live table) a valid
 * archived signature counts as the signed leg — without unlocking or writing
 * any live signing row.
 */
async function hasValidArchivedEvidence(
    db: ReturnType<typeof drizzle>, bucket: R2Bucket, tenantId: string,
): Promise<boolean> {
    const archives = await db.select().from(importArchives)
        .where(eq(importArchives.tenantId, tenantId)).all();
    for (const archive of archives) {
        let ids: unknown;
        try { ids = archive.sourceIds ? JSON.parse(archive.sourceIds) : []; } catch { continue; }
        if (!Array.isArray(ids) || ids.length === 0) continue;
        const obj = await r2Get(bucket, EVIDENCE_ARCHIVE_KEY(tenantId, archive.packageId));
        if (!obj) continue;
        try {
            const parsed = JSON.parse(await obj.text()) as Partial<ArchivedEvidence>;
            const events = Array.isArray(parsed.events) ? parsed.events : [];
            // One valid signed envelope is enough to count the archived leg as
            // signed for this workspace's restored inspections.
            const signedIds = ids.filter((id) => typeof id === 'string');
            for (const envelopeId of signedIds) {
                const chain = events.filter((e) => e.request_id === envelopeId).map((e): PackEvent => ({
                    id: e.id, event: e.event, payloadJson: e.payload_json,
                    prevHash: e.prev_hash, hash: e.hash, signature: e.signature,
                    keyFingerprint: e.key_fingerprint,
                }));
                if (chain.length === 0) continue;
                const verdict = await verifyEvidenceChainDetailed(chain, parsed.keys ?? []);
                const signed = chain.some((e) => e.event === 'agreement.signed' || e.event === 'signer.signed' || e.event === 'agreement.inspector_signed');
                if (verdict.problems.length === 0 && signed) return true;
            }
        } catch { /* a corrupt archive counts as no evidence */ }
    }
    return false;
}

/**
 * Whether an inspection is a restored copy whose agreement leg is satisfied by
 * a VERIFIED archived signature. Combines the J14 import marker with the J5
 * archived-evidence check so callers (the release gate) do not need to know the
 * ledger shape.
 */
export async function isImportedAndArchivedSigned(
    db: ReturnType<typeof drizzle>, bucket: R2Bucket | undefined, tenantId: string, inspectionId: string,
): Promise<boolean> {
    if (!bucket) return false;
    const imported = await db.select({ id: importIdMap.id }).from(importIdMap).where(and(
        eq(importIdMap.tenantId, tenantId),
        eq(importIdMap.tableName, 'inspections'),
        eq(importIdMap.newId, inspectionId),
    )).limit(1);
    if (imported.length === 0) return false;
    return hasValidArchivedEvidence(db, bucket, tenantId);
}

/** Verify the chain of ONE envelope inside an archived evidence file. */
export async function verifyArchivedEnvelope(
    db: ReturnType<typeof drizzle>, bucket: R2Bucket, tenantId: string | null, envelopeId: string,
): Promise<{ verdict: ChainVerdict; events: number } | null> {
    const archive = await loadArchivedEvidence(db, bucket, tenantId, envelopeId);
    if (!archive) return null;
    const chain = archive.events
        .filter((e) => e.request_id === envelopeId)
        .map((e): PackEvent => ({
            id: e.id, event: e.event, payloadJson: e.payload_json,
            prevHash: e.prev_hash, hash: e.hash, signature: e.signature,
            keyFingerprint: e.key_fingerprint,
        }));
    const verdict = await verifyEvidenceChainDetailed(chain, archive.keys);
    return { verdict, events: chain.length };
}
