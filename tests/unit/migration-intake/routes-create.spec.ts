/**
 * Turning an upload into a batch.
 *
 * Three things are decided here and nowhere else: whether this person may run
 * THIS import (per intent, reusing the gates the rest of the product already
 * enforces), whether anything can read the file, and — when nothing can —
 * whether there is anybody to hand it to.
 *
 * Where there is not, the file is refused BEFORE it is stored. Keeping a third
 * party's personal data that we could do nothing with has no reason behind it,
 * and "we might add an adapter later" is not one.
 *
 * ⚠️ EVERY refusal here is asserted on its OWN sentence, not on its status
 * code. Four different guards on this one route answer 400, and three answer
 * 403/422 in pairs — a spec that asserted the code alone would have passed with
 * any one of them wired to the wrong branch. Each refusal is paired with a
 * positive control: the same request with the single blocking condition removed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
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
import {
    SAAS_PROFILE,
    STANDALONE_PROFILE,
    type DeploymentProfile,
} from '../../../server/lib/deployment-profile';
import {
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
    MIGRATION_INTAKE_STAGED_RETENTION_DAYS,
} from '../../../server/lib/compliance/retention-windows';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const DAY_MS = 24 * 60 * 60 * 1000;

const CONTACTS_CSV = 'Full Name,Email\nAlice Ng,alice@example.test\n';
/**
 * A file no adapter in the registry can read FOR A CONTACT IMPORT.
 *
 * Some other product's own JSON export -- exactly what somebody uploads when
 * they are leaving a product that is not Spectora. The spreadsheet adapter
 * refuses JSON outright (a line splitter finds "columns" in `{"a":1,"b":2}`
 * because it is looking for commas), and the template adapter is never
 * consulted for a contact import.
 */
const UNREADABLE = JSON.stringify({ exportedFrom: 'SomeOtherApp', records: [{ a: 1 }] });

function bucket(store: Map<string, string>) {
    return {
        put: vi.fn(async (key: string, value: string) => { store.set(key, value); return {} as R2Object; }),
        get: vi.fn(async (key: string) => (store.has(key)
            ? ({ text: async () => store.get(key) as string } as unknown as R2ObjectBody)
            : null)),
        delete: vi.fn(async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        }),
    };
}

interface AppOpts {
    role: string;
    profile?: DeploymentProfile;
    store: Map<string, string>;
    /** `permission_overrides` the capability resolver should read off the user row. */
    overrides?: Record<string, boolean>;
}

function appFor(opts: AppOpts) {
    const app = new Hono<HonoConfig>();
    // Mirrors what server/index.ts's onError does, so a guard's refusal reaches
    // the assertions as its status AND its sentence rather than as a 500.
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        throw err;
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER, role: opts.role as 'owner' });
        c.set('userRole', opts.role as 'owner');
        c.set('profile', opts.profile ?? SAAS_PROFILE);
        if (opts.overrides) {
            c.set('sdb', {
                getById: async () => ({ permissionOverrides: opts.overrides }),
            } as never);
        }
        await next();
    });
    app.route('/api/imports', migrationIntakeRoutes);
    return app;
}

function upload(fields: Record<string, string>, file: { name: string; text: string }): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new File([file.text], file.name, { type: 'text/csv' }));
    return fd;
}

function post(opts: AppOpts, fields: Record<string, string>, file: { name: string; text: string }) {
    return appFor(opts).request(
        '/api/imports',
        { method: 'POST', body: upload(fields, file) },
        { DB: {}, PHOTOS: bucket(opts.store) },
    );
}

async function message(res: Response): Promise<string> {
    const body = await res.json() as { error?: { message?: string } };
    return body.error?.message ?? '';
}

