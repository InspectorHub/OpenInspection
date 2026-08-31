/**
 * What updating a statutory package costs the inspections already in flight.
 *
 * The confirmation an administrator reads before pressing Update is built from
 * these two numbers, and they come from the same criterion as the editor banner
 * and the reschedule response. An update that reported only "3 inspections
 * affected" would be describing a risk; these say which of them still produce
 * their form and which cannot produce one at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

// `7-7` becomes mandatory on 2026-03-15. Spelled out inside the factory because
// `vi.mock` is hoisted above every binding in this file.
vi.mock('../../../server/lib/statutory/forms', () => {
    const base = {
        formId: 'tx_trec_rei',
        effectiveFrom: Date.UTC(2024, 0, 1),
        mandatoryFrom: null,
        effectiveUntil: null,
        withdrawn: null,
        sourceUrl: 'https://www.trec.texas.gov/x.pdf',
        sourceHash: 'a'.repeat(64),
        publishedBy: 'platform',
        publishedAt: Date.UTC(2024, 0, 1),
    };
    return {
        PUBLISHED_FORM_VERSIONS: [
            { ...base, version: '7-6' },
            { ...base, version: '7-7', mandatoryFrom: Date.UTC(2026, 2, 15) },
            // Withdrawn, and for a stated reason -- the dialog's copy branches
            // on which of the two it was, so a catalogue that only knew "not
            // produced any more" could not be tested against it.
            {
                ...base,
                version: '7-5',
                withdrawn: { at: Date.UTC(2026, 0, 5), reason: 'field_map_incorrect' },
            },
        ],
        FIELD_MAPS: [],
        EMPTY_CATALOGUE_REASON: null,
        fieldMapFor: () => null,
    };
});

// eslint-disable-next-line import/order
import { eq } from 'drizzle-orm';
// eslint-disable-next-line import/order
import { PUBLISHED_FORM_VERSIONS } from '../../../server/lib/statutory/forms';
// eslint-disable-next-line import/order
import { statutoryUpdateImpact } from '../../../server/services/marketplace/statutory-update-impact';

const TENANT = 't1';
const LIBRARY = 'lib-statutory';
const OLD_LOCAL = 'tpl-7-6';
const NOW = Date.UTC(2026, 0, 10);

function snapshot(revision: string) {
    return {
        schemaVersion: 2 as const,
        sections: [],
        statutoryForm: { formId: 'tx_trec_rei', bindings: {}, revision },
    };
}

/** The counter takes the service's `drizzle(env.DB)` handle; better-sqlite3's
 *  handle answers every query it makes but is not that nominal type. */
type ImpactDb = Parameters<typeof statutoryUpdateImpact>[0];

