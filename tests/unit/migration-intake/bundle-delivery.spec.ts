/**
 * A converted bundle delivered by reference instead of inline.
 *
 * The reference is input from a queue, so the property that matters most is
 * that a command cannot read an object belonging to another workspace or
 * another run. Every refusal below is asserted together with "the bucket was
 * never asked", because a check that runs after the read has already exposed
 * the object.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
    BUNDLE_MAX_BYTES,
    assertBundleRefOwned,
    deliveryKey,
    deliveryPrefix,
    readBundleRef,
    type DeliveryBucket,
} from '../../../server/lib/migration-intake/bundle-delivery';
import { cmdMigrationDeliverDataSchema } from '../../../server/lib/sync-events/cmd-envelope';
import limitsFixture from '../../fixtures/migration-delivery/bundle-limits.json';
import refFixture from '../../fixtures/cmd-events/cmd-migration-deliver-ref-v1.json';
import inlineFixture from '../../fixtures/cmd-events/cmd-migration-deliver-v1.json';

const TENANT = 'tenant-a';
const BATCH = 'batch-1';
const OTHER_TENANT = 'tenant-b';
const OTHER_BATCH = 'batch-2';
const ACTOR = { platformAdminId: 'pa-1', email: 'ops@example.test' };

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** A bucket holding the given objects, counting how often it is read. */
function fakeBucket(objects: Record<string, Uint8Array>) {
    const get = vi.fn(async (key: string) => {
        const body = objects[key];
        if (!body) return null;
        return {
            size: body.byteLength,
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
        };
    });
    const del = vi.fn(async () => undefined);
    return { bucket: { get, delete: del } satisfies DeliveryBucket, get, del };
}

/** The reference a sender would build for these bytes, for this run. */
function refFor(bytes: Uint8Array, tenantId = TENANT, batchId = BATCH) {
    const hash = sha256(bytes);
    return { key: deliveryKey(tenantId, batchId, hash), bytes: bytes.byteLength, sha256: hash };
}

const DOC = { formatVersion: 1, note: 'synthetic' };
const DOC_BYTES = new TextEncoder().encode(JSON.stringify(DOC));

describe('cmd.migration.deliver payload — bundle xor bundleRef', () => {
    const base = { tenantId: TENANT, batchId: BATCH, actor: ACTOR };
    const ref = refFor(DOC_BYTES);

    it('accepts an inline bundle', () => {
        expect(cmdMigrationDeliverDataSchema.safeParse({ ...base, bundle: DOC }).success).toBe(true);
    });

    it('accepts a reference', () => {
        expect(cmdMigrationDeliverDataSchema.safeParse({ ...base, bundleRef: ref }).success).toBe(true);
    });

    it('refuses both at once', () => {
        expect(cmdMigrationDeliverDataSchema.safeParse({ ...base, bundle: DOC, bundleRef: ref }).success).toBe(false);
    });

    it('refuses neither', () => {
        expect(cmdMigrationDeliverDataSchema.safeParse({ ...base }).success).toBe(false);
    });

    it('refuses an unknown key inside the reference', () => {
        expect(cmdMigrationDeliverDataSchema.safeParse({ ...base, bundleRef: { ...ref, extra: 1 } }).success).toBe(false);
    });

    it('refuses a hash that is not 64 lowercase hex characters', () => {
        expect(cmdMigrationDeliverDataSchema.safeParse({ ...base, bundleRef: { ...ref, sha256: 'ABC' } }).success).toBe(false);
    });

    it('parses the shared fixtures, both shapes', () => {
        expect(cmdMigrationDeliverDataSchema.safeParse(refFixture.data).success).toBe(true);
        expect(cmdMigrationDeliverDataSchema.safeParse(inlineFixture.data).success).toBe(true);
    });

    it('the reference fixture is a true pair: size and hash of the bundle text of the inline fixture', () => {
        const text = new TextEncoder().encode(JSON.stringify(inlineFixture.data.bundle));
        expect(refFixture.data.bundleRef.bytes).toBe(text.byteLength);
        expect(refFixture.data.bundleRef.sha256).toBe(sha256(text));
    });

    it('the reference fixture names a key inside its own run', () => {
        const d = refFixture.data;
        expect(() => assertBundleRefOwned(d.tenantId, d.batchId, d.bundleRef)).not.toThrow();
    });
});

