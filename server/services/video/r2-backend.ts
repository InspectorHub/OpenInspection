/**
 * R2 implementation of VideoBackend.
 *
 * Videos are stored directly in the PHOTOS R2 bucket using the key convention
 * from `server/lib/r2-keys.ts`. Unlike the Stream backend, R2 objects are
 * immediately readable once the upload completes — `getDetails` reflects this
 * with an instant `readyToStream: true` (confirmed via a HEAD check).
 *
 * Ownership enforcement:
 *   - `createUpload`: token claims carry tenantId + inspectionId + mediaId.
 *   - `finalize`: inspectionId is parsed from the canonical r2Key (the route
 *     handler verifies the token BEFORE calling finalize, so the key was minted
 *     by this backend for this tenant).
 *   - `delete`: tenant-guard via the inspection_media_pool row (r2Key + tenantId).
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspectionMediaPool } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { r2Keys } from '../../lib/r2-keys';
import { signUploadToken } from '../../lib/video-upload-token';
import type { VideoBackend, VideoDetails, VideoRef } from './types';

// ── Key parsing helper ────────────────────────────────────────────────────────

interface ParsedVideoKey {
    tenantId: string;
    inspectionId: string;
    mediaId: string;
    ext: string;
}

/**
 * Parse a video R2 key back into its logical components.
 *
 * Expected shape: `{tenantId}/inspections/{inspectionId}/videos/{mediaId}.{ext}`
 *
 * Returns `null` when the key does not match this shape (fail-closed: finalize
 * will throw rather than inserting a row with a garbage inspectionId).
 */
export function parseInspectionVideoKey(r2Key: string): ParsedVideoKey | null {
    // Match: <tenantId>/inspections/<inspectionId>/videos/<mediaId>.<ext>
    const match = /^([^/]+)\/inspections\/([^/]+)\/videos\/([^/.]+)\.([^/]+)$/.exec(r2Key);
    if (!match) return null;
    const [, tenantId, inspectionId, mediaId, ext] = match;
    return { tenantId, inspectionId, mediaId, ext };
}

// ── R2VideoBackend ────────────────────────────────────────────────────────────

export class R2VideoBackend implements VideoBackend {
    /**
     * @param photos      The `env.PHOTOS` R2 bucket binding.
     * @param db          Drizzle D1 database instance.
     * @param tenantId    Caller's tenant (from JWT — never from request body).
     * @param jwtSecret   Signing secret for the upload token (env.JWT_SECRET).
     * @param appOrigin   App base URL used to build the upload endpoint URL.
     */
    constructor(
        private readonly photos: R2Bucket,
        private readonly db: DrizzleD1Database,
        private readonly tenantId: string,
        private readonly jwtSecret: string,
        private readonly appOrigin: string,
    ) {}

    /**
     * Mint a one-shot upload URL backed by a signed token.
     *
     * The token carries `{ tenantId, inspectionId, mediaId }` and is valid for
     * 15 minutes. The route handler that handles the PUT validates the token
     * before streaming bytes into R2 — the worker never forwards untrusted keys
     * to the bucket.
     */
    async createUpload(inspectionId: string): Promise<{ uploadURL: string; ref: VideoRef }> {
        const mediaId = crypto.randomUUID();

        const token = await signUploadToken(
            { tenantId: this.tenantId, inspectionId, mediaId },
            900, // 15 minutes
            this.jwtSecret,
        );

        // Extension is a placeholder; the actual PUT handler sets the real ext
        // from the Content-Type header and may rewrite the key at that point.
        const r2Key = r2Keys.inspectionVideo(this.tenantId, inspectionId, mediaId, 'mp4');

        const uploadURL = `${this.appOrigin}/api/inspections/${inspectionId}/media/video/r2-upload?token=${token}`;

        logger.info('R2VideoBackend: created upload slot', {
            tenantId: this.tenantId,
            inspectionId,
            mediaId,
            r2Key,
        });

        return {
            uploadURL,
            ref: { provider: 'r2', mediaId, r2Key },
        };
    }

