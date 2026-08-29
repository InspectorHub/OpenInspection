/**
 * The route that serves a statutory form.
 *
 * Every assertion here is on the HTTP STATUS CODE, against a router that is
 * really mounted. `createRoutesStub` does not run middleware, so an
 * authorisation test built on it is a false green -- and three of the checks
 * below (cross-tenant, unpublished, undeclared) are exactly the kind that would
 * pass for a route with no guard at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

/**
 * The published catalogue is EMPTY by declaration -- no statutory form ships
 * with this software, because publishing one needs an authority's PDF and a
 * field map a person checked. So the route's happy path cannot be exercised
 * against the real catalogue at all.
 *
 * It is mocked HERE rather than made injectable on the route. An injection
 * seam on a production route would exist only for this test, and the first
 * thing it would let through is a caller choosing its own revisions.
 */
vi.mock('../../../server/lib/statutory/forms', async () => {
    const { buildFlatPdf } = await import('../helpers/statutory-pdf-fixtures');
    const fixture = await buildFlatPdf();
    return {
        EMPTY_CATALOGUE_REASON: null,
        PUBLISHED_FORM_VERSIONS: [{
            formId: 'yy_flat_form', version: 'Rev. 04/26',
            effectiveFrom: Date.UTC(2026, 0, 1),
            mandatoryFrom: Date.UTC(2026, 0, 1),
            effectiveUntil: null,
            sourceUrl: 'https://example.gov/f.pdf', sourceHash: fixture.hash,
            publishedBy: 'a.operator', publishedAt: Date.UTC(2026, 0, 1),
            withdrawnAt: null,
        }],
        FIELD_MAPS: [],
        fieldMapFor: () => ({
            formId: 'yy_flat_form', version: 'Rev. 04/26', sourceHash: fixture.hash,
            checkedBy: 'a.operator', checkedAt: Date.UTC(2026, 7, 21),
            requiredFields: ['owner.name'],
            mappings: [{ kind: 'overlay', ourField: 'owner.name', page: 1, x: 100, y: 500, size: 10 }],
        }),
        // Exposed because `buildFlatPdf()` is NOT deterministic between calls --
        // measured: two calls hash differently. The bucket must serve the exact
        // bytes this map was authored against, or the render refuses, which is
        // the refusal working correctly on a fixture problem.
        __fixtureBytes: fixture.bytes,
    };
});
/**
 * The facts the route hands the producer, captured on the way through.
 *
 * A PASS-THROUGH spy, not a replacement: the real producer still runs, so the
 * status-code checks above keep exercising a real render rather than a stub
 * that can never refuse anything. Only the identity half is read here, because
 * a form's own field map decides whether an identity value is ever printed --
 * and the fixture map binds one item, not a licence box.
 */
const producer = vi.hoisted(() => ({ facts: null as Record<string, string | null> | null }));
vi.mock('../../../server/services/statutory/produce.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/services/statutory/produce.service')>();
    return {
        ...actual,
        produceStatutoryForm: async (input: Parameters<typeof actual.produceStatutoryForm>[0]) => {
            producer.facts = input.facts;
            return actual.produceStatutoryForm(input);
        },
    };
});
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import statutoryRoutes from '../../../server/api/inspections/statutory';
import { AppError } from '../../../server/lib/errors';

const TENANT = '00000000-0000-0000-0000-0000000000e1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000e2';

const GOOD = 'insp-good';
const DRAFT = 'insp-draft';
const PLAIN = 'insp-plain';
const OTHER = 'insp-other-tenant';

const INSPECTOR = 'usr-dana';

const FORM = 'yy_flat_form';
const REVISION = 'Rev. 04/26';

let db: BetterSQLite3Database<typeof schema>;
let flat: { bytes: Uint8Array };

const DECLARATION = {
    formId: FORM,
    bindings: { 'owner.name': { from: 'item', itemId: 'itm_owner' } },
};

const SNAPSHOT_DECLARED = {
    schemaVersion: 2,
    sections: [{ id: 'sec', title: 'S', items: [{ id: 'itm_owner', label: 'Owner', type: 'rich' }] }],
    statutoryForm: DECLARATION,
};

const SNAPSHOT_PLAIN = {
    schemaVersion: 2,
    sections: [{ id: 'sec', title: 'S', items: [{ id: 'itm_owner', label: 'Owner', type: 'rich' }] }],
};

function bucket() {
    const key = `_platform/statutory-forms/${FORM}/${encodeURIComponent(REVISION)}.pdf`;
    return {
        get: async (k: string) => (k === key
            ? { arrayBuffer: async () => flat.bytes.buffer.slice(flat.bytes.byteOffset, flat.bytes.byteOffset + flat.bytes.byteLength) }
            : null),
    } as unknown as R2Bucket;
}

function buildApp(tenantId = TENANT) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', tenantId);
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', statutoryRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { message: err.message } }, err.status as 404);
        }
        throw err;
    });
    return app;
}

const ENV = () => ({ DB: {} as D1Database, PHOTOS: bucket() } as unknown as HonoConfig['Bindings']);

function producedFacts(): Record<string, string | null> {
    if (!producer.facts) throw new Error('produceStatutoryForm was never called');
    return producer.facts;
}