describe('BUNDLE_MAX_BYTES', () => {
    it('equals the value in the fixture both repositories keep identical', () => {
        expect(BUNDLE_MAX_BYTES).toBe(limitsFixture.BUNDLE_MAX_BYTES);
    });
});

describe('readBundleRef — ownership is decided before the bucket is read', () => {
    it('POSITIVE CONTROL — a key under the run\'s own prefix is read, verified and parsed', async () => {
        const ref = refFor(DOC_BYTES);
        const { bucket, get } = fakeBucket({ [ref.key]: DOC_BYTES });
        await expect(readBundleRef(bucket, TENANT, BATCH, ref)).resolves.toEqual(DOC);
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith(ref.key);
    });

    it('refuses another workspace\'s key, even though the object exists, and never reads it', async () => {
        const foreign = refFor(DOC_BYTES, OTHER_TENANT, BATCH);
        const { bucket, get } = fakeBucket({ [foreign.key]: DOC_BYTES });
        await expect(readBundleRef(bucket, TENANT, BATCH, foreign)).rejects.toThrow(/outside the prefix/);
        expect(get).not.toHaveBeenCalled();
    });

    it('refuses another run\'s key in the same workspace, and never reads it', async () => {
        const foreign = refFor(DOC_BYTES, TENANT, OTHER_BATCH);
        const { bucket, get } = fakeBucket({ [foreign.key]: DOC_BYTES });
        await expect(readBundleRef(bucket, TENANT, BATCH, foreign)).rejects.toThrow(/outside the prefix/);
        expect(get).not.toHaveBeenCalled();
    });

    it('refuses a key that climbs out of the prefix with a path segment, and never reads it', async () => {
        const ref = refFor(DOC_BYTES);
        const sneaky = { ...ref, key: `${deliveryPrefix(TENANT, BATCH)}../${OTHER_BATCH}/${ref.sha256}.json` };
        const { bucket, get } = fakeBucket({ [sneaky.key]: DOC_BYTES });
        await expect(readBundleRef(bucket, TENANT, BATCH, sneaky)).rejects.toThrow(/does not match the declared content hash/);
        expect(get).not.toHaveBeenCalled();
    });

    it('refuses a key under the prefix whose name is not the declared hash, and never reads it', async () => {
        const ref = refFor(DOC_BYTES);
        const other = { ...ref, key: `${deliveryPrefix(TENANT, BATCH)}something-else.json` };
        const { bucket, get } = fakeBucket({ [other.key]: DOC_BYTES });
        await expect(readBundleRef(bucket, TENANT, BATCH, other)).rejects.toThrow(/does not match the declared content hash/);
        expect(get).not.toHaveBeenCalled();
    });

    it('refuses ids that could make two different runs spell one prefix', () => {
        expect(() => deliveryPrefix('a/b', 'c')).toThrow(/slash/);
        expect(() => deliveryPrefix('a', 'b/c')).toThrow(/slash/);
    });
});

describe('readBundleRef — the object must be what the command described', () => {
    it('throws when the object does not exist', async () => {
        const ref = refFor(DOC_BYTES);
        const { bucket, get } = fakeBucket({});
        await expect(readBundleRef(bucket, TENANT, BATCH, ref)).rejects.toThrow(/does not exist/);
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('throws when the stored size differs from the declared one, naming both', async () => {
        const ref = refFor(DOC_BYTES);
        const { bucket } = fakeBucket({ [ref.key]: DOC_BYTES });
        const err = await readBundleRef(bucket, TENANT, BATCH, { ...ref, bytes: ref.bytes + 1 }).catch((e: unknown) => e);
        expect(String(err)).toContain(`object is ${DOC_BYTES.byteLength} bytes, the command declared ${DOC_BYTES.byteLength + 1}`);
        // The sibling branch (body read length) has different wording.
        expect(String(err)).not.toContain('body read was');
    });

    it('throws when the content hash differs, with the right size', async () => {
        const ref = refFor(DOC_BYTES);
        const tampered = new TextEncoder().encode(JSON.stringify({ ...DOC, note: 'synthetiX' }));
        expect(tampered.byteLength).toBe(DOC_BYTES.byteLength);
        const { bucket } = fakeBucket({ [ref.key]: tampered });
        await expect(readBundleRef(bucket, TENANT, BATCH, ref)).rejects.toThrow(/does not match the declared hash/);
    });

    it('throws when the bytes are not JSON', async () => {
        const junk = new TextEncoder().encode('not json at all');
        const ref = refFor(junk);
        const { bucket } = fakeBucket({ [ref.key]: junk });
        await expect(readBundleRef(bucket, TENANT, BATCH, ref)).rejects.toThrow(/not valid JSON/);
    });

    it('throws when the exports bucket is not bound', async () => {
        await expect(readBundleRef(undefined, TENANT, BATCH, refFor(DOC_BYTES))).rejects.toThrow(/not bound/);
    });
});

describe('readBundleRef — text must be valid UTF-8', () => {
    it('refuses bytes that are not UTF-8 even when size and hash match', async () => {
        const bad = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]);
        const ref = refFor(bad);
        const { bucket } = fakeBucket({ [ref.key]: bad });
        await expect(readBundleRef(bucket, TENANT, BATCH, ref)).rejects.toThrow(/not valid UTF-8 text/);
    });

    it('POSITIVE CONTROL — multi-byte UTF-8 is read intact', async () => {
        const good = new TextEncoder().encode(JSON.stringify({ note: 'café' }));
        const ref = refFor(good);
        const { bucket } = fakeBucket({ [ref.key]: good });
        await expect(readBundleRef(bucket, TENANT, BATCH, ref)).resolves.toEqual({ note: 'café' });
    });
});

