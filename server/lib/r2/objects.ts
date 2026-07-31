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

export async function r2Delete(bucket: R2Bucket, keys: string | string[]): Promise<void> {
    await bucket.delete(keys);
}