    /**
     * Finalize an R2 upload: insert an inspection_media_pool row.
     *
     * Idempotent on `r2Key + tenantId`: if a row for this key already exists
     * (e.g. a retry), the existing poolId is returned without a second INSERT.
     *
     * `inspectionId` is derived from the r2Key via `parseInspectionVideoKey`
     * rather than a constructor field, consistent with the design rule that the
     * backend derives ownership context from the authoritative artefact (the
     * signed key), not a caller-supplied argument.
     */
    async finalize(ref: VideoRef, posterRef?: { posterKey: string }): Promise<{ poolId: string }> {
        if (ref.provider !== 'r2') {
            throw Errors.BadRequest('R2VideoBackend.finalize called with non-r2 ref');
        }

        const parsed = parseInspectionVideoKey(ref.r2Key);
        if (!parsed) {
            throw Errors.BadRequest(`R2VideoBackend.finalize: r2Key does not match expected shape: ${ref.r2Key}`);
        }
        if (parsed.tenantId !== this.tenantId) {
            // Fail closed — a cross-tenant key must never create a row.
            throw Errors.NotFound('Video not found');
        }

        const { inspectionId } = parsed;
        const posterKey = posterRef?.posterKey ?? null;

        // Idempotency check: return existing poolId if the row already exists.
        const existing = await this.db
            .select({ id: inspectionMediaPool.id })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.r2Key, ref.r2Key),
                eq(inspectionMediaPool.tenantId, this.tenantId),
            ))
            .get();

        if (existing) {
            logger.info('R2VideoBackend: finalize idempotent hit', {
                tenantId: this.tenantId,
                poolId: existing.id,
                r2Key: ref.r2Key,
            });
            return { poolId: existing.id };
        }

        const poolId = crypto.randomUUID();
        await this.db.insert(inspectionMediaPool).values({
            id: poolId,
            inspectionId,
            tenantId: this.tenantId,
            provider: 'r2',
            r2Key: ref.r2Key,
            posterKey,
            url: '',        // R2 URLs are served via the worker — no CDN URL stored
            streamUid: null,
            uploadedAt: new Date(),
            mediaType: 'video',
        });

        logger.info('R2VideoBackend: finalized video', {
            tenantId: this.tenantId,
            inspectionId,
            poolId,
            r2Key: ref.r2Key,
        });

        return { poolId };
    }

    /**
     * R2 objects are immediately playable once the PUT completes.
     * Returns `{ readyToStream: true }` when the object exists in the bucket,
     * `{ readyToStream: false }` when it does not (upload pending or evicted).
     */
    async getDetails(ref: VideoRef): Promise<VideoDetails> {
        if (ref.provider !== 'r2') {
            throw Errors.BadRequest('R2VideoBackend.getDetails called with non-r2 ref');
        }
        const head = await this.photos.head(ref.r2Key);
        return { readyToStream: head !== null };
    }

    /**
     * Delete the video from R2 (and its poster if present) and drop the
     * inspection_media_pool row.
     *
     * Tenant-guard: looks up the pool row by r2Key + tenantId before touching
     * R2. A guessed or cross-tenant r2Key cannot be deleted even without
     * R2-level ACLs.
     */
    async delete(ref: VideoRef): Promise<void> {
        if (ref.provider !== 'r2') {
            throw Errors.BadRequest('R2VideoBackend.delete called with non-r2 ref');
        }

        // Tenant-guarded pool row lookup.
        const row = await this.db
            .select({ id: inspectionMediaPool.id, posterKey: inspectionMediaPool.posterKey })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.r2Key, ref.r2Key),
                eq(inspectionMediaPool.tenantId, this.tenantId),
            ))
            .get();

        if (!row) {
            // 404, not 403 — do not reveal that the key exists in another tenant.
            throw Errors.NotFound('Video not found');
        }

        // Delete clip from R2.
        await this.photos.delete(ref.r2Key);

        // Delete poster from R2 if one was stored.
        if (row.posterKey) {
            await this.photos.delete(row.posterKey);
        }

        // Drop the pool row.
        await this.db
            .delete(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, row.id),
                eq(inspectionMediaPool.tenantId, this.tenantId),
            ));

        logger.info('R2VideoBackend: deleted video', {
            tenantId: this.tenantId,
            r2Key: ref.r2Key,
            posterKey: row.posterKey,
            poolId: row.id,
        });
    }
}