describe('statutoryUpdateImpact', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const made = createTestDb();
        await setupSchema(made.sqlite);
        db = made.db as unknown as BetterSQLite3Database<typeof schema>;

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.marketplaceLibraries).values({
            id: LIBRARY, name: 'TREC REI', kind: 'statutory', semver: '1.1.0',
            schema: snapshot('7-7'), authorId: 'system', changelog: '',
            downloadCount: 0, featured: false, createdAt: new Date(), updatedAt: new Date(),
        });
        await db.insert(schema.templates).values({
            id: OLD_LOCAL, tenantId: TENANT, name: 'TREC REI 7-6',
            schema: snapshot('7-6'), createdAt: new Date(),
        });
        await db.insert(schema.tenantLibraryImports).values({
            id: 'imp1', tenantId: TENANT, libraryId: LIBRARY, importedSemver: '1.0.0',
            localEntityId: OLD_LOCAL, rowCount: 0, importedAt: new Date(),
        });
    });

    async function addInspection(id: string, date: string, status: 'scheduled' | 'cancelled') {
        await db.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: `${id} St`, date, status,
            templateId: OLD_LOCAL, templateSnapshot: snapshot('7-6'), createdAt: new Date(),
        });
    }

    it('separates the inspections that still produce their form from the ones that cannot', async () => {
        await addInspection('i1', '2026-03-01', 'scheduled');   // inside 7-6's window
        await addInspection('i2', '2026-03-10', 'scheduled');   // inside 7-6's window
        await addInspection('i3', '2026-03-20', 'scheduled');   // falls under 7-7

        const impact = await statutoryUpdateImpact(db as unknown as ImpactDb, TENANT, LIBRARY, NOW);

        expect(impact.total).toBe(3);
        // The reassuring number, and the one that must not be omitted: two of
        // these are dated inside the superseded revision's window and go out
        // exactly as they would have.
        expect(impact.producible).toBe(2);
        // The cost, stated before the button rather than discovered after it.
        expect(impact.blocked).toBe(1);
        expect(impact.fromRevision).toBe('7-6');
        expect(impact.toRevision).toBe('7-7');
    });

    it('reports zero blocked when nothing in flight crosses the cutover', async () => {
        // The positive control. A counter that called every in-flight inspection
        // blocked would pass the assertion above on its `blocked` half, and this
        // is what catches it: the same three dates, none of them past 2026-03-15.
        await addInspection('i1', '2026-03-01', 'scheduled');
        await addInspection('i2', '2026-03-10', 'scheduled');
        await addInspection('i3', '2026-03-14', 'scheduled');

        const impact = await statutoryUpdateImpact(db as unknown as ImpactDb, TENANT, LIBRARY, NOW);
        expect(impact.total).toBe(3);
        expect(impact.producible).toBe(3);
        expect(impact.blocked).toBe(0);
    });

    it('does not count a cancelled inspection', async () => {
        // It will never be delivered, so counting it would overstate what this
        // update costs -- and the number's whole job is to be the real cost.
        await addInspection('i1', '2026-03-20', 'cancelled');
        const impact = await statutoryUpdateImpact(db as unknown as ImpactDb, TENANT, LIBRARY, NOW);
        expect(impact.total).toBe(0);
        expect(impact.blocked).toBe(0);
    });

    it('reports the withdrawal behind the revision the workspace is leaving', async () => {
        // Every inspection on a withdrawn revision is blocked, for one reason,
        // and `producible` has to say so: a confirmation reporting "3 still
        // produce their form" about a revision that produces nothing is worse
        // than one that reported no numbers at all.
        await db.update(schema.templates)
            .set({ schema: snapshot('7-5') })
            .where(eq(schema.templates.id, OLD_LOCAL));
        await addInspection('i1', '2026-03-01', 'scheduled');
        await addInspection('i2', '2026-03-10', 'scheduled');
        await db.update(schema.inspections).set({ templateSnapshot: snapshot('7-5') });

        const impact = await statutoryUpdateImpact(db as unknown as ImpactDb, TENANT, LIBRARY, NOW);
        expect(impact.total).toBe(2);
        expect(impact.producible).toBe(0);
        expect(impact.blocked).toBe(2);
        // The reason, not merely the fact. Read off the catalogue rather than
        // retyped here, so a service that hard-coded one reason cannot pass.
        expect(impact.fromWithdrawal).toEqual(
            PUBLISHED_FORM_VERSIONS.find((v) => v.version === '7-5')?.withdrawn,
        );
    });

    it('reports the withdrawal even with nothing in flight to count', async () => {
        // The quiet case, and the one a loop-derived answer loses: an
        // administrator pressing Update with no inspections in progress would
        // otherwise be told nothing at all about why the revision they are
        // leaving stopped producing.
        await db.update(schema.templates)
            .set({ schema: snapshot('7-5') })
            .where(eq(schema.templates.id, OLD_LOCAL));

        const impact = await statutoryUpdateImpact(db as unknown as ImpactDb, TENANT, LIBRARY, NOW);
        expect(impact.total).toBe(0);
        expect(impact.fromWithdrawal?.reason).toBe('field_map_incorrect');
    });

    it('POSITIVE CONTROL — a live revision reports no withdrawal', async () => {
        // Without this, a service that returned some withdrawal unconditionally
        // would satisfy both assertions above.
        await addInspection('i1', '2026-03-01', 'scheduled');
        const impact = await statutoryUpdateImpact(db as unknown as ImpactDb, TENANT, LIBRARY, NOW);
        expect(impact.fromRevision).toBe('7-6');
        expect(impact.fromWithdrawal).toBeNull();
    });

    it('counts nothing for a tenant that never installed the package', async () => {
        await addInspection('i1', '2026-03-20', 'scheduled');
        const impact = await statutoryUpdateImpact(db as unknown as ImpactDb, 'someone-else', LIBRARY, NOW);
        expect(impact.total).toBe(0);
        expect(impact.fromRevision).toBeNull();
    });
});
