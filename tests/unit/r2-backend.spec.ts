import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signUploadToken, verifyUploadToken } from '../../server/lib/video-upload-token';
import { R2VideoBackend } from '../../server/services/video/r2-backend';
import { drizzle } from 'drizzle-orm/d1';

// ── Token tests ───────────────────────────────────────────────────────────────

const secret = 'test-secret';
const claims = { tenantId: 't', inspectionId: 'i', mediaId: 'm' };

describe('video upload token', () => {
    it('round-trips', async () => {
        const tok = await signUploadToken(claims, 300, secret);
        expect(await verifyUploadToken(tok, secret)).toMatchObject(claims);
    });
    it('rejects tamper', async () => {
        const tok = await signUploadToken(claims, 300, secret);
        expect(await verifyUploadToken(tok.slice(0, -2) + 'xx', secret)).toBeNull();
    });
    it('rejects expiry', async () => {
        const tok = await signUploadToken(claims, -1, secret);
        expect(await verifyUploadToken(tok, secret)).toBeNull();
    });
});

// ── R2VideoBackend tests ──────────────────────────────────────────────────────

/**
 * Minimal D1Database stub that records inserted rows and allows idempotency
 * checks. We do not test the full Drizzle SQL path — that is covered by
 * test:workers.  We only assert on the shape of the values passed to insert.
 */
function makeD1Stub() {
    // Rows stored by r2Key for idempotency assertions.
    const poolRows: Record<string, unknown> = {};

    // Build a fake D1Database that satisfies the Drizzle constructor.
    const d1: D1Database = {
        prepare: (sql: string) => ({
            bind: (..._args: unknown[]) => ({
                first: async () => null,
                all: async () => ({ results: [], meta: {}, success: true }),
                run: async () => ({ meta: {}, success: true }),
                raw: async () => [],
            }),
        }),
        exec: async () => ({ count: 0, duration: 0 }),
        batch: async () => [],
        dump: async () => new ArrayBuffer(0),
    } as unknown as D1Database;

    return { d1, poolRows };
}

function makePhotosStub(exists = true) {
    const deleted: string[] = [];
    return {
        photos: {
            head: async (key: string) => exists ? { key, size: 1000 } : null,
            delete: async (key: string) => { deleted.push(key); },
            put: async () => null,
            get: async () => null,
            list: async () => ({ objects: [], truncated: false }),
        } as unknown as R2Bucket,
        deleted,
    };
}

describe('R2VideoBackend.createUpload', () => {
    const tenantId = 'tenant-abc';
    const inspectionId = 'insp-xyz';
    const jwtSecret = 'my-secret';
    const appOrigin = 'https://app.example.com';

    it('returns an uploadURL containing the token and an r2 ref with the correct key shape', async () => {
        const { photos } = makePhotosStub();
        const { d1 } = makeD1Stub();
        const db = drizzle(d1);
        const backend = new R2VideoBackend(photos, db, tenantId, jwtSecret, appOrigin);

        const { uploadURL, ref } = await backend.createUpload(inspectionId);

        // Provider discriminator
        expect(ref.provider).toBe('r2');

        // Key shape: {tenantId}/inspections/{inspectionId}/videos/{mediaId}.mp4
        const { r2Key, mediaId } = ref as { provider: 'r2'; r2Key: string; mediaId: string };
        expect(r2Key).toBe(`${tenantId}/inspections/${inspectionId}/videos/${mediaId}.mp4`);

        // Upload URL points at the correct API path with a token query param
        expect(uploadURL).toContain(`${appOrigin}/api/inspections/${inspectionId}/media/video/r2-upload?token=`);

        // Token in the URL must verify correctly
        const tokenStr = new URL(uploadURL).searchParams.get('token');
        expect(tokenStr).not.toBeNull();
        const verified = await verifyUploadToken(tokenStr!, jwtSecret);
        expect(verified).toMatchObject({ tenantId, inspectionId, mediaId });
    });
});

describe('R2VideoBackend.finalize idempotency', () => {
    const tenantId = 'tenant-abc';
    const jwtSecret = 'my-secret';
    const appOrigin = 'https://app.example.com';

    it('inserting twice for the same r2Key does not create a duplicate row', async () => {
        const { photos } = makePhotosStub();

        // Stateful in-memory store: tracks inserted pool rows by r2Key.
        const stored: Record<string, { id: string }> = {};
        const insertCount = { n: 0 };

        /**
         * Drizzle's D1 adapter (session.js line 153/157-163):
         *   - INSERT/DELETE/UPDATE  → bind().run()
         *   - SELECT .get() no-fields   → bind().all() → results[0]
         *   - SELECT .get() with fields → bind().raw() → rows[0] (column-value array)
         * We must handle raw() to make the idempotency SELECT + mapResultRow path work.
         *
         * Column order in raw() for `select({ id })... .get()` is [id_value].
         * We signal "row found" by returning [[storedId]] from raw(), and
         * "not found" by returning [].
         */
        const statefulD1: D1Database = {
            prepare: (sql: string) => {
                const upper = sql.trim().toUpperCase();
                const isInsert = upper.startsWith('INSERT');
                const isSelect = upper.startsWith('SELECT');
                return {
                    bind: (...args: unknown[]) => ({
                        first: async () => null,
                        all: async () => ({ results: [], meta: {}, success: true }),
                        raw: async () => {
                            if (isSelect) {
                                // The WHERE clause binds r2Key and tenantId as positional params.
                                // Find any arg matching a stored r2Key.
                                for (const arg of args) {
                                    if (typeof arg === 'string' && stored[arg]) {
                                        // Return a row as a column-value tuple: [id].
                                        return [[stored[arg].id]];
                                    }
                                }
                            }
                            return [];
                        },
                        run: async () => {
                            if (isInsert) {
                                // INSERT positional params include the r2Key; find it by pattern.
                                for (const arg of args) {
                                    if (
                                        typeof arg === 'string'
                                        && /^[^/]+\/inspections\/[^/]+\/videos\/[^/.]+\.[^/]+$/.test(arg)
                                    ) {
                                        const id = typeof args[0] === 'string' ? args[0] : crypto.randomUUID();
                                        stored[arg] = { id };
                                        insertCount.n++;
                                        break;
                                    }
                                }
                            }
                            return { meta: {}, success: true };
                        },
                    }),
                };
            },
            exec: async () => ({ count: 0, duration: 0 }),
            batch: async () => [],
            dump: async () => new ArrayBuffer(0),
        } as unknown as D1Database;

        const db = drizzle(statefulD1);
        const backend = new R2VideoBackend(photos, db, tenantId, jwtSecret, appOrigin);

        // Build a ref manually — key shape must parse correctly.
        const mediaId = crypto.randomUUID();
        const r2Key = `${tenantId}/inspections/insp-001/videos/${mediaId}.mp4`;
        const ref = { provider: 'r2' as const, mediaId, r2Key };

        // First finalize — should INSERT and return a poolId.
        const result1 = await backend.finalize(ref);
        expect(result1.poolId).toBeTruthy();

        // Second finalize with the same ref — SELECT finds the existing row;
        // no second INSERT should be issued.
        const result2 = await backend.finalize(ref);
        expect(result2.poolId).toBeTruthy();

        // Exactly one INSERT should have been executed.
        expect(insertCount.n).toBe(1);
    });
});
