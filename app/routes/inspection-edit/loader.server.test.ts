// @vitest-environment node
/**
 * The editor loader's section overlay.
 *
 * -- WHAT WENT WRONG --------------------------------------------------------
 * The loader replaces the template snapshot's `sections` WHOLESALE with
 * report-data's projection, and that projection deliberately carries no
 * `attributes` (a declared skip in `scripts/check-item-key-parity.mjs`: the
 * report does not need them). `ItemEditor` renders `ItemAttributesPanel` only
 * when `item.attributes` is a non-empty array, so the panel — built, wired to
 * `onItemAttribute`, and correct — never once received data.
 *
 * Measured 2026-08-30 across the seed templates: 47 statutory bindings resolve
 * from `item_attribute` (TREC 23, FL Citizens roof 24) and not one of them was
 * answerable; `residential.json` carries 21 more attribute definitions that no
 * inspector could reach either. TREC is published and in use.
 *
 * The fix merges the snapshot's attributes back onto the projected items. It
 * does NOT change the projection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inspectionGet = vi.fn();
const resultsGet = vi.fn();
const reportDataGet = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn().mockResolvedValue('tok'),
}));
vi.mock('~/lib/load-context', () => ({
    getCloudflareEnv: () => ({}),
}));
vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        inspections: {
            ':id': {
                $get: inspectionGet,
                results: { $get: resultsGet },
                'report-data': { $get: reportDataGet },
                units: { $get: async () => null },
                'unit-progress': { $get: async () => null },
                compliance: { $get: async () => null },
            },
        },
        tags: { index: { $get: async () => null } },
        sessionContext: { context: { $get: async () => null } },
        defectCategories: { 'defect-categories': { $get: async () => null } },
    })),
}));

import { loader } from './loader.server';
import { routeArgs } from '../../../tests/helpers/route-args';

const CONTEXT = {} as Parameters<typeof loader>[0]['context'];

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), {
    headers: { 'content-type': 'application/json' },
});

/** Two roof-cover attributes, exactly the shape a statutory binding names. */
const ATTRIBUTES = [
    { id: 'roof_cover_material', name: 'Roof cover material', type: 'select', choices: ['Shingle', 'Tile'] },
    { id: 'roof_cover_condition', name: 'Condition', type: 'select', choices: ['Good', 'Worn'] },
];

/** The inspection's own template snapshot — the ONLY place attributes live. */
const SNAPSHOT = {
    schemaVersion: 2,
    sections: [{
        id: 'sec_roof',
        title: 'Roof',
        items: [
            { id: 'itm_cover', label: 'Roof cover', type: 'rich', attributes: ATTRIBUTES },
            { id: 'itm_flashing', label: 'Flashing', type: 'rich' },
        ],
    }],
};

/**
 * report-data's projection of the same template. Note what it does NOT carry:
 * `attributes` on `itm_cover`. That omission is the decision under test.
 */
const REPORT_SECTIONS = [{
    id: 'sec_roof',
    name: 'Roof',
    items: [
        { id: 'itm_cover', name: 'Roof cover', type: 'rich' },
        { id: 'itm_flashing', name: 'Flashing', type: 'rich' },
    ],
}];

type LoadedItem = { id: string; label?: string; attributes?: unknown[] };
type LoadedSection = { title?: string; items?: LoadedItem[] };

async function load() {
    const request = new Request('https://acme.example.com/inspections/insp-1/edit');
    const data = await loader(routeArgs(request, { params: { id: 'insp-1' }, context: CONTEXT }));
    return (data.schema as { sections: LoadedSection[] }).sections;
}

const itemById = (sections: LoadedSection[], id: string) =>
    sections.flatMap((s) => s.items ?? []).find((i) => i.id === id);

beforeEach(() => {
    inspectionGet.mockReset().mockResolvedValue(json({
        inspection: { id: 'insp-1', date: '2026-05-01', templateSnapshot: SNAPSHOT },
    }));
    resultsGet.mockReset().mockResolvedValue(json({ results: {}, resultId: 'res-1' }));
    reportDataGet.mockReset().mockResolvedValue(json({
        sections: REPORT_SECTIONS,
        ratingLevels: [],
    }));
});

describe('editor loader — item attributes survive the report-data overlay', () => {
    it('carries the snapshot attributes onto the projected item', async () => {
        // The whole defect in one assertion: before the merge this was
        // `undefined`, and `ItemEditor`'s guard turned the panel off.
        const item = itemById(await load(), 'itm_cover');
        expect(item?.attributes).toHaveLength(2);
        expect((item?.attributes as Array<{ id: string }>).map((a) => a.id))
            .toEqual(['roof_cover_material', 'roof_cover_condition']);
    });

    it('NEGATIVE CONTROL — an item the snapshot gives no attributes gets none', async () => {
        // Without this, a loader that stamped the same array onto every item
        // would satisfy the assertion above.
        expect(itemById(await load(), 'itm_flashing')?.attributes).toBeUndefined();
    });

    it('POSITIVE CONTROL — the projection still wins for everything else', async () => {
        // The overlay exists because report-data resolves rating levels and
        // section data. Merging attributes back must not undo it: the label
        // here comes from the projection's `name`, not from the snapshot.
        const sections = await load();
        expect(sections).toHaveLength(1);
        expect(sections[0].title).toBe('Roof');
        expect(itemById(sections, 'itm_cover')?.label).toBe('Roof cover');
    });

    it('does not invent attributes for an item the projection added', async () => {
        // An id present only in the projection has no snapshot entry to merge.
        reportDataGet.mockResolvedValue(json({
            sections: [{
                id: 'sec_roof',
                name: 'Roof',
                items: [{ id: 'itm_added_later', name: 'Added later', type: 'rich' }],
            }],
            ratingLevels: [],
        }));
        expect(itemById(await load(), 'itm_added_later')?.attributes).toBeUndefined();
    });

    it('leaves the snapshot alone when report-data projects no sections', async () => {
        // The overlay is skipped entirely in that case; attributes were always
        // reachable on this path, and must stay so.
        reportDataGet.mockResolvedValue(json({ sections: [], ratingLevels: [] }));
        expect(itemById(await load(), 'itm_cover')?.attributes).toHaveLength(2);
    });
});
