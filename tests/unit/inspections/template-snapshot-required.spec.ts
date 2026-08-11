/**
 * The template snapshot is required, not preferred (#307).
 *
 * Four consumers used to fall back to the LIVE `templates.schema` when an
 * inspection carried no snapshot. That made the snapshot a convention rather
 * than a guarantee: the next row that missed one silently re-acquired today's
 * template structure and nothing failed. A report re-derived that way is not
 * the report the inspector filled in, and there was no signal it happened.
 *
 * The publish gate is driven through the REAL service here, not by re-reading
 * the table: a test that inspected the row would pass whether or not the
 * service still consults the live template.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import {
    requireTemplateSnapshot,
    templateSnapshotSectionsOrNone,
} from '../../../server/services/inspection/shared';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { InspectionService } from '../../../server/services/inspection.service';

const TENANT = 'tenant-snapshot-required';
const TEMPLATE_ID = 'tpl-snapshot';
const INSPECTION_ID = 'insp-snapshot';

/** A structure with one rich item, so a readiness walk has something to walk. */
function structure(itemId: string, itemLabel: string) {
    return {
        schemaVersion: 2,
        sections: [{
            id: 'sec1', title: 'Roof', items: [{
                id: itemId, label: itemLabel, type: 'rich',
                ratingOptions: ['Inspected', 'Repair'],
                tabs: { information: [], limitations: [], defects: [] },
            }],
        }],
    };
}

describe('requireTemplateSnapshot — the two absences are not the same fault', () => {
    it('returns the snapshot when it is there, parsing a string column', () => {
        const parsed = requireTemplateSnapshot(
            { id: 'i1', templateId: TEMPLATE_ID, templateSnapshot: JSON.stringify(structure('a', 'Roof Covering')) },
            TENANT,
        );
        expect(parsed.sections).toHaveLength(1);
        expect(parsed.sections[0].items[0].label).toBe('Roof Covering');
    });

    it('THROWS when the row names a template but carries no snapshot', () => {
        // This is the state the live-template fallback used to paper over, and
        // the whole reason the helper exists. Errors.Internal → HTTP 500: the
        // caller did nothing wrong, an invariant of ours was violated.
        expect(() => requireTemplateSnapshot(
            { id: 'i1', templateId: TEMPLATE_ID, templateSnapshot: null }, TENANT,
        )).toThrow(/no template snapshot/i);
    });

    it('accepts a snapshot whose sections array is EMPTY', () => {
        // The four fallback sites tested `sections.length > 0`, but they were
        // asking "is there anything worth preferring over the live template".
        // As a required check that test is wrong: `{ sections: [] }` is what an
        // inspection filled against the blank starter template that first-run
        // setup creates in every standalone install faithfully records. It is a
        // correct snapshot of an empty structure, not a missing one — and
        // rejecting it would 500 the hub page of a fresh deployment.
        const parsed = requireTemplateSnapshot(
            { id: 'i1', templateId: TEMPLATE_ID, templateSnapshot: { sections: [] } }, TENANT,
        );
        expect(parsed.sections).toEqual([]);
    });

    it('THROWS for a snapshot string that is not JSON', () => {
        expect(() => requireTemplateSnapshot(
            { id: 'i1', templateId: TEMPLATE_ID, templateSnapshot: 'not json' }, TENANT,
        )).toThrow(/no template snapshot/i);
    });

    it('does NOT throw when there is no template at all — there is no lost structure', () => {
        // A template-less inspection never had a structure to freeze and the
        // fallback never fired for it either (no template row to fall back to).
        // Throwing here would turn a legitimate row into a 500 on its own
        // report page. Yields no sections, exactly as the old code did.
        const parsed = requireTemplateSnapshot({ id: 'i1', templateId: null, templateSnapshot: null }, TENANT);
        expect(parsed.sections).toEqual([]);
    });
});

describe('templateSnapshotSectionsOrNone — degrades, but never reads the live template', () => {
    it('returns the snapshot sections when present', () => {
        const sections = templateSnapshotSectionsOrNone(
            { id: 'i1', templateId: TEMPLATE_ID, templateSnapshot: structure('a', 'Roof Covering') },
            TENANT,
        );
        expect(sections).toHaveLength(1);
    });

    it('returns nothing rather than throwing when the snapshot is missing', () => {
        // The two label-map callers already degraded to using the item id as
        // its own label. Making them throw would turn a cosmetic degradation
        // into a broken photo drawer. Silence is what is forbidden, not the
        // degradation — the miss is logged.
        expect(templateSnapshotSectionsOrNone(
            { id: 'i1', templateId: TEMPLATE_ID, templateSnapshot: null }, TENANT,
        )).toEqual([]);
    });
});

describe('computePublishReadiness stops re-acquiring the live template', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let svc: InspectionService;

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db;
        sqlite = fx.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'T', slug: 'snapshot-required', createdAt: new Date(),
        } as never);
        // The LIVE template differs from what the inspection was filled
        // against. If anything still reads it, the difference shows.
        await db.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', version: 7,
            schema: JSON.stringify(structure('todays-item', "Today's Item")),
            createdAt: new Date(),
        } as never);

        svc = new InspectionService({} as never);
    });

    afterEach(() => { sqlite.close(); });

    async function seedInspection(templateSnapshot: unknown) {
        await db.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            templateId: TEMPLATE_ID, templateSnapshot, date: '2026-08-11',
            status: 'scheduled', createdAt: new Date(),
        } as never);
    }

    it('with a snapshot, the answer is unchanged', async () => {
        await seedInspection(JSON.stringify(structure('frozen-item', 'Frozen Item')));
        const readiness = await svc.computePublishReadiness(INSPECTION_ID, TENANT);
        expect(readiness.ready).toBe(true);
        expect(readiness.blockingDefects).toEqual([]);
    });

    it('with NO snapshot and a live template that differs, it now throws', async () => {
        // Before #307 this returned a readiness computed against
        // `structure('todays-item', ...)` — today's template, not the one the
        // inspection was filled against — and reported ready:true, silently.
        await seedInspection(null);
        await expect(svc.computePublishReadiness(INSPECTION_ID, TENANT))
            .rejects.toThrow(/no template snapshot/i);
    });
});