describe('POST /api/imports', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let store: Map<string, string>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The staging service batches its writes, and better-sqlite3 is the one
        // Drizzle driver with no `batch()` — see helpers/d1-binding.ts.
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

    it('stages a readable spreadsheet and stores the file it came from', async () => {
        const res = await post(
            { role: 'owner', store },
            { intent: 'contacts.import', uploadAuthorized: 'true' },
            { name: 'c.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { batchId: string; status: string; needsAssistance: boolean } };
        expect(body.data.status).toBe('staged');
        expect(body.data.needsAssistance).toBe(false);
        expect(store.size).toBe(1);
        // The tie between run and file is the COLUMN, not the key's shape: the
        // key is minted before the run has an id, so `source_key` is the only
        // thing that can be asserted to point at what was actually stored.
        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, body.data.batchId)).get();
        expect(row?.sourceKey).toMatch(new RegExp(`^${TENANT}/migrations/[^/]+/source\\.csv$`));
        expect(store.get(row?.sourceKey as string)).toBe(CONTACTS_CSV);
    });

    it('records the storage authorisation and the staged run\'s own expiry', async () => {
        const res = await post(
            { role: 'owner', store },
            { intent: 'contacts.import', uploadAuthorized: 'true' },
            { name: 'c.csv', text: CONTACTS_CSV },
        );
        const { data } = await res.json() as { data: { batchId: string } };
        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, data.batchId)).get();
        expect(row?.uploadAuthorizedBy).toBe(USER);
        expect(row?.uploadAuthorizedAt).not.toBeNull();
        expect(row?.uploadAuthorizationVersion).toBeTruthy();
        // The shorter of the two windows: this run is on the operator's clock.
        // Without a value here the sweep never reaches it and the file is kept
        // forever under an authorisation that promised otherwise.
        const days = ((row?.expiresAt as Date).getTime() - Date.now()) / DAY_MS;
        expect(Math.round(days)).toBe(MIGRATION_INTAKE_STAGED_RETENTION_DAYS);
        // Nobody was asked to read this file, so nobody is recorded as allowed to.
        expect(row?.staffAccessAuthorizedBy).toBeNull();
    });

    it('refuses an upload that does not carry the storage authorisation, by name', async () => {
        const res = await post(
            { role: 'owner', store },
            { intent: 'contacts.import' },
            { name: 'c.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(400);
        // THE point of asserting the sentence: the size cap and the empty-file
        // check answer 400 from this same route.
        expect(await message(res)).toBe(
            'The file can only be kept with your agreement, and this upload did not carry it.',
        );
        expect(store.size).toBe(0);
        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
    });

    it('accepts that same upload once the authorisation is on it', async () => {
        // Positive control for the refusal above: one field is the difference.
        const res = await post(
            { role: 'owner', store },
            { intent: 'contacts.import', uploadAuthorized: 'true' },
            { name: 'c.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(201);
        expect(store.size).toBe(1);
    });

    it('parks an unreadable file for a person, on a platform that has one', async () => {
        const res = await post(
            { role: 'owner', store },
            { intent: 'contacts.import', uploadAuthorized: 'true', staffAccessAuthorized: 'true' },
            { name: 'weird.json', text: UNREADABLE },
        );
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { batchId: string; status: string; needsAssistance: boolean } };
        expect(body.data.status).toBe('needs_assistance');
        expect(body.data.needsAssistance).toBe(true);
        expect(store.size).toBe(1);

        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, body.data.batchId)).get();
        // Both authorisations, with their versions — a waiting run is the only
        // kind a person opens, so the record of that agreement is what lets them.
        expect(row?.staffAccessAuthorizedBy).toBe(USER);
        expect(row?.staffAccessAuthorizationVersion).toBeTruthy();
        // The longer window: this clock is on us, not on the operator.
        const days = ((row?.expiresAt as Date).getTime() - Date.now()) / DAY_MS;
        expect(Math.round(days)).toBe(MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS);
    });

    it('refuses an unreadable file BEFORE storing it where there is nobody to hand it to', async () => {
        const res = await post(
            { role: 'owner', profile: STANDALONE_PROFILE, store },
            { intent: 'contacts.import', uploadAuthorized: 'true', staffAccessAuthorized: 'true' },
            { name: 'weird.json', text: UNREADABLE },
        );
        expect(res.status).toBe(422);
        const text = await message(res);
        expect(text).toMatch(/Spectora|spreadsheet/i);
        // This deployment has no support path at all, so the sentence must not
        // offer one — the authorisation was even supplied and changed nothing.
        expect(text).not.toMatch(/converted by a person/i);
        // The whole point: nothing was written.
        expect(store.size).toBe(0);
        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
    });

    it('refuses an unreadable file where a person could read it but was not authorised to', async () => {
        const res = await post(
            { role: 'owner', store },
            { intent: 'contacts.import', uploadAuthorized: 'true' },
            { name: 'weird.json', text: UNREADABLE },
        );
        expect(res.status).toBe(422);
        // A DIFFERENT refusal from the one above at the same status code: this
        // one names the way forward, because on this deployment there is one.
        expect(await message(res)).toMatch(/converted by a person/i);
        expect(store.size).toBe(0);
        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
    });

    it('never opens a waiting run without the authorisation already recorded', async () => {
        // Why there is no route for granting staff access AFTER the fact: this
        // route refuses, and stores nothing, when a person has not been
        // authorised to open the file, and it records the name, the instant and
        // the wording version in the same insert as the row. So there is no such
        // thing as a waiting run missing that authorisation.
        //
        // Both doors that can open one are driven, not one: the unreadable-file
        // fallback and the "I do not know what this is" entry point write the
        // batch through different branches.
        const fallback = await post(
            { role: 'owner', store },
            { intent: 'contacts.import', uploadAuthorized: 'true', staffAccessAuthorized: 'true' },
            { name: 'weird.json', text: UNREADABLE },
        );
        expect(fallback.status).toBe(201);
        const direct = await post(
            { role: 'owner', store },
            { intent: 'assisted.full', uploadAuthorized: 'true', staffAccessAuthorized: 'true' },
            { name: 'x.csv', text: CONTACTS_CSV },
        );
        expect(direct.status).toBe(201);

        const waiting = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.status, 'needs_assistance')).all();
        for (const r of waiting) {
            // All THREE, not a flag: who agreed, when, and to WHICH WORDING. A
            // boolean cannot be read back later as an answer to "agreed to what",
            // and a name with no version is a signature on an unknown document.
            expect(r.staffAccessAuthorizedBy).toBe(USER);
            expect(r.staffAccessAuthorizedAt).toBeInstanceOf(Date);
            expect(r.staffAccessAuthorizationVersion).toBe('1');
        }
        // The positive control: the loop above passes trivially on an empty
        // list, and it is one status filter away from always being empty.
        expect(waiting).toHaveLength(2);
    });

    it('lets only an owner start the "I do not know what this is" route', async () => {
        const res = await post(
            { role: 'manager', store },
            { intent: 'assisted.full', uploadAuthorized: 'true', staffAccessAuthorized: 'true' },
            { name: 'x.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(403);
        // Named, because the role floor below refuses with the same code.
        expect(await message(res)).toBe('Only an owner can send a file to be converted.');
        expect(store.size).toBe(0);
    });

    it('lets the owner start it — the same request, one role different', async () => {
        const res = await post(
            { role: 'owner', store },
            { intent: 'assisted.full', uploadAuthorized: 'true', staffAccessAuthorized: 'true' },
            { name: 'x.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { status: string } };
        // Even a readable spreadsheet: this entry point never runs an adapter,
        // because guessing what the file is, is the thing it exists not to do.
        expect(body.data.status).toBe('needs_assistance');
    });

    it('keeps an inspector out of the route entirely', async () => {
        const res = await post(
            { role: 'inspector', store },
            { intent: 'contacts.import', uploadAuthorized: 'true' },
            { name: 'c.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(403);
        // The route's own floor, refusing before any intent gate is consulted.
        expect(await message(res)).toBe('Requires one of [owner, manager]');
        expect(store.size).toBe(0);
    });

    it('refuses a template import from somebody the Templates page hides it from', async () => {
        const res = await post(
            { role: 'manager', store, overrides: { templateImport: false } },
            { intent: 'templates.create', uploadAuthorized: 'true' },
            { name: 't.json', text: '{"id":"x","name":"R","sections":[]}' },
        );
        expect(res.status).toBe(403);
        expect(await message(res)).toBe("Requires the 'templateImport' capability");
        expect(store.size).toBe(0);
    });

    it('lets the same manager through once the capability is back', async () => {
        // Positive control: identical request, one override flipped.
        const res = await post(
            { role: 'manager', store, overrides: { templateImport: true } },
            { intent: 'templates.create', uploadAuthorized: 'true' },
            {
                name: 'Residential.json',
                text: JSON.stringify({
                    id: 'sp-1',
                    name: 'Residential',
                    sections: [{
                        id: 's1',
                        name: 'Roof',
                        items: [{ id: 'i1', name: 'Covering', comments: [] }],
                    }],
                }),
            },
        );
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { status: string } };
        expect(body.data.status).toBe('staged');
    });

    it('refuses a file over the deployment cap without storing it', async () => {
        const res = await post(
            { role: 'owner', profile: { ...SAAS_PROFILE, importMaxCsvBytes: 10 }, store },
            { intent: 'contacts.import', uploadAuthorized: 'true' },
            { name: 'c.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(400);
        // Both numbers, and a sentence distinct from the authorisation refusal
        // that shares this status code.
        expect(await message(res)).toMatch(/the limit is 0 MB/);
        expect(store.size).toBe(0);
    });

    it('refuses an entry point this product does not offer', async () => {
        const res = await post(
            { role: 'owner', store },
            { intent: 'invoices.import', uploadAuthorized: 'true' },
            { name: 'c.csv', text: CONTACTS_CSV },
        );
        expect(res.status).toBe(400);
        // The schema, not a handler check — named by its code and the field it
        // rejected, so it cannot be confused with the two handler 400s above.
        const body = await res.json() as { error: { code: string; fields: Record<string, string> } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(Object.keys(body.error.fields)).toContain('intent');
        expect(store.size).toBe(0);
    });

    it('takes the stored file back out when staging refuses the bundle', async () => {
        // A CSV with a header and no data rows is readable and stages nothing.
        // The object is written BEFORE staging runs — the batch has to carry a
        // key from its first write — so the refusal has to remove it, or a
        // file is retained under an authorisation for a run that never existed.
        const res = await post(
            { role: 'owner', store },
            { intent: 'contacts.import', uploadAuthorized: 'true' },
            { name: 'c.csv', text: 'Full Name,Email\n' },
        );
        expect(res.status).toBe(400);
        // WHICH 400 is load-bearing here, not decoration. An empty store also
        // satisfies this test if the request were refused before anything was
        // written — by the authorisation check or the size cap, both of which
        // answer 400 from this route. Naming the staging refusal is what proves
        // the file really was stored first and really was taken back out.
        expect(await message(res)).toBe('This file contains no contacts to import.');
        expect(store.size).toBe(0);
        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
    });
});
