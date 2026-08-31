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

/**
 * What `GET /statutory-details` answers. `null` is the ordinary case — the
 * endpoint 404s for every inspection whose template declares no statutory form
 * — so it is the default, and the tests that care set it.
 */
let statutoryDetailsResponse: Response | null = null;

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
                // Fetched unconditionally by the loader, and it 404s for every
                // ORDINARY inspection — that absence is its answer, not a
                // failure, and the null it leaves behind is what decides
                // whether the statutory panel renders at all. So the stub is a
                // variable rather than a constant: both answers are real
                // states of this endpoint and the tests below exercise each.
                //
                // ⚠️ It was missing entirely, and the loader's `.catch()` could
                // not save it. The throw is
                // `api.inspections[":id"]["statutory-details"]` being
                // `undefined`, which happens while BUILDING the promise — there
                // is no promise yet for `.catch` to attach to. All five tests in
                // this file died on it, and none of them is about this endpoint.
                'statutory-details': { $get: async () => statutoryDetailsResponse },
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

/** The loader's whole return value. `load()` narrows it to the sections. */
async function loadAll() {
    const request = new Request('https://acme.example.com/inspections/insp-1/edit');
    return loader(routeArgs(request, { params: { id: 'insp-1' }, context: CONTEXT }));
}

async function load() {
    const data = await loadAll();
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
    statutoryDetailsResponse = null;   // the ordinary inspection: no statutory form
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

/**
 * `statutoryDetails` — both answers, because both are ordinary.
 *
 * This endpoint 404s for every inspection whose template declares no statutory
 * form, and the `null` that leaves behind is what decides whether the panel
 * renders at all. Its stub was simply MISSING from this file's api mock: the
 * loader gained the call in `d956c55a` and the mock was never extended, so
 * `api.inspections[":id"]["statutory-details"]` was `undefined` and all five
 * tests above threw before reaching a single assertion. The loader's
 * `.catch(() => null)` cannot absorb that — the throw happens while building
 * the promise, so there is nothing yet to attach a handler to.
 *
 * Asserting only the null case would leave the same hole one layer down: a
 * loader that dropped the payload on the floor would still pass it.
 */
describe('editor loader — the statutory details the panel switches on', () => {
    it('is null for an ordinary inspection, which is the answer and not a failure', async () => {
        statutoryDetailsResponse = null;
        expect((await loadAll()).statutoryDetails).toBeNull();
    });

    it('POSITIVE CONTROL — the payload reaches the route when the endpoint has one', async () => {
        // Without this the assertion above passes for a loader that never reads
        // the response at all.
        statutoryDetailsResponse = json({ inspectorSignatureDate: '2026-05-02', ownerName: 'Dana Whitfield' });
        const details = (await loadAll()).statutoryDetails;
        expect(details).not.toBeNull();
        expect(details?.inspectorSignatureDate).toBe('2026-05-02');
        expect(details?.ownerName).toBe('Dana Whitfield');
    });

    it('stays null when the endpoint answers but carries no data', async () => {
        // `{ success: true }` with no `data` is not the same shape as a 404 and
        // must not become an empty object the panel would render as blank boxes.
        statutoryDetailsResponse = new Response(JSON.stringify({ success: true }), {
            headers: { 'content-type': 'application/json' },
        });
        expect((await loadAll()).statutoryDetails).toBeNull();
    });
});
