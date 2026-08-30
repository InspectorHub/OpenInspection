/**
 * Installing a statutory package is refused while the authority's PDF is
 * missing.
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
 * It is the only marketplace behaviour that depends on the published catalogue,
 * which has to be mocked at the module: no statutory form ships with this
 * software (`PUBLISHED_FORM_VERSIONS` is empty by declaration), so a real run
 * has nothing to require bytes for. Mocking it inside the other marketplace
 * specs would change what every unrelated test in them is measuring.
 *
 * ── THE PAIR ────────────────────────────────────────────────────────────────
 * "Refuses when the bytes are absent" is satisfied perfectly by an install that
 * refuses everything, so "installs when the bytes are present" sits beside it
 * and is not optional. Both assert on what reached the DATABASE, because the
 * failure this gate exists for is a workspace that believes it installed
 * something: a refusal that still wrote the import marker would reproduce it
 * exactly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { marketplaceLibraries, tenantLibraryImports } from '../../../server/lib/db/schema/marketplace';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema, toRawD1 } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const FORM = 'yy_flat_form';
const REVISION = 'Rev. 04/26';

/**
 * The catalogue, held in a box so one test can empty it. A deployment that
 * publishes nothing for a form has no key to look for, and that case has to be
 * distinguishable from "the bytes are missing" — otherwise the gate would refuse
 * every statutory install on every deployment that ships with an empty
 * catalogue, which is all of them today.
 */
const catalogue = vi.hoisted(() => ({
    versions: [] as unknown[],
}));

vi.mock('../../../server/lib/statutory/forms', () => ({
    EMPTY_CATALOGUE_REASON: null,
    get PUBLISHED_FORM_VERSIONS() { return catalogue.versions; },
    FIELD_MAPS: [],
    fieldMapFor: () => null,
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MarketplaceService } from '../../../server/services/marketplace.service';

const PUBLISHED = {
    formId: FORM, version: REVISION,
    effectiveFrom: Date.UTC(2026, 0, 1), mandatoryFrom: Date.UTC(2026, 0, 1),
    effectiveUntil: null, withdrawn: null,
    sourceUrl: 'https://example.gov/forms/flat.pdf',
    sourceHash: '11'.repeat(32),
    publishedBy: 'a.operator', publishedAt: Date.UTC(2026, 0, 1),
};

const TENANT = '00000000-0000-0000-0000-000000000001';
const KEY = `_platform/statutory-forms/${FORM}/${encodeURIComponent(REVISION)}.pdf`;

const packFor = (revision?: string) => ({
    schemaVersion: 2,
    sections: [],
    statutoryForm: {
        formId: FORM,
        bindings: {},
        ...(revision === undefined ? {} : { revision }),
    },
});

/** Records what was asked for, so "it never looked" is distinguishable from "it looked and found". */
let asked: string[];

function bucket(present: boolean): R2Bucket {
    return {
        head: async (key: string) => {
            asked.push(key);
            return present ? ({ key } as unknown as R2Object) : null;
        },
    } as unknown as R2Bucket;
}

describe('installing a statutory package needs the authority PDF first', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        asked = [];
        catalogue.versions = [PUBLISHED];
        const fix = createTestDb();
        testDb = fix.db; sqlite = fix.sqlite;
        await setupSchema(sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    async function seed(id: string, revision?: string) {
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id, name: 'Flat form', kind: 'statutory', semver: '1.0.0',
            schema: JSON.stringify(packFor(revision)),
            authorId: 'system', changelog: null, downloadCount: 0, featured: false,
            createdAt: now, updatedAt: now,
            propertyType: null, jurisdiction: 'YY', inspectionKind: null,
        } as typeof marketplaceLibraries.$inferInsert);
    }

    const service = (present: boolean) =>
        new MarketplaceService(toRawD1(sqlite), TENANT, bucket(present));

    it('refuses, and installs NOTHING, while the bytes are absent', async () => {
        await seed('stat-1', REVISION);

        await expect(service(false).importCatalogEntry('stat-1', 'u1'))
            .rejects.toThrow(/needs the official file/i);

        // The whole point: not a half-install. A workspace that sees an error
        // and a marker has the state this refusal exists to prevent.
        expect(await testDb.select().from(schema.templates).all()).toHaveLength(0);
        expect(await testDb.select().from(tenantLibraryImports).all()).toHaveLength(0);
        // It looked under the shared platform key, not a tenant one.
        expect(asked).toEqual([KEY]);
    });

    it('names the revision, the form and where the file goes', async () => {
        // An operator standing in a downloads folder needs to know WHICH file.
        await seed('stat-1', REVISION);
        await expect(service(false).importCatalogEntry('stat-1', 'u1'))
            .rejects.toThrow(new RegExp(`${REVISION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        await expect(service(false).importCatalogEntry('stat-1', 'u1'))
            .rejects.toThrow(/statutory-forms/);
    });

    it('POSITIVE CONTROL — installs when the bytes are there', async () => {
        await seed('stat-1', REVISION);
        const result = await service(true).importCatalogEntry('stat-1', 'u1');
        expect(result.localEntityId).toBeTruthy();
        expect(await testDb.select().from(tenantLibraryImports).all()).toHaveLength(1);
        expect(asked).toEqual([KEY]);
    });

    it('refuses a package built for a revision this software does not publish', async () => {
        // No field map and no recorded hash exist for it, so nothing could ever
        // verify or render it. Refused at the door rather than at produce time.
        await seed('stat-old', 'Rev. 01/25');
        await expect(service(true).importCatalogEntry('stat-old', 'u1'))
            .rejects.toThrow(/publishes no such revision/i);
        expect(await testDb.select().from(schema.templates).all()).toHaveLength(0);
    });

    it('falls back to the revision in force when the package names none', async () => {
        // A template predating the `revision` key makes no claim, so the check
        // uses the revision an inspection created today would resolve to.
        await seed('stat-quiet');
        await expect(service(false).importCatalogEntry('stat-quiet', 'u1'))
            .rejects.toThrow(/needs the official file/i);
        expect(asked).toEqual([KEY]);
    });

    it('checks nothing when this deployment publishes no revision at all', async () => {
        // ⚠️ The "never guess" half, and the reason the fallback above is not a
        // blanket rule: with an empty catalogue there is no key to look for, and
        // refusing would block every statutory install on every deployment that
        // ships as this one does. The produce path refuses that case in its own
        // words, which is a legible failure rather than an invisible one.
        catalogue.versions = [];
        await seed('stat-quiet');
        const result = await service(false).importCatalogEntry('stat-quiet', 'u1');
        expect(result.kind).toBe('statutory');
        expect(asked).toEqual([]);
    });
});