describe('readBundleRef — a bucket that disagrees with itself', () => {
    it('stored size over the ceiling while the command declares a small one: refused as the STORED size, body never read', async () => {
        const ref = refFor(DOC_BYTES);
        const arrayBuffer = vi.fn(async () => DOC_BYTES.buffer as ArrayBuffer);
        const bucket: DeliveryBucket = {
            get: async () => ({ size: BUNDLE_MAX_BYTES + 1, arrayBuffer }),
            delete: async () => undefined,
        };
        const err = await readBundleRef(bucket, TENANT, BATCH, ref).catch((e: unknown) => e);
        expect(String(err)).toContain('The stored object is 1,800,001 bytes (1.8 MB) and the limit is 1,800,000 bytes (1.8 MB).');
        expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it('stored size equal to the declared one but a body of another length: refused as the BODY length', async () => {
        const ref = refFor(DOC_BYTES);
        const shorter = DOC_BYTES.slice(0, DOC_BYTES.byteLength - 1);
        const bucket: DeliveryBucket = {
            get: async () => ({ size: ref.bytes, arrayBuffer: async () => shorter.buffer as ArrayBuffer }),
            delete: async () => undefined,
        };
        const err = await readBundleRef(bucket, TENANT, BATCH, ref).catch((e: unknown) => e);
        expect(String(err)).toContain(`body read was ${shorter.byteLength} bytes, the command declared ${ref.bytes}`);
        expect(String(err)).not.toContain('object is');
    });
});

describe('readBundleRef — the size ceiling names both numbers and reads nothing', () => {
    it('refuses a declared size over the limit before asking the bucket', async () => {
        const hash = sha256(DOC_BYTES);
        const ref = { key: deliveryKey(TENANT, BATCH, hash), bytes: BUNDLE_MAX_BYTES + 1, sha256: hash };
        const { bucket, get } = fakeBucket({ [ref.key]: DOC_BYTES });
        const err = await readBundleRef(bucket, TENANT, BATCH, ref).catch((e: unknown) => e);
        // One byte over the limit must not read as "1.8 MB and 1.8 MB": the
        // byte counts are what tell the two numbers apart.
        expect(String(err)).toContain('This bundle is 1,800,001 bytes (1.8 MB) and the limit is 1,800,000 bytes (1.8 MB).');
        expect(get).not.toHaveBeenCalled();
    });

    it('POSITIVE CONTROL — exactly the limit is accepted by the size check', async () => {
        const hash = sha256(DOC_BYTES);
        const ref = { key: deliveryKey(TENANT, BATCH, hash), bytes: BUNDLE_MAX_BYTES, sha256: hash };
        const { bucket } = fakeBucket({ [ref.key]: DOC_BYTES });
        // Passes the ceiling, then fails on the size mismatch: proof the ceiling
        // did not fire at the boundary.
        await expect(readBundleRef(bucket, TENANT, BATCH, ref)).rejects.toThrow(/object is \d+ bytes, the command declared/);
    });
});
