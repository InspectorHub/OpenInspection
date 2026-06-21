/**
 * Unit tests for the R2 video object serve routes.
 *
 * Routes under test:
 *   GET /:id/media/video/r2-object/:mediaId         — full + Range serve
 *   GET /:id/media/video/r2-object/:mediaId/poster  — poster serve
 *
 * Strategy: mount the REAL registerR2VideoRoutes handler on a minimal
 * OpenAPIHono app with stubbed c.env.DB + c.env.PHOTOS. This means
 * the token-guard, MIME, Range, and tenant-isolation assertions
 * exercise the shipped code, not a copy of it.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../server/types/hono';
import { registerR2VideoRoutes } from '../../server/api/inspections/media-video-r2';
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
// Drizzle's D1 adapter uses prepare().bind().first() for .get() queries.
// The stub returns column-name-keyed objects so Drizzle can map them.

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
            return {
                bind: (...args: unknown[]) => ({
                    first: async () => {
                        const upper = sql.trim().toUpperCase();
                        if (!upper.startsWith('SELECT')) return null;

                        // Match rows where string args include the row's id AND tenantId.
                        const stringArgs = args.filter((a): a is string => typeof a === 'string');
                        const matched = rows.find(row =>
                            stringArgs.includes(row.id) && stringArgs.includes(row.tenantId),
                        );
                        if (!matched) return null;

                        // Drizzle maps snake_case DB column names from D1's first() result.
                        // Return an object with all possible columns so Drizzle's column
                        // mapping works regardless of which columns are SELECTed.
                        return {
                            id: matched.id,
                            tenant_id: matched.tenantId,
                            r2_key: matched.r2Key,
                            poster_key: matched.posterKey,
                            provider: matched.provider,
                            media_type: matched.mediaType,
                        };
                    },
                    all: async () => ({ results: [], meta: {}, success: true }),
                    raw: async () => {
                        const upper = sql.trim().toUpperCase();
                        if (!upper.startsWith('SELECT')) return [];
                        const stringArgs = args.filter((a): a is string => typeof a === 'string');
                        const matched = rows.find(row =>
                            stringArgs.includes(row.id) && stringArgs.includes(row.tenantId),
                        );
                        if (!matched) return [];
                        // Drizzle's .get() consumes .raw() POSITIONALLY, so the tuple
                        // must follow the actual SELECT column order (the clip route
                        // selects r2_key, the poster route selects poster_key) — a
                        // fixed [r2_key, poster_key] tuple silently serves the wrong key.
                        const colMap: Record<string, unknown> = {
                            id: matched.id,
                            tenant_id: matched.tenantId,
                            r2_key: matched.r2Key,
                            poster_key: matched.posterKey,
                            provider: matched.provider,
                            media_type: matched.mediaType,
                        };
                        const fromIdx = upper.indexOf(' FROM ');
                        const selectClause = sql.slice(6, fromIdx >= 0 ? fromIdx : undefined);
                        const cols = Object.keys(colMap)
                            .filter(col => selectClause.includes(`"${col}"`))
                            .sort((a, b) => selectClause.indexOf(`"${a}"`) - selectClause.indexOf(`"${b}"`));
                        return [cols.map(col => colMap[col])];
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

// ── App factory — mounts REAL registered routes ───────────────────────────────

function buildServeApp(
    d1: D1Database,
    photos: ReturnType<typeof makeR2Stub>,
) {
    const app = new OpenAPIHono<HonoConfig>();

    // Inject tenantId + stubbed env before every request.
    app.use('*', async (c, next) => {
        const tenant = c.req.header('x-test-tenant') ?? 'unknown';
        c.set('tenantId', tenant);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = {
            DB: d1,
            PHOTOS: photos,
            JWT_SECRET: 'test-secret',
        };
        await next();
    });

    // Register the REAL R2 route handlers.
    registerR2VideoRoutes(app);

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
