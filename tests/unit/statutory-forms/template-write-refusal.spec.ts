/**
 * A statutory declaration is platform-supplied. A workspace can never write one,
 * and can never edit a template that carries one.
 *
 * Two different enforcements are asserted here, and they are not
 * interchangeable:
 *
 *  1. The tenant validation schema is `.strict()`, so a declaration cannot be
 *     SMUGGLED IN on a template a workspace authors. That is free, and already
 *     true — the test below locks it rather than adding it.
 *  2. A template that ALREADY carries one must refuse edits with a sentence a
 *     person can act on. Left to `.strict()` alone the refusal is zod's
 *     `unrecognized_keys`, which tells an inspector that the software does not
 *     recognise one of its own fields.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { TemplateSchemaV2Schema } from '../../../server/lib/validations/template.schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import templatesRoutes from '../../../server/api/inspections/templates';
import resultsRoutes from '../../../server/api/inspections/results';
import { TemplateService } from '../../../server/services/template.service';
import { AppError } from '../../../server/lib/errors';

const TENANT = '00000000-0000-0000-0000-0000000000f1';
const PLATFORM_TPL = 'tpl-statutory';
const ORDINARY_TPL = 'tpl-ordinary';

const DECLARATION = {
    formId: 'tx_trec_rei',
    bindings: { 'client.name': { from: 'inspection', field: 'client_name' } },
};

let db: BetterSQLite3Database<typeof schema>;

/** `auditFromContext` reads `c.env.DB`; drizzle itself is mocked to the test db,
 *  so the binding only has to exist. */
const ENV = { DB: {} as D1Database } as unknown as HonoConfig['Bindings'];

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('services', {
            template: new TemplateService({} as D1Database),
            // Only the one method these routes reach. A fuller stub would hide
            // which call the positive control actually depends on.
            inspection: { updateTemplateSnapshot: async () => undefined },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', templatesRoutes);
    app.route('/api/inspections', resultsRoutes);
    // The real app converts a thrown AppError into its status; a bare
    // OpenAPIHono turns it into a 500. Without this the assertions below would
    // read 500 for both a working guard and a broken one.
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as 403);
        }
        throw err;
    });
    return app;
}

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'f1', createdAt: new Date() });
    await db.insert(schema.templates).values([
        {
            id: PLATFORM_TPL, tenantId: TENANT, name: 'Texas REI', version: 1,
            schema: JSON.stringify({ schemaVersion: 2, sections: [], statutoryForm: DECLARATION }),
            createdAt: new Date(),
        },
        {
            id: ORDINARY_TPL, tenantId: TENANT, name: 'Ordinary', version: 1,
            schema: JSON.stringify({ schemaVersion: 2, sections: [] }),
            createdAt: new Date(),
        },
    ]);
});

describe('the closed door on the tenant surface', () => {
    it('the tenant write schema REFUSES a statutory declaration today, with no change', () => {
        // NOT a red-to-green step. Top-level `.strict()` already does this; the
        // assertion exists so that a later "let us relax strict()" reads as
        // breaking a stated rule rather than as loosening a validator.
        const r = TemplateSchemaV2Schema.safeParse({
            schemaVersion: 2, sections: [], statutoryForm: DECLARATION,
        });
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(r.error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
        }
    });
});

describe('editing a template that already carries a declaration', () => {
    it('refuses with a sentence about ownership, not about an unknown key', async () => {
        // The realistic client shape: fetch the template, change the name, PUT
        // it back. The declaration rides along in the body, so `.strict()` would
        // answer first and answer badly.
        const res = await buildApp().request(`/api/inspections/templates/${PLATFORM_TPL}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: 'Texas REI (edited)',
                schema: { schemaVersion: 2, sections: [], statutoryForm: DECLARATION },
            }),
        }, ENV);
        expect(res.status).toBe(403);
        const body = await res.json() as { error?: { message?: string } };
        const message = JSON.stringify(body);
        expect(message).toMatch(/read-only/i);
        expect(message).not.toMatch(/unrecognized/i);
    });

    it('POSITIVE CONTROL — an ordinary template still updates', async () => {
        // Without this, a guard that refused every update would pass the test
        // above while breaking template editing for everybody.
        const res = await buildApp().request(`/api/inspections/templates/${ORDINARY_TPL}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: 'Ordinary (edited)',
                schema: { schemaVersion: 2, sections: [] },
            }),
        }, ENV);
        expect(res.status).toBe(200);
    });
});

describe('the same rule on the inspection copy of the template', () => {
    const INSPECTION_STATUTORY = 'insp-statutory';
    const INSPECTION_ORDINARY = 'insp-ordinary';

    async function seedInspections() {
        const base = {
            tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-05-01',
            createdAt: new Date(),
        };
        await db.insert(schema.inspections).values([
            {
                ...base, id: INSPECTION_STATUTORY,
                templateSnapshot: { schemaVersion: 2, sections: [], statutoryForm: DECLARATION },
            },
            {
                ...base, id: INSPECTION_ORDINARY,
                templateSnapshot: { schemaVersion: 2, sections: [] },
            },
        ] as never);
    }

    it('refuses a structural edit to a snapshot that declares a statutory form', async () => {
        // The editor strips runtime keys but not TOP-LEVEL keys, so the
        // declaration rides back in the PATCH body and `.strict()` would answer
        // `unrecognized_keys`. This asserts the sentence a person can act on.
        await seedInspections();
        const res = await buildApp().request(`/api/inspections/${INSPECTION_STATUTORY}/template-snapshot`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ snapshot: { schemaVersion: 2, sections: [] } }),
        }, ENV);
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).toMatch(/read-only/i);
    });

    it('POSITIVE CONTROL — an ordinary inspection snapshot still PATCHes', async () => {
        await seedInspections();
        const res = await buildApp().request(`/api/inspections/${INSPECTION_ORDINARY}/template-snapshot`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ snapshot: { schemaVersion: 2, sections: [] } }),
        }, ENV);
        expect(res.status).toBe(200);
    });
});
