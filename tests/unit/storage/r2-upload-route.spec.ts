/**
 * Unit tests for the R2 video upload routes.
 *
 * Routes under test:
 *   POST /:id/media/video/r2-upload         — video multipart upload
 *   POST /:id/media/video/r2-upload-poster  — poster JPEG upload
 *
 * Strategy: mount the REAL registerR2VideoRoutes handler on a minimal
 * OpenAPIHono app with stubbed c.env.DB + c.env.PHOTOS. Token guard,
 * MIME validation, and size checks all exercise the shipped code, not
 * an inline copy of it.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { signUploadToken } from '../../../server/lib/video-upload-token';
import { ALLOWED_VIDEO_MIMES, MAX_VIDEO_BYTES, mimeToExt, registerR2VideoRoutes } from '../../../server/api/inspections/media-video-r2';
import { r2Keys } from '../../../server/lib/r2-keys';

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-for-upload-token';
const TENANT_ID = 'tenant-upload-001';
const OTHER_TENANT_ID = 'tenant-other-999';
const INSPECTION_ID = 'insp-upload-001';
const OTHER_INSPECTION_ID = 'insp-other-999';
const MEDIA_ID = 'media-upload-001';

// ── In-memory R2 stub ─────────────────────────────────────────────────────────

interface FakeR2Entry {
    bytes: Uint8Array;
    contentType: string;
}

interface FakeR2Object {
    body: ReadableStream;
    size: number;
    httpMetadata?: { contentType?: string };
}

function makeR2Stub() {
    const store = new Map<string, FakeR2Entry>();

    async function put(
        key: string,
        body: ArrayBuffer | Uint8Array,
        opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
    ) {
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
        store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream' });
        return {};
    }

    async function get(
        key: string,
        _options?: { range?: { offset: number; length?: number } },
    ): Promise<FakeR2Object | null> {
        const entry = store.get(key);
        if (!entry) return null;
        const captured = entry.bytes;
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(captured);
                controller.close();
            },
        });
        return { body: stream, size: entry.bytes.length, httpMetadata: { contentType: entry.contentType } };
    }

    return { store, put, get } as {
        store: Map<string, FakeR2Entry>;
        put: typeof put;
        get: typeof get;
    };
}

// ── Minimal D1 stub (upload routes never query D1, but c.env.DB is typed) ─────

function makeMinimalD1Stub(): D1Database {
    return {
        prepare: () => ({
            bind: () => ({
                first: async () => null,
                all: async () => ({ results: [], meta: {}, success: true }),
                raw: async () => [],
                run: async () => ({ meta: {}, success: true }),
            }),
        }) as ReturnType<D1Database['prepare']>,
        exec: async () => ({ count: 0, duration: 0 }),
        batch: async () => [],
        dump: async () => new ArrayBuffer(0),
    } as unknown as D1Database;
}

// ── App factory — mounts REAL registered routes ───────────────────────────────

function buildUploadApp(photos: ReturnType<typeof makeR2Stub>) {
    const app = new OpenAPIHono<HonoConfig>();

    // Inject tenantId from a test-only header and stub env (simulates JWT middleware).
    app.use('*', async (c, next) => {
        const tenant = c.req.header('x-test-tenant') ?? 'unknown';
        c.set('tenantId', tenant);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = {
            DB: makeMinimalD1Stub(),
            PHOTOS: photos,
            JWT_SECRET,
        };
        await next();
    });

    // Register the REAL R2 route handlers.
    registerR2VideoRoutes(app);

    return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build FormData containing a single file field. */
function makeFormData(filename: string, mimeType: string, content = new Uint8Array([0x00, 0x01, 0x02])): FormData {
    const fd = new FormData();
    // Pass an empty string as type to simulate the "no Content-Type" attack vector.
    const blob = new Blob([content], { type: mimeType });
    fd.append('file', blob, filename);
    return fd;
}

/** Mint a valid upload token with the test secret. */
async function mintToken(overrides: Partial<{ tenantId: string; inspectionId: string; mediaId: string }> = {}) {
    return signUploadToken(
        {
            tenantId: overrides.tenantId ?? TENANT_ID,
            inspectionId: overrides.inspectionId ?? INSPECTION_ID,
            mediaId: overrides.mediaId ?? MEDIA_ID,
        },
        900,
        JWT_SECRET,
    );
}

// ── Tests: r2-upload ──────────────────────────────────────────────────────────

