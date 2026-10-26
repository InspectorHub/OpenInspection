/**
 * Thin R2 object helpers — the public surface for bucket I/O.
 *
 * Call sites in `server/api/**` must not touch `c.env.PHOTOS` / `EXPORTS_BUCKET`
 * bindings directly; go through a service that uses these helpers, or call
 * them here. The `lint:provider-helpers` gate freezes existing binding hits
 * and fails on new ones (`scripts/check-provider-helpers.mjs`).
 *
 * Wrapping rather than re-implementing: these are one-liners so metering,
 * key-prefix policy, and content-type defaults can grow in ONE place later
 * without hunting every `bucket.put`.
 */
export async function r2Put(
    bucket: R2Bucket,
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions,
): Promise<R2Object> {
    return bucket.put(key, value, options);
}

export async function r2Get(
    bucket: R2Bucket,
    key: string,
    options?: R2GetOptions,
): Promise<R2ObjectBody | null> {
    return bucket.get(key, options);
}

export async function r2Head(bucket: R2Bucket, key: string): Promise<R2Object | null> {
    return bucket.head(key);
}

export async function r2Delete(bucket: R2Bucket, keys: string | string[]): Promise<void> {
    await bucket.delete(keys);
}

/** Open a multipart upload. Needs a real R2 smoke check: every part but the last must be the same size and at least 5 MiB. */
export async function r2CreateMultipart(
    bucket: R2Bucket,
    key: string,
    options?: R2MultipartOptions,
): Promise<R2MultipartUpload> {
    return bucket.createMultipartUpload(key, options);
}

/** Re-attach to an open multipart upload from a later request; the handle carries no state of its own. */
export function r2ResumeMultipart(bucket: R2Bucket, key: string, uploadId: string): R2MultipartUpload {
    return bucket.resumeMultipartUpload(key, uploadId);
}
