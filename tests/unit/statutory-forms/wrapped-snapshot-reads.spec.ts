/**
 * Snapshots written by older code are stored as a JSON string literal wrapping the document, and the
 * inspections table is deliberately not backfilled. Every reader that looks for a statutory declaration
 * must therefore find it in both shapes; reading the wrapped one as "no declaration" turns a form that can
 * be produced into a 404.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import type { AppEnv, HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import statutoryDetailsRoutes from '../../../server/api/inspections/statutory-details';
import { resolveProducibleStatutoryForm } from '../../../server/services/statutory/producible';

const TENANT = '00000000-0000-0000-0000-0000000000b1';
const NO_FORM = 'This inspection produces no statutory form';

const STATUTORY_DOC = {
    schemaVersion: 2, sections: [],
    statutoryForm: { formId: 'tx_trec_rei', revision: '7-6', bindings: {} },
};
const ORDINARY_DOC = { schemaVersion: 2, sections: [] };
const asObject = (doc: unknown) => JSON.stringify(doc);
const asWrapped = (doc: unknown) => JSON.stringify(JSON.stringify(doc));

describe('statutory readers and a wrapped snapshot', () => {
    let sqlite: SqliteDatabase;
    let d1: D1Database;

    beforeEach(async () => {
        const made = createTestDb();
        sqlite = made.sqlite;
        await setupSchema(sqlite);
        await made.db.insert(schema.tenants).values({
            id: TENANT, slug: 'b1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        d1 = toD1Binding(sqlite);
    });

    function addInspection(id: string, snapshotText: string) {
        sqlite.prepare('INSERT INTO inspections (id, tenant_id, property_address, date, template_snapshot, created_at) VALUES (?,?,?,?,?,?)')
            .run(id, TENANT, '1 Main', '2026-03-01', snapshotText, Date.now());
    }

    async function getDetails(id: string): Promise<number> {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('tenantId', TENANT);
            await next();
        });
        app.route('/api/inspections', statutoryDetailsRoutes);
        app.onError((err, c) => {
            if (err instanceof AppError) return c.json({ success: false }, err.status as 404);
            return c.json({ success: false, thrown: String(err) }, 500);
        });
        // Only DB is bound for this route; cast through unknown rather than `as never` so the
        // cast names the type it produces instead of erasing it.
        const res = await app.request(`/api/inspections/${id}/statutory-details`, {}, { DB: d1 } as unknown as AppEnv);
        return res.status;
    }

    async function producibleRefusal(id: string): Promise<string | null> {
        try {
            await resolveProducibleStatutoryForm(drizzle(d1, { schema }), d1, TENANT, id);
            return null;
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }

    it('statutory-details finds the declaration in a wrapped snapshot, as in an object one', async () => {
        addInspection('obj', asObject(STATUTORY_DOC));
        addInspection('wrapped', asWrapped(STATUTORY_DOC));
        addInspection('plain', asObject(ORDINARY_DOC));
        expect(await getDetails('obj')).not.toBe(404);
        expect(await getDetails('wrapped')).not.toBe(404);
        // Control: a snapshot with no declaration is still a 404, so the two checks above can fail.
        expect(await getDetails('plain')).toBe(404);
    });

    it('the producible-form resolver finds the declaration in a wrapped snapshot', async () => {
        addInspection('obj', asObject(STATUTORY_DOC));
        addInspection('wrapped', asWrapped(STATUTORY_DOC));
        addInspection('plain', asObject(ORDINARY_DOC));
        const wrapped = await producibleRefusal('wrapped');
        const obj = await producibleRefusal('obj');
        console.log(`[gate] resolver refusals: object=${obj} wrapped=${wrapped}`);
        expect(wrapped).not.toBe(NO_FORM);
        expect(obj).not.toBe(NO_FORM);
        expect(await producibleRefusal('plain')).toBe(NO_FORM);
    });
});