describe('r2-upload route', () => {
    function setup() {
        const photos = makeR2Stub();
        const app = buildUploadApp(photos);
        return { photos, app };
    }

    // ── Token guard: missing token ────────────────────────────────────────────

    it('missing token → 401', async () => {
        const { app } = setup();
        const fd = makeFormData('video.mp4', 'video/mp4');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
            // No ?token= query param
        });

        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/invalid|expired/i);
    });

    it('null/garbage token → 401', async () => {
        const { app } = setup();
        const fd = makeFormData('video.mp4', 'video/mp4');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload?token=not-a-valid-token`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(401);
    });

    // ── Token guard: inspectionId mismatch ────────────────────────────────────

    it('token inspectionId ≠ URL :id → 401', async () => {
        const { app } = setup();
        // Token is minted for OTHER_INSPECTION_ID but the URL uses INSPECTION_ID.
        const token = await mintToken({ inspectionId: OTHER_INSPECTION_ID });
        const fd = makeFormData('video.mp4', 'video/mp4');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/invalid|expired/i);
    });

    // ── Token guard: tenantId mismatch ────────────────────────────────────────

    it('token tenantId ≠ JWT tenantId → 401', async () => {
        const { app } = setup();
        // Token is for TENANT_ID; but the "JWT" (via header) says OTHER_TENANT_ID.
        const token = await mintToken({ tenantId: TENANT_ID });
        const fd = makeFormData('video.mp4', 'video/mp4');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': OTHER_TENANT_ID },
        });

        expect(res.status).toBe(401);
    });

    // ── MIME validation: empty type → 400 (Fix 1) ────────────────────────────

    it('empty file.type → 400 (no fallback to video/mp4)', async () => {
        const { app } = setup();
        const token = await mintToken();
        // Blob with explicit empty-string type simulates a client omitting Content-Type.
        const blob = new Blob([new Uint8Array([0x00])], { type: '' });
        const fd = new FormData();
        fd.append('file', blob, 'video.mp4');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/missing|unsupported/i);
    });

    it('unsupported MIME type → 400', async () => {
        const { app } = setup();
        const token = await mintToken();
        const fd = makeFormData('evil.exe', 'application/octet-stream');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(400);
    });

    // ── Happy path ────────────────────────────────────────────────────────────

    it('valid token + valid MIME → 200 + stores in R2', async () => {
        const { app, photos } = setup();
        const token = await mintToken();
        const content = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // mp4 magic
        const fd = makeFormData('clip.mp4', 'video/mp4', content);

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { mediaId: string; r2Key: string } };
        expect(body.success).toBe(true);
        expect(body.data.mediaId).toBe(MEDIA_ID);
        expect(body.data.r2Key).toContain('.mp4');
        // Verify bytes were written to the stub store.
        expect(photos.store.has(body.data.r2Key)).toBe(true);
    });
});

// ── Tests: r2-upload-poster ───────────────────────────────────────────────────

describe('r2-upload-poster route', () => {
    function setup() {
        const photos = makeR2Stub();
        const app = buildUploadApp(photos);
        return { photos, app };
    }

    // ── Token guard: missing token ────────────────────────────────────────────

    it('missing token → 401', async () => {
        const { app } = setup();
        const fd = makeFormData('poster.jpg', 'image/jpeg');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload-poster`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(401);
    });

    it('null/garbage token → 401', async () => {
        const { app } = setup();
        const fd = makeFormData('poster.jpg', 'image/jpeg');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload-poster?token=bad.token.here`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(401);
    });

    // ── Token guard: inspectionId mismatch ────────────────────────────────────

    it('token inspectionId ≠ URL :id → 401', async () => {
        const { app } = setup();
        const token = await mintToken({ inspectionId: OTHER_INSPECTION_ID });
        const fd = makeFormData('poster.jpg', 'image/jpeg');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload-poster?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(401);
    });

    // ── Token guard: tenantId mismatch ────────────────────────────────────────

    it('token tenantId ≠ JWT tenantId → 401', async () => {
        const { app } = setup();
        const token = await mintToken({ tenantId: TENANT_ID });
        const fd = makeFormData('poster.jpg', 'image/jpeg');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload-poster?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': OTHER_TENANT_ID },
        });

        expect(res.status).toBe(401);
    });

    // ── MIME validation: empty type → 400 (Fix 1) ────────────────────────────

    it('empty file.type → 400 (no fallback to image/jpeg)', async () => {
        const { app } = setup();
        const token = await mintToken();
        const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: '' });
        const fd = new FormData();
        fd.append('file', blob, 'poster.jpg');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload-poster?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/missing|unsupported/i);
    });

    it('non-image MIME → 400', async () => {
        const { app } = setup();
        const token = await mintToken();
        const fd = makeFormData('video.mp4', 'video/mp4');

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload-poster?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(400);
    });

    // ── Happy path ────────────────────────────────────────────────────────────

    it('valid token + image/jpeg → 200 + stores in R2', async () => {
        const { app, photos } = setup();
        const token = await mintToken();
        const jpegMagic = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        const fd = makeFormData('poster.jpg', 'image/jpeg', jpegMagic);

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-upload-poster?token=${token}`, {
            method: 'POST',
            body: fd,
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { posterKey: string } };
        expect(body.success).toBe(true);
        expect(body.data.posterKey).toBeTruthy();
        expect(photos.store.has(body.data.posterKey)).toBe(true);
    });
});
