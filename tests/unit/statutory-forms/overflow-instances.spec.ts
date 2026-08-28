import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { StatutoryOverflowService } from '../../../server/services/statutory/overflow.service';

/**
 * The instances a form has no slot to print.
 *
 * Slots 0..capacity-1 are ordinary template items and their values live in the
 * inspection results. What has no item -- because the authority's page has no
 * box for it -- lives here.
 */
const TENANT = 't1';
const INSPECTION = 'i1';
const FORM = 'fl_citizens_4point';

let service: StatutoryOverflowService;

beforeEach(async () => {
    const { db, sqlite } = createTestDb();
    await setupSchema(sqlite);
    service = new StatutoryOverflowService(db as never);
});

describe('StatutoryOverflowService', () => {
    it('reads back nothing for an inspection that has recorded none', async () => {
        // Absent must be an empty map, not a throw: no third panel is the
        // ordinary case, and a caller should not have to guard against normal.
        expect(await service.instancesFor(TENANT, INSPECTION, FORM)).toEqual({});
    });

    it('keeps an added instance under the group it belongs to', async () => {
        await service.addInstance(TENANT, INSPECTION, FORM, 'electrical_panel', 2, {
            total_amps: '60', panel_age: '31',
        });
        // Index 2 is a POSITION: the two printed slots keep their places.
        expect(await service.instancesFor(TENANT, INSPECTION, FORM)).toEqual({
            electrical_panel: [{}, {}, { total_amps: '60', panel_age: '31' }],
        });
    });

    it('keeps two groups apart', async () => {
        await service.addInstance(TENANT, INSPECTION, FORM, 'electrical_panel', 2, { total_amps: '60' });
        await service.addInstance(TENANT, INSPECTION, FORM, 'roof', 2, { covering_material: 'Tile' });
        const read = await service.instancesFor(TENANT, INSPECTION, FORM);
        expect(Object.keys(read).sort()).toEqual(['electrical_panel', 'roof']);
        expect(read.roof).toEqual([{}, {}, { covering_material: 'Tile' }]);
    });

    it('keeps two forms on one inspection apart', async () => {
        // A Florida house commonly gets a four-point AND a wind-mitigation form
        // on the same visit. They are two documents.
        await service.addInstance(TENANT, INSPECTION, FORM, 'electrical_panel', 2, { total_amps: '60' });
        await service.addInstance(TENANT, INSPECTION, 'fl_oir_b1_1802', 'x', 2, { a: 'b' });
        expect(await service.instancesFor(TENANT, INSPECTION, FORM)).toEqual({
            electrical_panel: [{}, {}, { total_amps: '60' }],
        });
    });

    it('never reads another tenant\'s instances', async () => {
        await service.addInstance(TENANT, INSPECTION, FORM, 'electrical_panel', 2, { total_amps: '60' });
        expect(await service.instancesFor('other-tenant', INSPECTION, FORM)).toEqual({});
    });

    it('places instances at the index they were recorded at, leaving printed slots empty', async () => {
        // Index 2 with capacity 2 means "the third panel". The two before it are
        // printed slots supplied by bindings, so this array must not shift them
        // down -- an instance that slid to index 0 would silently overwrite the
        // Main Panel.
        await service.addInstance(TENANT, INSPECTION, FORM, 'electrical_panel', 3, { total_amps: '15' });
        const read = await service.instancesFor(TENANT, INSPECTION, FORM);
        expect(read.electrical_panel).toHaveLength(4);
        expect(read.electrical_panel[3]).toEqual({ total_amps: '15' });
        expect(read.electrical_panel[0]).toEqual({});
    });

    it('replaces the value of a field already recorded for that instance', async () => {
        await service.addInstance(TENANT, INSPECTION, FORM, 'electrical_panel', 2, { total_amps: '60' });
        await service.addInstance(TENANT, INSPECTION, FORM, 'electrical_panel', 2, { total_amps: '90' });
        expect(await service.instancesFor(TENANT, INSPECTION, FORM)).toEqual({
            electrical_panel: [{}, {}, { total_amps: '90' }],
        });
    });
});