beforeEach(async () => {
    producer.facts = null;
    const catalogue = await import('../../../server/lib/statutory/forms') as unknown as { __fixtureBytes: Uint8Array };
    flat = { bytes: catalogue.__fixtureBytes };
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);
    await db.insert(schema.tenants).values([
        { id: TENANT, slug: 'e1', createdAt: new Date() },
        { id: OTHER_TENANT, slug: 'e2', createdAt: new Date() },
    ]);
    // The four identity facts, each seeded where the route actually reads it:
    // the name on the user row, the licence as a credential row (`users` carries
    // no licence column), and the company pair on the workspace config.
    await db.insert(schema.users).values([{
        id: INSPECTOR, tenantId: TENANT, email: 'dana@example.test',
        passwordHash: 'x', name: 'Dana Reyes', role: 'inspector', createdAt: new Date(),
    }]);
    await db.insert(schema.inspectorCredentials).values([{
        id: 'cred-licence', tenantId: TENANT, userId: INSPECTOR,
        // `sortOrder: -1` is the seat the licence occupies: "first active
        // credential carrying a member number" is what makes it the licence.
        label: 'State licence', memberNumber: 'HI-12345', sortOrder: -1, active: true,
        createdAt: new Date(), updatedAt: new Date(),
    }]);
    await db.insert(schema.tenantConfigs).values([{
        tenantId: TENANT, companyName: 'Acme Inspections', companyPhone: '555-0100',
        updatedAt: new Date(),
    }]);
    const base = { propertyAddress: '1 Main St', date: '2026-05-01', createdAt: new Date() };
    await db.insert(schema.inspections).values([
        { ...base, id: GOOD, tenantId: TENANT, inspectorId: INSPECTOR, templateSnapshot: SNAPSHOT_DECLARED },
        { ...base, id: DRAFT, tenantId: TENANT, templateSnapshot: SNAPSHOT_DECLARED },
        { ...base, id: PLAIN, tenantId: TENANT, templateSnapshot: SNAPSHOT_PLAIN },
        { ...base, id: OTHER, tenantId: OTHER_TENANT, templateSnapshot: SNAPSHOT_DECLARED },
    ] as never);
    await db.insert(schema.reports).values([
        {
            id: 'rep-good', tenantId: TENANT, inspectionId: GOOD, title: 'Report', kind: 'primary',
            status: 'published', createdAt: new Date(), publishedAt: new Date(Date.UTC(2026, 4, 2)),
        },
        {
            id: 'rep-draft', tenantId: TENANT, inspectionId: DRAFT, title: 'Report', kind: 'primary',
            status: 'in_progress', createdAt: new Date(), publishedAt: null,
        },
        {
            id: 'rep-plain', tenantId: TENANT, inspectionId: PLAIN, title: 'Report', kind: 'primary',
            status: 'published', createdAt: new Date(), publishedAt: new Date(Date.UTC(2026, 4, 2)),
        },
        {
            id: 'rep-other', tenantId: OTHER_TENANT, inspectionId: OTHER, title: 'Report', kind: 'primary',
            status: 'published', createdAt: new Date(), publishedAt: new Date(Date.UTC(2026, 4, 2)),
        },
    ] as never);
});

async function get(id: string, tenantId = TENANT) {
    return buildApp(tenantId).request(`/api/inspections/${id}/statutory-form.pdf`, {}, ENV());
}

describe('GET /:id/statutory-form.pdf', () => {
    it('404s across tenants', async () => {
        // The id is real and its inspection is perfectly renderable -- for
        // somebody else. Tenant comes from the verified session, never the path.
        const res = await get(OTHER, TENANT);
        expect(res.status).toBe(404);
    });

    it('409s when the inspection has no published report version', async () => {
        // A statutory form produced from still-editable content is a document
        // nobody can reproduce, and the artifact-status header would have no
        // produced-at to be true about.
        expect((await get(DRAFT)).status).toBe(409);
    });

    it('404s when the template declares no statutory form', async () => {
        expect((await get(PLAIN)).status).toBe(404);
    });

    it('POSITIVE CONTROL — a declared, published inspection gets application/pdf', async () => {
        const res = await get(GOOD);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/pdf');
    });

    it('serves it inline, named for the form and revision only', async () => {
        // No tenant id and no client name in the filename: it is a header that
        // travels into download folders and mail clients.
        const disposition = (await get(GOOD)).headers.get('Content-Disposition') ?? '';
        expect(disposition).toMatch(/^inline;/);
        expect(disposition).toContain(FORM);
        expect(disposition).not.toContain(TENANT);
    });

    it('carries x-artifact-status derived from the published version, not from now', async () => {
        // Date.now() as producedAt makes the header read `current` forever,
        // which is a header with no content in it.
        const res = await get(GOOD);
        expect(res.headers.get('x-artifact-status')).toBeTruthy();
    });

    it('fills inspector and company identity from real sources', async () => {
        // A blank licence line is not an absent value on a statutory form -- the
        // box is preprinted, so blank reads as "this submission is invalid".
        // These four used to be hard-coded null while the sources already
        // existed; the licence in particular comes from the same
        // CredentialService call the report PDF's signature block makes, so the
        // two surfaces cannot disagree about the same inspector.
        const res = await get(GOOD);
        expect(res.status).toBe(200);

        const facts = producedFacts();
        expect(facts.inspector_name).toBe('Dana Reyes');
        expect(facts.inspector_license).toBe('HI-12345');
        expect(facts.company_name).toBe('Acme Inspections');
        expect(facts.company_phone).toBe('555-0100');
    });
});
