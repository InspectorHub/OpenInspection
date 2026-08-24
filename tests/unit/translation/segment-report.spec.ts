/**
 * The segmenter is the ONE place a span of a report becomes eligible to reach a
 * model, and these four properties are what make that claim checkable.
 *
 * ## Why it enumerates rather than filters
 *
 * A filter is a deny-list, and a deny-list written against a payload shape
 * silently re-opens the moment the payload grows a field. That is not a
 * hypothetical here: the assembled reliance block reaches the report payload as
 * `relianceText`, it was on no exclusion list anywhere in the tree, and nothing
 * would have kept it out of a translation request. So the register enumerates
 * PERMITTED keys, every other key is named with a reason, and an UNREGISTERED
 * key fails — it does not default in either direction.
 *
 * ## Every negative assertion has a positive control beside it
 *
 * "The output contains none of the reliance text" is satisfied by a segmenter
 * that returns nothing at all. So each exclusion assertion is paired with the
 * same call yielding a finding's own prose. Two failures look identical to a
 * reader and only one of them is real; the pair is what tells them apart.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionReportService } from '../../../server/services/inspection/inspection-report.service';
import { RELIANCE_TEMPLATES } from '../../../server/lib/pca-reliance-text';
import { NON_TRANSLATABLE_MANIFEST } from '../../../server/lib/legal/non-translatable-manifest';
import {
    REPORT_SPAN_REGISTER,
    PERMITTED_LEAF_FIELDS,
} from '../../../server/lib/translation/report-span-register';
import { segmentReport } from '../../../server/lib/translation/segment-report';

const TENANT = 't-seg';
const INSPECTION = 'insp-seg';

/** A finding note that must survive. The positive control for every exclusion. */
const FINDING_NOTE = 'Active moisture staining at the north sheathing bay.';
/** A defect comment, likewise. */
const DEFECT_COMMENT = 'Flashing at the chimney saddle is displaced.';
/** A per-section disclaimer. Registered instrument text; must NOT survive. */
const SECTION_DISCLAIMER = 'This section is limited to what was readily visible.';

/**
 * The report's structure comes from the per-inspection template SNAPSHOT, not
 * from the live template row — the snapshot is what the inspector actually
 * filled in. Both carry it here so the seed matches production.
 */
