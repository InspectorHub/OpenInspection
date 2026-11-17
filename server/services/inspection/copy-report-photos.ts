/**
 * Copies the photo objects a report copy refers to: new objects under the new report's own
 * prefix, never the source's keys.
 *
 * Why objects and not keys: the photo route only serves keys under the requesting inspection's
 * prefix, and deleting an inspection removes everything under its prefix. A copy pointing at the
 * source's keys would not display and would lose its photos when the source is deleted.
 *
 * Properties, each pinned by a test:
 *   - The source is only read. Nothing under its prefix is written or deleted.
 *   - Only `{tenant}/inspections/{source}/photos/` is read, and only file names of the photo
 *     family (an image, or a baked variant of one). Agreements, documents, covers and exports that
 *     sit beside the photos are never copied, whatever a results document claims.
 *   - Destination ids are derived from (new inspection, source key), so the same plan always
 *     lands on the same keys and an object already there with the right size is not written again.
 *     That makes one run safe to repeat; the product does NOT offer a way to continue a copy.
 *   - A photo that fails is removed completely (every destination key it had), counted, and not
 *     linked. Entries sharing one source key share one destination object and fail together.
 *   - A run is bounded by a storage-call budget, not a photo count, and the budget binds the first
 *     photo as much as any other. What does not fit is reported as deferred and is not copied.
 *   - Nothing that is silently missing counts as complete: skipped photo-like entries (an old key
 *     layout) and baked variants that were dropped are counted next to deferred and failed ones.
 *   - Only the content type travels with an object; a stored file name or other metadata does not.
 */
import type { PhotoEntry } from '@core/field-ui/shared/results-doc.types';
import { DERIVATIVE_NAME, PHOTO_FILENAME, r2Keys } from '../../lib/r2-keys';
import { logger } from '../../lib/logger';

/** Storage calls one object can cost: two heads, a get and a put, plus the delete that removes it again when the copy fails. */
export const CALLS_PER_OBJECT = 5;
/**
 * Storage calls one copy may spend: six plain photos, or two photos with two baked variants each.
 *
 * THE PREMISE IS UNMEASURED. This repository states two different things about a Worker invocation's
 * allowance: about 50 subrequests on the free plan (the orphan sweep's call budget), and 1000 with
 * bindings (D1, R2, KV) counted against it and a fixed overhead of about 70 (`lib/native/import-limits.ts`).
 * Neither has been measured for this route, which needs workerd. Until it is, the conservative reading
 * is used, and the database work of the copy (about 15 statements) and of a rollback is on top of this.
 */
export const MAX_STORAGE_CALLS_PER_RUN = 30;
const CONCURRENCY = 4;

export interface PhotoCopyPlan {
    tenantId: string;
    sourceInspectionId: string;
    targetInspectionId: string;
    /** Storage calls this run may spend; defaults to `MAX_STORAGE_CALLS_PER_RUN`. */
    maxCalls?: number;
}

/** The new keys of one copied photo; merged over the source entry so its other fields (crop transform, annotations) stay. */
export interface CopiedPhotoKeys {
    key: string;
    croppedKey?: string;
    annotatedKey?: string;
    mediaId?: string;
}

export interface PhotoCopyOutcome {
    /** By `photoIdentity` of the SOURCE entry. */
    copies: Map<string, CopiedPhotoKeys>;
    copied: number;
    failed: number;
    /** Entries that were not copied for any reason below, plus videos and uploads still pending (which are never copied). */
    skipped: number;
    /** Of those, entries that look like a photo but are not under the source's `photos/` folder (an older key layout, another folder). */
    unsupported: number;
    /** Baked variants (cropped, annotated) that were not copied: refused key, missing, or failed. Counted once per entry that carried one. */
    droppedVariants: number;
    deferred: number;
}

/** What makes two source entries the same photo. */
export function photoIdentity(entry: PhotoEntry): string {
    return [entry.key, entry.croppedKey ?? '', entry.annotatedKey ?? ''].join('|');
}

/** A video, an upload still waiting on the device, or an entry with no object at all is not something to copy. */
function isCopyablePhoto(entry: PhotoEntry): boolean {
    return Boolean(entry.key) && entry.mediaType !== 'video' && !entry.pendingUpload;
}

