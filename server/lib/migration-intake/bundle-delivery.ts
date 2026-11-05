import { Errors } from '../errors';

/**
 * How a converted bundle reaches the staging step when it is too large to ride
 * inside a queue message.
 *
 * A command may carry the bundle inline (`bundle`) or a reference to a staged
 * object (`bundleRef`). The reference is an object in the shared exports bucket
 * whose key is derived from the command's own tenant, run and content hash, so
 * the receiver can check, before it reads anything, that the object belongs to
 * the run the command names.
 */

/**
 * The largest bundle a delivery will carry, in bytes of its JSON text.
 *
 * Set from a measurement, not a guess: a single-template bundle of this order
 * stages into `migration_rows` as one row whose payload is the template's JSON,
 * and that row has to fit D1's documented 2,000,000-byte string/row limit. A
 * local D1 accepted a payload of about 2.14 MB and refused one of about 2.31 MB;
 * the documented production limit is lower, so the ceiling sits below IT with
 * margin for the other columns of the row.
 *
 * The sending side holds a copy of this number. Both copies are asserted equal
 * to `tests/fixtures/migration-delivery/bundle-limits.json`, a file kept byte-identical
 * in both repositories, so a change here fails a test instead of letting one
 * side accept what the other refuses.
 */
export const BUNDLE_MAX_BYTES = 1_800_000;

/** Every delivered object lives under this prefix. */
const DELIVERY_PREFIX = 'migration-deliveries';

export interface BundleRef {
    key: string;
    bytes: number;
    sha256: string;
}

/** The slice of an R2 bucket the resolver needs; keeps tests free of a runtime. */
export interface DeliveryBucket {
    get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
    delete(key: string): Promise<void>;
}

function megabytes(bytes: number): string {
    return (bytes / 1_000_000).toFixed(1);
}

/**
 * The key prefix owned by one tenant's one run.
 *
 * Ids containing a slash are refused: with one, two different (tenant, run)
 * pairs could spell the same prefix, which would defeat the ownership check.
 */
export function deliveryPrefix(tenantId: string, batchId: string): string {
    if (tenantId.includes('/') || batchId.includes('/')) {
        throw new Error('bundleRef: tenant and run ids may not contain a slash');
    }
    return `${DELIVERY_PREFIX}/${tenantId}/${batchId}/`;
}

/** The only key a bundle with this hash may have for this run. */
export function deliveryKey(tenantId: string, batchId: string, sha256: string): string {
    return `${deliveryPrefix(tenantId, batchId)}${sha256}.json`;
}

/**
 * Throws unless the reference points inside the run the command names.
 *
 * The command arrives from a queue, so its contents are input. A reference that
 * could name any key would let one command read another workspace's object, or
 * another run's. This is a refusal, never a skip: the sender must learn that
 * nothing was delivered. It runs BEFORE any bucket read.
 */
export function assertBundleRefOwned(tenantId: string, batchId: string, ref: BundleRef): void {
    if (!ref.key.startsWith(deliveryPrefix(tenantId, batchId))) {
        throw new Error('bundleRef: key is outside the prefix of the run this command names');
    }
    // The key is a function of the content hash; any other spelling inside the
    // prefix (a nested path, another suffix) is not something the sender makes.
    if (ref.key !== deliveryKey(tenantId, batchId, ref.sha256)) {
        throw new Error('bundleRef: key does not match the declared content hash');
    }
}

/** Refuses a bundle over the ceiling, naming both numbers. */
export function assertBundleSizeWithin(bytes: number): void {
    if (bytes <= BUNDLE_MAX_BYTES) return;
    throw Errors.BadRequest(
        `This bundle is ${megabytes(bytes)} MB and the limit is ${megabytes(BUNDLE_MAX_BYTES)} MB.`,
    );
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads a referenced bundle back and checks it is the bytes the sender
 * described. Every failure throws: on the command queue a throw retries and then
 * dead-letters where an operator can see it, while a quiet skip would leave the
 * sender believing the delivery landed.
 */
export async function readBundleRef(
    bucket: DeliveryBucket | undefined,
    tenantId: string,
    batchId: string,
    ref: BundleRef,
): Promise<unknown> {
    assertBundleRefOwned(tenantId, batchId, ref);
    assertBundleSizeWithin(ref.bytes);
    if (!bucket) throw new Error('bundleRef: the exports bucket is not bound');

    const object = await bucket.get(ref.key);
    if (!object) throw new Error('bundleRef: the referenced object does not exist');
    // Checked before the body is read, so an oversized object is never pulled
    // into memory.
    assertBundleSizeWithin(object.size);
    if (object.size !== ref.bytes) {
        throw new Error(`bundleRef: object is ${object.size} bytes, the command declared ${ref.bytes}`);
    }
    const body = await object.arrayBuffer();
    if (body.byteLength !== ref.bytes) {
        throw new Error(`bundleRef: read ${body.byteLength} bytes, the command declared ${ref.bytes}`);
    }
    if ((await sha256Hex(body)) !== ref.sha256) {
        throw new Error('bundleRef: object content does not match the declared hash');
    }
    try {
        return JSON.parse(new TextDecoder().decode(body));
    } catch {
        throw new Error('bundleRef: object is not valid JSON');
    }
}
