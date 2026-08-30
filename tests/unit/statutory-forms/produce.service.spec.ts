/**
 * The production line: which revision, whose bytes, which values, one PDF.
 *
 * Every refusal here exists because its alternative produces a document that
 * looks entirely correct. A near-miss revision is a real official form; bytes
 * that are not the published ones still render; a missing object degrades to a
 * blank. None of those announce themselves downstream, so all three are refused
 * before a document exists.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { produceStatutoryForm } from '../../../server/services/statutory/produce.service';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';
import type { FieldMap } from '../../../server/lib/statutory/field-map';
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../../server/types/template-schema';
import type { StatutoryInspectionFacts } from '../../../server/lib/statutory/values';
import { buildFlatPdf, type PdfFixture } from '../helpers/statutory-pdf-fixtures';

const FORM = 'yy_flat_form';
const OLD_REVISION = 'Rev. 01/12';
const NEW_REVISION = 'Rev. 04/26';

let flat: PdfFixture;

beforeAll(async () => {
    flat = await buildFlatPdf();
});

const versions = (): readonly StatutoryFormVersion[] => [
    {
        formId: FORM, version: OLD_REVISION,
        effectiveFrom: Date.UTC(2012, 0, 1),
        mandatoryFrom: Date.UTC(2012, 0, 1),
        effectiveUntil: Date.UTC(2026, 3, 1),
        sourceUrl: 'https://example.gov/old.pdf', sourceHash: flat.hash,
        publishedBy: 'a.operator', publishedAt: Date.UTC(2012, 0, 1),
        withdrawn: null,
    },
    {
        formId: FORM, version: NEW_REVISION,
        effectiveFrom: Date.UTC(2026, 3, 1),
        mandatoryFrom: Date.UTC(2026, 3, 1),
        effectiveUntil: null,
        sourceUrl: 'https://example.gov/new.pdf', sourceHash: flat.hash,
        publishedBy: 'a.operator', publishedAt: Date.UTC(2026, 3, 1),
        withdrawn: null,
    },
];

const mapFor = (version: string): FieldMap => ({
    formId: FORM, version, sourceHash: flat.hash,
    checkedBy: 'a.operator', checkedAt: Date.UTC(2026, 7, 21),
    requiredFields: ['owner.name'],
    mappings: [{ kind: 'overlay', ourField: 'owner.name', page: 1, x: 100, y: 500, size: 10 }],
});

const SNAPSHOT = {
    schemaVersion: 2,
    sections: [{ id: 'sec', title: 'S', items: [{ id: 'itm_owner', label: 'Owner', type: 'rich' }] }],
} as unknown as TemplateSchemaV2;

const DECLARATION: StatutoryFormDeclaration = {
    formId: FORM,
    bindings: { 'owner.name': { from: 'item', itemId: 'itm_owner' } },
};

const FACTS = {
    client_name: 'Zoe Ng', client_email: null, client_phone: null,
    property_address: '1 Main St', property_city: 'Austin', property_state: 'TX',
    property_zip: '78701', inspection_date: '2026-05-01',
    inspector_name: 'Sam Reed', inspector_license: 'TX-1',
    company_name: 'Reed Home Inspections', company_phone: '512-555-0142',
} satisfies StatutoryInspectionFacts;

/** An R2 stand-in holding one object per key. */
function bucketWith(entries: Record<string, Uint8Array>) {
    return {
        get: async (key: string) => {
            const bytes = entries[key];
            if (!bytes) return null;
            return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        },
    } as unknown as R2Bucket;
}

function ctx() {
    const store: Record<string, Uint8Array> = {
        [`_platform/statutory-forms/${FORM}/${encodeURIComponent(OLD_REVISION)}.pdf`]: flat.bytes,
        [`_platform/statutory-forms/${FORM}/${encodeURIComponent(NEW_REVISION)}.pdf`]: flat.bytes,
    };
    return {
        formId: FORM,
        inspectionDate: '2026-05-01',
        declaration: DECLARATION,
        snapshot: SNAPSHOT,
        results: { itm_owner: { rating: 'Zoe Ng' } },
        facts: FACTS,
        bucket: bucketWith(store),
        versions: versions(),
        fieldMapFor: (_formId: string, version: string) => mapFor(version),
    };
}