async function deterministicMediaId(targetInspectionId: string, sourceKey: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${targetInspectionId}\n${sourceKey}`));
    const hex = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function extensionOf(key: string): string {
    const ext = /\.([A-Za-z0-9]{2,5})$/.exec(key)?.[1]?.toLowerCase();
    return ext ?? 'jpg';
}

/** `{mediaId}.annotated|cropped[.{rev}].png|jpg`: what follows the media id, to be kept under the new id. */
const VARIANT_SUFFIX = /^[^/.]+(\.(?:annotated|cropped)(?:\.[0-9a-f]{8})?\.(?:png|jpg))$/;

class MissingSource extends Error {}

interface Group { key: string; entries: PhotoEntry[] }

export async function copyPhotoEntries(r2: R2Bucket, plan: PhotoCopyPlan, entries: readonly PhotoEntry[]): Promise<PhotoCopyOutcome> {
    const { tenantId, sourceInspectionId: from, targetInspectionId: to } = plan;
    const sourcePhotos = r2Keys.inspectionPhotosPrefix(tenantId, from);
    const targetPrefix = r2Keys.inspectionPhotosPrefix(tenantId, to);
    const nameOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1);
    // Directly inside the photos folder, never in a sibling folder or a sub-folder, and a name of the photo family.
    const inPhotosFolder = (key: string): boolean => key.startsWith(sourcePhotos) && key.slice(sourcePhotos.length) === nameOf(key);
    const ownedPhoto = (key: string): boolean => inPhotosFolder(key) && PHOTO_FILENAME.test(nameOf(key));
    const ownedVariant = (key: string): boolean => inPhotosFolder(key) && DERIVATIVE_NAME.test(nameOf(key));

    const outcome: PhotoCopyOutcome = { copies: new Map(), copied: 0, failed: 0, skipped: 0, unsupported: 0, droppedVariants: 0, deferred: 0 };
    // One destination object per source key: entries that share a key (and differ only in their variants) are one group.
    const groups = new Map<string, Group>();
    const seen = new Set<string>();
    for (const entry of entries) {
        if (!isCopyablePhoto(entry)) { outcome.skipped++; continue; }
        if (!ownedPhoto(entry.key)) { outcome.skipped++; outcome.unsupported++; continue; }
        const identity = photoIdentity(entry);
        if (seen.has(identity)) continue;
        seen.add(identity);
        for (const variant of [entry.croppedKey, entry.annotatedKey]) if (variant && !ownedVariant(variant)) outcome.droppedVariants++;
        const group = groups.get(entry.key) ?? { key: entry.key, entries: [] };
        group.entries.push(entry);
        groups.set(entry.key, group);
    }

    // The budget is spent in order; what does not fit is deferred, never half done.
    const budget = plan.maxCalls ?? MAX_STORAGE_CALLS_PER_RUN;
    const work: Group[] = [];
    let spent = 0;
    for (const group of groups.values()) {
        const variants = new Set(group.entries.flatMap((e) => [e.croppedKey, e.annotatedKey]).filter((k): k is string => typeof k === 'string' && ownedVariant(k)));
        const cost = CALLS_PER_OBJECT * (1 + variants.size);
        if (spent + cost > budget) { outcome.deferred += group.entries.length; continue; }
        spent += cost;
        work.push(group);
    }

    /** Same size already there: this object was written by an earlier run of the same plan. */
    async function copyObject(source: string, target: string): Promise<void> {
        const head = await r2.head(source);
        if (!head) throw new MissingSource(source);
        const present = await r2.head(target);
        if (present && present.size === head.size) return;
        const object = await r2.get(source);
        if (!object) throw new MissingSource(source);
        const contentType = object.httpMetadata?.contentType;
        const written = await r2.put(target, object.body, contentType ? { httpMetadata: { contentType } } : {});
        if (written.size !== head.size) throw new Error('copied object has a different size than its source');
    }

    async function copyGroup(group: Group): Promise<void> {
        const mediaId = await deterministicMediaId(to, group.key);
        const baseKey = r2Keys.inspectionPhoto(tenantId, to, mediaId, extensionOf(group.key));
        try {
            await copyObject(group.key, baseKey);
        } catch (err) {
            await r2.delete(baseKey).catch(() => undefined);
            outcome.failed += group.entries.length;
            logger.warn('copy-report.photo.failed', { reason: err instanceof MissingSource ? 'missing' : 'error' });
            return;
        }
        const variantResults = new Map<string, string | null>();
        for (const entry of group.entries) {
            const keys: CopiedPhotoKeys = { key: baseKey };
            if (entry.mediaId) keys.mediaId = mediaId;
            for (const variant of ['croppedKey', 'annotatedKey'] as const) {
                const source = entry[variant];
                if (!source || !ownedVariant(source)) continue;
                if (!variantResults.has(source)) {
                    const suffix = VARIANT_SUFFIX.exec(nameOf(source))?.[1] ?? (variant === 'croppedKey' ? '.cropped.jpg' : '.annotated.png');
                    const target = `${targetPrefix}${mediaId}${suffix}`;
                    try {
                        await copyObject(source, target);
                        variantResults.set(source, target);
                    } catch (err) {
                        // A baked variant that is gone or fails costs the variant, not the photo: the original and the
                        // annotation shapes are still there to bake it again.
                        await r2.delete(target).catch(() => undefined);
                        variantResults.set(source, null);
                        logger.warn('copy-report.variant.failed', { variant, reason: err instanceof MissingSource ? 'missing' : 'error' });
                    }
                }
                const copiedVariant = variantResults.get(source);
                if (copiedVariant) keys[variant] = copiedVariant;
                else outcome.droppedVariants++;
            }
            outcome.copies.set(photoIdentity(entry), keys);
            outcome.copied++;
        }
    }

    let next = 0;
    async function worker(): Promise<void> {
        while (next < work.length) await copyGroup(work[next++]!);
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
    return outcome;
}
