/**
 * What reaches storage is what was uploaded.
 *
 * The acceptance test for the bytes-carrying intake path. A zip is used because
 * that is what every real vendor export is, and because its bytes do not survive
 * a UTF-8 round trip — an ASCII fixture would pass against the defective code,
 * which decoded every upload with `file.text()` before storing it.
 *
 * It drives the real route rather than the service, because the decode lived in
 * the route: a service-level round trip was already faithful and would have gone
 * on being green while every real upload was destroyed one layer above it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import { withBatch } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import migrationIntakeRoutes from '../../../server/api/migration-intake';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';
import { intakeBucket } from '../helpers/migration-intake-routes-harness';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';

/** Zip local-file header, then two bytes no UTF-8 decode preserves. */
const TPZ_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x08, 0xff, 0xfe, 0x00, 0x01]);

async function sha256(bytes: Uint8Array): Promise<string> {
    // Copy rather than cast: a Uint8Array may be backed by a SharedArrayBuffer,
    // which digest() does not accept, and the type says so. The copy is what
    // makes the ArrayBuffer backing a fact instead of an assertion.
    const owned = new Uint8Array(bytes);
    const digest = await crypto.subtle.digest('SHA-256', owned.buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function appFor(store: Map<string, Uint8Array>) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        throw err;
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER, role: 'owner' });
        c.set('userRole', 'owner');
        c.set('profile', SAAS_PROFILE);
        await next();
    });
    app.route('/api/imports', migrationIntakeRoutes);
    return (form: FormData) => app.request(
        '/api/imports',
        { method: 'POST', body: form },
        { DB: {}, PHOTOS: intakeBucket(store) },
    );
}

describe('POST /api/imports — the uploaded file reaches storage intact', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let store: Map<string, Uint8Array>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(withBatch(db, sqlite));
        store = new Map();
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'owner@example.test', passwordHash: 'x',
            role: 'owner', createdAt: new Date(),
        });
    });

    it('stores bytes whose sha256 equals the upload', async () => {
        const form = new FormData();
        form.set('intent', 'templates.create');
        form.set('uploadAuthorized', 'true');
        form.set('staffAccessAuthorized', 'true');
        form.set('file', new File([TPZ_BYTES], 'AHIT Master.tpz'));

        const res = await appFor(store)(form);
        expect(res.status).toBe(201);

        expect(store.size).toBe(1);
        const [key, bytes] = [...store.entries()][0];
        expect(key).toMatch(/\/migrations\/.*\/source\.bin$/);
        expect(await sha256(bytes)).toBe(await sha256(TPZ_BYTES));
    });

    it('positive control: a mangled copy does NOT match', async () => {
        // Proves the assertion above can fail. If the route decoded the upload,
        // what it stored would equal this, not the original.
        const mangled = new TextEncoder().encode(new TextDecoder().decode(TPZ_BYTES));
        expect(await sha256(mangled)).not.toBe(await sha256(TPZ_BYTES));
    });

    it('refuses an empty file by size, not by trimmed text', async () => {
        const form = new FormData();
        form.set('intent', 'contacts.import');
        form.set('uploadAuthorized', 'true');
        form.set('file', new File([new Uint8Array(0)], 'empty.csv'));
        const res = await appFor(store)(form);
        expect(res.status).toBe(400);
        const body = await res.json() as { error?: { message?: string } };
        expect(body.error?.message).toBe('That file is empty.');
        expect(store.size).toBe(0);
    });

    it('a file of whitespace is NOT empty — it has bytes, and they are kept', async () => {
        // The positive control for the check above. The old rule trimmed the
        // decoded text, so a file that is one space read as empty; a binary
        // whose decode happens to trim away would have read as empty too.
        const form = new FormData();
        form.set('intent', 'templates.create');
        form.set('uploadAuthorized', 'true');
        form.set('staffAccessAuthorized', 'true');
        form.set('file', new File([new Uint8Array([0x20, 0x09, 0x0a])], 'blank.tpz'));
        const res = await appFor(store)(form);
        expect(res.status).toBe(201);
        expect(store.size).toBe(1);
    });
});