describe('produceStatutoryForm — which revision', () => {
    it('selects the revision by the INSPECTION date, not by "the latest"', async () => {
        const out = await produceStatutoryForm({ ...ctx(), inspectionDate: '2026-03-31' });
        expect(out.version.version).toBe(OLD_REVISION);
    });

    it('POSITIVE CONTROL — the day of the cutover takes the new revision', async () => {
        const out = await produceStatutoryForm({ ...ctx(), inspectionDate: '2026-04-01' });
        expect(out.version.version).toBe(NEW_REVISION);
    });

    it('refuses when we publish no revision covering that date', async () => {
        // Never "the nearest one": the nearest revision to a date it does not
        // cover is a different document.
        await expect(produceStatutoryForm({ ...ctx(), inspectionDate: '2000-01-01' }))
            .rejects.toThrow(/no published revision/i);
    });

    it('a WITHDRAWN revision is refused in different words, and names the reason', async () => {
        // Both absences leave `versionForInspection` by the same null exit, and
        // the refusal above would tell an operator that nothing covers a date a
        // revision plainly covers -- sending them to look for a revision that is
        // sitting in the catalogue, withdrawn. Which fault it was decides what
        // they do next, so the refusal has to carry it.
        const withdrawn = versions().map((v) => (v.version === OLD_REVISION
            ? { ...v, withdrawn: { at: Date.UTC(2026, 0, 15), reason: 'field_map_incorrect' as const } }
            : v));
        await expect(produceStatutoryForm({
            ...ctx(), inspectionDate: '2026-03-31', versions: withdrawn,
        })).rejects.toThrow(/withdrawn/i);
        // Not the "nothing covers this date" sentence -- that is the fault this
        // branch exists to stop being told.
        await expect(produceStatutoryForm({
            ...ctx(), inspectionDate: '2026-03-31', versions: withdrawn,
        })).rejects.not.toThrow(/no published revision/i);
        // And the reason is in the words, not merely in a flag somewhere.
        await expect(produceStatutoryForm({
            ...ctx(), inspectionDate: '2026-03-31', versions: withdrawn,
        })).rejects.toThrow(/field map/i);
    });

    it('the OTHER reason produces different words from the same code path', async () => {
        // The positive control for the assertion above: identical inputs but
        // the authority's own withdrawal, which must not mention a defect in
        // this software -- there is none, and nothing here is going to be fixed.
        const withdrawn = versions().map((v) => (v.version === OLD_REVISION
            ? { ...v, withdrawn: { at: Date.UTC(2026, 0, 15), reason: 'authority_withdrew' as const } }
            : v));
        await expect(produceStatutoryForm({
            ...ctx(), inspectionDate: '2026-03-31', versions: withdrawn,
        })).rejects.toThrow(/authority withdrew/i);
        await expect(produceStatutoryForm({
            ...ctx(), inspectionDate: '2026-03-31', versions: withdrawn,
        })).rejects.not.toThrow(/field map/i);
    });

    it('POSITIVE CONTROL — a revision withdrawn elsewhere does not block this date', async () => {
        // Withdrawing `Rev. 01/12` must not stop `Rev. 04/26` producing. Without
        // this, a refusal that fired on "any withdrawal in the catalogue" would
        // pass both assertions above.
        const withdrawn = versions().map((v) => (v.version === OLD_REVISION
            ? { ...v, withdrawn: { at: Date.UTC(2026, 0, 15), reason: 'authority_withdrew' as const } }
            : v));
        const out = await produceStatutoryForm({
            ...ctx(), inspectionDate: '2026-04-01', versions: withdrawn,
        });
        expect(out.version.version).toBe(NEW_REVISION);
    });
});

describe('produceStatutoryForm — whose bytes', () => {
    it('refuses when the stored bytes do not hash to the published sourceHash', async () => {
        // validateAgainstPdf owns this. The assertion is that we do not catch
        // it and degrade into a form rendered from whatever was in the bucket.
        const tampered = await buildFlatPdf();
        const store = {
            [`_platform/statutory-forms/${FORM}/${encodeURIComponent(NEW_REVISION)}.pdf`]: tampered.bytes,
        };
        const bad = {
            ...ctx(),
            inspectionDate: '2026-04-01',
            bucket: bucketWith(store),
            // A map bound to a hash the stored bytes do not have.
            fieldMapFor: (_f: string, v: string) => ({ ...mapFor(v), sourceHash: 'f'.repeat(64) }),
        };
        await expect(produceStatutoryForm(bad)).rejects.toThrow(/hash|sourceHash/i);
    });

    it('refuses when the object is missing rather than rendering a blank form', async () => {
        await expect(produceStatutoryForm({ ...ctx(), bucket: bucketWith({}) }))
            .rejects.toThrow(/not stored|missing/i);
    });

    it('refuses when no field map is published for the chosen revision', async () => {
        await expect(produceStatutoryForm({ ...ctx(), fieldMapFor: () => null }))
            .rejects.toThrow(/field map/i);
    });
});

describe('produceStatutoryForm — the output', () => {
    it('returns bytes that are a PDF, and the revision it used', async () => {
        const out = await produceStatutoryForm(ctx());
        expect(out.version.version).toBe(NEW_REVISION);
        expect(new TextDecoder().decode(out.bytes.slice(0, 5))).toBe('%PDF-');
    });
});
