/**
 * Which document a client-facing PDF is made from.
 *
 * What a client is sent or shown is the report's latest PUBLISHED version, however the inspector's working
 * copy has moved since. This answers the two things a render needs to say so: the version to pin the render
 * to (it travels in the signed render token) and the hash the stored render is cached under. The version's
 * own hash is preferred, which is the key its download and the verify page use, so one stored render serves
 * all three. A report with no frozen version renders live and is keyed by the live hash, as it always was.
 */
import { loadLatestPublishedRef, type SnapshotDb } from './report-snapshot';

export interface ClientPdfTarget {
    /** The published version to render, or null when none has been frozen. */
    versionNumber: number | null;
    contentHash: string;
}

export async function resolveClientPdfTarget(
    db: SnapshotDb,
    tenantId: string,
    inspectionId: string,
    /** The render-cache hash of the report as read at `versionNumber` (absent: live). */
    hashOf: (versionNumber: number | undefined) => Promise<string>,
): Promise<ClientPdfTarget> {
    const published = await loadLatestPublishedRef(db, tenantId, inspectionId);
    if (!published) return { versionNumber: null, contentHash: await hashOf(undefined) };
    return {
        versionNumber: published.versionNumber,
        contentHash: published.contentHash ?? await hashOf(published.versionNumber),
    };
}