const REPORT_SCHEMA = {
    schemaVersion: 2,
    sections: [{
        id: 'roof',
        title: 'Roof',
        disclaimerText: SECTION_DISCLAIMER,
        items: [{
            id: 'covering',
            label: 'Roof covering',
            type: 'rich',
            tabs: {
                information: [
                    { id: 'i1', title: 'Material', comment: 'Asphalt shingle, three-tab.', default: true },
                ],
                limitations: [
                    { id: 'l1', title: 'Access', comment: 'The roof was viewed from the eaves only.', default: true },
                ],
                defects: [
                    {
                        id: 'd1', title: 'Displaced flashing', category: 'defect',
                        location: 'Chimney', comment: DEFECT_COMMENT, photos: [], default: true,
                    },
                ],
            },
        }],
    }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let payload: any;

beforeAll(async () => {
    const { sqlite, db } = createTestDb();
    await setupSchema(sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'seg-tenant', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await db.insert(schema.templates).values({
        id: 'tpl-seg',
        tenantId: TENANT,
        name: 'Seg template',
        createdAt: new Date(),
        updatedAt: new Date(),
        schema: REPORT_SCHEMA,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await db.insert(schema.inspections).values({
        id: INSPECTION,
        tenantId: TENANT,
        templateId: 'tpl-seg',
        templateSnapshot: REPORT_SCHEMA,
        createdAt: new Date(),
        updatedAt: new Date(),
        propertyAddress: '12 Calle Mayor',
        date: '2026-08-24',
        status: 'completed',
        propertyType: 'commercial',
        reportTier: 'full_pca',
        pcaNarrative: { userReliance: RELIANCE_TEMPLATES.userReliance },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await db.insert(schema.inspectionResults).values({
        id: 'res-seg',
        tenantId: TENANT,
        inspectionId: INSPECTION,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSyncedAt: new Date(),
        // Findings are keyed `<unit>:<section>:<item>` — see server/lib/finding-key.ts.
        data: {
            '_default:roof:covering': {
                rating: 'Defect',
                notes: FINDING_NOTE,
                tabs: { defects: [{ cannedId: 'd1', included: true }] },
            },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const service = new InspectionReportService({} as unknown as D1Database);
    payload = await service.getReportData(INSPECTION, TENANT, (k) => k);
});

describe('P1 — the register is total over the report payload', () => {
    it('names every top-level key the payload actually carries', () => {
        // Driven through the REAL service rather than a hand-written fixture.
        // A fixture supplies the keys its author remembered, which is the exact
        // failure this property exists to catch.
        const registered = new Set<string>(REPORT_SPAN_REGISTER.map((e) => e.key));
        const unregistered = Object.keys(payload).filter((k) => !registered.has(k));
        expect(unregistered, 'unregistered report payload key(s)').toEqual([]);
    });

    it('found a real payload to check, and not an empty object', () => {
        // The positive control for the assertion above: `{}` has no
        // unregistered keys either.
        expect(Object.keys(payload).length).toBeGreaterThan(20);
        expect(Object.keys(payload)).toContain('relianceText');
    });

    it('registers nothing the payload does not carry', () => {
        const actual = new Set(Object.keys(payload));
        const stale = REPORT_SPAN_REGISTER.map((e) => e.key).filter((k) => !actual.has(k));
        expect(stale, 'registered key(s) no longer in the payload').toEqual([]);
    });

    it('gives every entry a reason, including the ones that are not text', () => {
        for (const entry of REPORT_SPAN_REGISTER) {
            expect(entry.reason.trim().length, entry.key).toBeGreaterThan(20);
        }
    });
});

describe('P2 — the reliance block never reaches a span, and findings do', () => {
    it('emits none of the reliance text', () => {
        const joined = segmentReport(payload).map((s) => s.text).join('\n');
        for (const field of ['userReliance', 'pointInTime', 'siteSpecific'] as const) {
            expect(joined).not.toContain(RELIANCE_TEMPLATES[field]);
        }
    });

    it('emits the finding note and the defect comment — the positive control', () => {
        // Without this, a segmenter that returned [] would pass the assertion
        // above and every other exclusion in this file.
        const joined = segmentReport(payload).map((s) => s.text).join('\n');
        expect(joined).toContain(FINDING_NOTE);
        expect(joined).toContain(DEFECT_COMMENT);
    });

    it('emits no span whose path is outside a permitted key', () => {
        const permitted = new Set(
            REPORT_SPAN_REGISTER
                .filter((e) => e.disposition === 'convenience_translation')
                .map((e) => e.key),
        );
        expect(permitted.size).toBeGreaterThan(0);
        for (const span of segmentReport(payload)) {
            expect(permitted, span.path).toContain(span.path.split('.')[0]);
        }
    });

    it('leaves a registered per-section disclaimer in English', () => {
        // `disclaimerText` is a locator in the non-translatable registry. It
        // sits INSIDE a permitted key, which is why the leaf enumeration exists
        // and why a key-level answer alone would not be enough.
        const joined = segmentReport(payload).map((s) => s.text).join('\n');
        expect(joined).not.toContain(SECTION_DISCLAIMER);
    });

    it('emits no empty or whitespace-only span', () => {
        for (const span of segmentReport(payload)) {
            expect(span.text.trim().length, span.path).toBeGreaterThan(0);
        }
    });
});

describe('P3 — the register agrees with the non-translatable registry', () => {
    it('permits no key that the registry names as a locator', () => {
        const locators = new Set(NON_TRANSLATABLE_MANIFEST.map((e) => e.locator));
        const permitted = REPORT_SPAN_REGISTER
            .filter((e) => e.disposition === 'convenience_translation')
            .map((e) => e.key);
        expect(permitted.length).toBeGreaterThan(0);
        expect(permitted.filter((k) => locators.has(k))).toEqual([]);
    });

    it('permits no LEAF field that the registry names as a locator', () => {
        // The sharper half. `relianceText` is a top-level key and easy to see;
        // `disclaimerText` is a leaf three levels down inside a key that IS
        // permitted, and a key-level check would never have looked at it.
        const locators = new Set(NON_TRANSLATABLE_MANIFEST.map((e) => e.locator));
        const leaves = Object.values(PERMITTED_LEAF_FIELDS).flat();
        expect(leaves.length).toBeGreaterThan(0);
        expect(leaves.filter((f) => locators.has(f))).toEqual([]);
    });

    it('names disclaimerText as a locator, so the check above is not vacuous', () => {
        // The positive control for both assertions: if the registry stopped
        // carrying locators of this shape, they would pass against anything.
        const locators = new Set(NON_TRANSLATABLE_MANIFEST.map((e) => e.locator));
        expect(locators).toContain('disclaimerText');
        expect(locators).toContain('relianceText');
    });
});

describe('P4 — order is stable', () => {
    it('produces an identical path sequence on two calls', () => {
        const a = segmentReport(payload).map((s) => s.path);
        const b = segmentReport(payload).map((s) => s.path);
        expect(a.length).toBeGreaterThan(0);
        expect(a).toEqual(b);
    });

    it('produces unique paths, so a translation can be re-inserted positionally', () => {
        const paths = segmentReport(payload).map((s) => s.path);
        expect(new Set(paths).size).toBe(paths.length);
    });
});

describe('the segmenter is the only caller of the translate path', () => {
    it('nothing outside server/lib/translation/ calls translateSegments', () => {
        const root = join(import.meta.dirname, '../../..');
        const hits: string[] = [];
        const stack = [join(root, 'server'), join(root, 'app'), join(root, 'workers')];
        while (stack.length) {
            const dir = stack.pop()!;
            for (const name of readdirSync(dir)) {
                const full = join(dir, name);
                if (statSync(full).isDirectory()) { stack.push(full); continue; }
                if (!/\.tsx?$/.test(name)) continue;
                const rel = relative(root, full).split(sep).join('/');
                // The chokepoint declares the method; the translation module is
                // the one caller. Everything else reaching it would widen the
                // input, and `translate-response.ts` checks LENGTH, which a
                // widened segment list satisfies perfectly.
                if (rel === 'server/services/ai.service.ts') continue;
                if (rel.startsWith('server/lib/translation/')) continue;
                if (/\btranslateSegments\s*\(/.test(readFileSync(full, 'utf8'))) hits.push(rel);
            }
        }
        expect(hits).toEqual([]);
    });
});
