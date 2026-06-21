/**
 * Unit tests for the R2 video object serve routes added to media-studio.ts.
 *
 * Routes under test:
 *   GET /:id/media/video/r2-object/:mediaId         — full + Range serve
 *   GET /:id/media/video/r2-object/:mediaId/poster  — poster serve
 *
 * Strategy: build a minimal Hono app that replicates the route handler logic
 * from media-studio.ts with an in-memory D1 stub and R2 bucket stub. We
 * close over the stubs directly (avoiding c.env assignment issues in test
 * environments) and inject tenantId via a test header.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { r2Keys } from '../../server/lib/r2-keys';

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
        options?: { range?: { offset: number; length?: number } },
    ): Promise<FakeR2Object | null> {
        const entry = store.get(key);
        if (!entry) return null;
        let bytes = entry.bytes;
        if (options?.range) {
            const { offset, length } = options.range;
            bytes = length !== undefined
                ? entry.bytes.slice(offset, offset + length)
                : entry.bytes.slice(offset);
        }
        const captured = bytes;
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(captured);
                controller.close();
            },
        });
        return {
            body: stream,
            size: entry.bytes.length, // always the full object size
            httpMetadata: { contentType: entry.contentType },
        };
    }

    return { store, put, get } as {
        store: Map<string, FakeR2Entry>;
        put: typeof put;
        get: typeof get;
    };
}

// ── In-memory D1 stub ─────────────────────────────────────────────────────────
//
// Stores pool rows in memory. The stub handles the prepare().bind().raw()
// path that Drizzle uses for .get() queries.

interface PoolRow {
    id: string;
    tenantId: string;
    r2Key: string;
    posterKey: string | null;
    provider: string;
    mediaType: string;
}

function makeD1Stub(rows: PoolRow[]): D1Database {
    return {
        prepare: (sql: string) => {
            const upper = sql.trim().toUpperCase();
            return {
                bind: (...args: unknown[]) => ({
                    first: async () => null,
                    all: async () => ({ results: [], meta: {}, success: true }),
                    raw: async () => {
                        if (!upper.startsWith('SELECT')) return [];

                        // Match rows where string args include the row's id AND tenantId.
                        const stringArgs = args.filter((a): a is string => typeof a === 'string');

                        const matched = rows.find(row =>
                            stringArgs.includes(row.id) && stringArgs.includes(row.tenantId),
                        );
                        if (!matched) return [];

                        // Return appropriate columns based on what the SELECT asks for.
                        if (sql.includes('poster_key') && sql.includes('r2_key')) {
                            return [[matched.r2Key, matched.posterKey]];
                        }
                        if (sql.includes('poster_key')) {
                            return [[matched.posterKey]];
                        }
                        if (sql.includes('r2_key')) {
                            return [[matched.r2Key]];
                        }
                        return [[matched.id]];
                    },
                    run: async () => ({ meta: {}, success: true }),
                }),
            } as ReturnType<D1Database['prepare']>;
        },
        exec: async () => ({ count: 0, duration: 0 }),
        batch: async () => [],
        dump: async () => new ArrayBuffer(0),
    } as unknown as D1Database;
}

// ── Route logic (replicates media-studio.ts handlers) ────────────────────────
//
// We inline the handler logic here so the test file does not depend on
// importing media-studio.ts (which pulls in the full OpenAPIHono chain and the
// service injection graph). The logic is verbatim-equivalent to the
// production handlers.

function buildServeApp(
    d1: D1Database,
    photos: ReturnType<typeof makeR2Stub>,
) {
    const app = new Hono<{ Variables: { tenantId: string } }>();

    // Inject tenantId from a test-only header (simulates JWT middleware).
    app.use('*', async (c, next) => {
        const tenant = c.req.header('x-test-tenant') ?? 'unknown';
        c.set('tenantId', tenant);
        await next();
    });

    // GET /:id/media/video/r2-object/:mediaId
    app.get('/:id/media/video/r2-object/:mediaId', async (c) => {
        const tenantId = c.get('tenantId');
        const mediaId = c.req.param('mediaId');

        const raw = await d1
            .prepare(
                `select r2_key from inspection_media_pool where id = ? and tenant_id = ? and provider = 'r2' and media_type = 'video'`,
            )
            .bind(mediaId, tenantId)
            .raw<[string]>();

        if (!raw || raw.length === 0) {
            return c.json({ error: 'Video not found' }, 404);
        }

        const r2Key = raw[0][0];
        const rangeHeader = c.req.header('Range');

        if (rangeHeader) {
            const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
            if (!rangeMatch) {
                return new Response('Invalid Range', { status: 416 });
            }
            const start = parseInt(rangeMatch[1], 10);
            const endStr = rangeMatch[2];

            const obj = await photos.get(r2Key, {
                range: endStr
                    ? { offset: start, length: parseInt(endStr, 10) - start + 1 }
                    : { offset: start },
            });
            if (!obj) {
                return c.json({ error: 'Video not found in storage' }, 404);
            }

            const contentType = obj.httpMetadata?.contentType ?? 'video/mp4';
            const end = endStr ? parseInt(endStr, 10) : obj.size - 1;
            const contentLength = end - start + 1;

            return new Response(obj.body, {
                status: 206,
                headers: {
                    'Content-Type': contentType,
                    'Content-Range': `bytes ${start}-${end}/${obj.size}`,
                    'Content-Length': String(contentLength),
                    'Accept-Ranges': 'bytes',
                },
            });
        }

        // Full-object request.
        const obj = await photos.get(r2Key);
        if (!obj) {
            return c.json({ error: 'Video not found in storage' }, 404);
        }

        const contentType = obj.httpMetadata?.contentType ?? 'video/mp4';

        return new Response(obj.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': String(obj.size),
                'Accept-Ranges': 'bytes',
            },
        });
    });

    // GET /:id/media/video/r2-object/:mediaId/poster
    app.get('/:id/media/video/r2-object/:mediaId/poster', async (c) => {
        const tenantId = c.get('tenantId');
        const mediaId = c.req.param('mediaId');

        const raw = await d1
            .prepare(
                `select poster_key from inspection_media_pool where id = ? and tenant_id = ? and provider = 'r2'`,
            )
            .bind(mediaId, tenantId)
            .raw<[string | null]>();

        if (!raw || raw.length === 0 || !raw[0][0]) {
            return c.json({ error: 'Poster not found' }, 404);
        }

        const pk = raw[0][0];
        const obj = await photos.get(pk);
        if (!obj) {
            return c.json({ error: 'Poster not found in storage' }, 404);
        }

        const contentType = obj.httpMetadata?.contentType ?? 'image/jpeg';

        return new Response(obj.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': String(obj.size),
                'Cache-Control': 'public, max-age=86400',
            },
        });
    });

    return app;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test-001';
const INSPECTION_ID = 'insp-test-001';
const MEDIA_ID = 'media-test-001';
const OTHER_TENANT_ID = 'tenant-other-999';

const videoKey = r2Keys.inspectionVideo(TENANT_ID, INSPECTION_ID, MEDIA_ID, 'mp4');
const posterKey = r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, MEDIA_ID);

const poolRows: PoolRow[] = [
    {
        id: MEDIA_ID,
        tenantId: TENANT_ID,
        r2Key: videoKey,
        posterKey,
        provider: 'r2',
        mediaType: 'video',
    },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('r2-object serve route', () => {
    // Small synthetic video payload (100 bytes with a distinct pattern).
    const videoBytes = new Uint8Array(100);
    for (let i = 0; i < videoBytes.length; i++) videoBytes[i] = i % 256;

    const posterBytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic bytes

    // Rebuild stubs before each test for isolation.
    function setup() {
        const photos = makeR2Stub();
        const d1 = makeD1Stub(poolRows);
        const app = buildServeApp(d1, photos);
        return { photos, d1, app };
    }

    it('full request → 200 + Accept-Ranges + Content-Length', async () => {
        const { photos, app } = setup();
        await photos.put(videoKey, videoBytes, { httpMetadata: { contentType: 'video/mp4' } });

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-object/${MEDIA_ID}`, {
            method: 'GET',
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Accept-Ranges')).toBe('bytes');
        expect(res.headers.get('Content-Length')).toBe(String(videoBytes.length));
        expect(res.headers.get('Content-Type')).toContain('video/mp4');

        const body = new Uint8Array(await res.arrayBuffer());
        expect(body).toEqual(videoBytes);
    });

    it('Range request → 206 + Content-Range header + sliced body', async () => {
        const { photos, app } = setup();
        await photos.put(videoKey, videoBytes, { httpMetadata: { contentType: 'video/mp4' } });

        // Request bytes 10–29 (20 bytes).
        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-object/${MEDIA_ID}`, {
            method: 'GET',
            headers: {
                'x-test-tenant': TENANT_ID,
                'Range': 'bytes=10-29',
            },
        });

        expect(res.status).toBe(206);
        expect(res.headers.get('Content-Range')).toBe(`bytes 10-29/${videoBytes.length}`);
        expect(res.headers.get('Content-Length')).toBe('20');
        expect(res.headers.get('Accept-Ranges')).toBe('bytes');

        const body = new Uint8Array(await res.arrayBuffer());
        // The stub slices bytes 10..29 (length 20) from the original.
        expect(body).toEqual(videoBytes.slice(10, 30));
    });

    it('cross-tenant mediaId → 404 (tenant isolation)', async () => {
        const { photos, app } = setup();
        await photos.put(videoKey, videoBytes, { httpMetadata: { contentType: 'video/mp4' } });

        // Pool row belongs to TENANT_ID; request comes in for OTHER_TENANT_ID.
        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-object/${MEDIA_ID}`, {
            method: 'GET',
            headers: { 'x-test-tenant': OTHER_TENANT_ID },
        });

        expect(res.status).toBe(404);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/not found/i);
    });

    it('poster route → 200 with JPEG content + cache header', async () => {
        const { photos, app } = setup();
        await photos.put(posterKey, posterBytes, { httpMetadata: { contentType: 'image/jpeg' } });

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-object/${MEDIA_ID}/poster`, {
            method: 'GET',
            headers: { 'x-test-tenant': TENANT_ID },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('image/jpeg');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');

        const body = new Uint8Array(await res.arrayBuffer());
        expect(body).toEqual(posterBytes);
    });

    it('poster route cross-tenant → 404', async () => {
        const { photos, app } = setup();
        await photos.put(posterKey, posterBytes, { httpMetadata: { contentType: 'image/jpeg' } });

        const res = await app.request(`/${INSPECTION_ID}/media/video/r2-object/${MEDIA_ID}/poster`, {
            method: 'GET',
            headers: { 'x-test-tenant': OTHER_TENANT_ID },
        });

        expect(res.status).toBe(404);
    });
});
