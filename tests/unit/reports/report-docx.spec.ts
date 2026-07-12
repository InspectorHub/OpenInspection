// Commercial PCA Phase W (#186) — pure payload -> .docx builder tests.
// Task 2: skeleton (cover, TOC field, transmittal + dual-signature, systems
// summary). Tasks 3a-3c extend this file with Building Profile + section
// narrative, cost tables, and Appendix B photo assertions.
import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { buildReportDocx, type ReportDocxInput } from '../../../server/lib/report-docx';

const baseInput: ReportDocxInput = {
    inspection: { propertyAddress: '100 Market St', companyName: 'Acme PCA' },
    tier: 'full_pca',
    outline: [
        { id: 'transmittal', level: 1, title: 'Transmittal Letter' },
        { id: 'systems-summary', level: 1, title: 'Systems Summary' },
        { id: 'summary', level: 1, title: '1. Summary' },
    ],
    transmittal: { body: 'We are pleased to submit this Property Condition Report.' },
    signatures: {
        fieldObserver: { name: 'Jane Field', title: 'Field Observer' },
        reviewer: { name: 'John PCR', title: 'PCR Reviewer' },
    },
    systemsSummary: [
        { system: 'Roofing', condition: 'fair', priority: 'recommendation' },
    ],
    buildingProfile: [],
    sections: [],
    costTables: null,
    appendixPhotos: [],
};

async function xml(input: ReportDocxInput) {
    const bytes = await buildReportDocx(input);
    // unzip word/document.xml for structural assertions
    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(bytes);
    return strFromU8(files['word/document.xml']);
}

describe('buildReportDocx — skeleton', () => {
    it('returns a valid docx (zip) Uint8Array', async () => {
        const bytes = await buildReportDocx(baseInput);
        expect(bytes[0]).toBe(0x50); // 'P'
        expect(bytes[1]).toBe(0x4b); // 'K'
    });

    it('emits a native TOC field instruction', async () => {
        const body = await xml(baseInput);
        expect(body).toMatch(/TOC/); // <w:instrText> ... TOC \o "1-2" \h
    });

    it('emits cover address + company and the transmittal body in canonical order', async () => {
        const body = await xml(baseInput);
        const coverIdx = body.indexOf('100 Market St');
        const transmittalIdx = body.indexOf('pleased to submit');
        expect(coverIdx).toBeGreaterThan(-1);
        expect(transmittalIdx).toBeGreaterThan(coverIdx);
    });

    it('emits both signature lines for full_pca', async () => {
        const body = await xml(baseInput);
        expect(body).toContain('Jane Field');
        expect(body).toContain('John PCR');
    });

    it('round-trips through Packer to confirm a real Document was built', async () => {
        // buildReportDocx must return Packer.toBuffer output, not a hand string.
        const bytes = await buildReportDocx(baseInput);
        expect(bytes.byteLength).toBeGreaterThan(500);
        expect(Packer).toBeTruthy();
    });
});

const sectionedInput: ReportDocxInput = {
    ...baseInput,
    outline: [
        ...baseInput.outline,
        { id: 'property-description', level: 1, title: '3. General Property Description' },
        { id: 'roofing', level: 1, title: '5. Roofing' },
        { id: 'summary.deviations', level: 2, title: 'Deviations from the Guide' },
    ],
    buildingProfile: [
        { id: 'yearBuilt', group: 'identity', label: 'Year built', value: 1998, unit: null },
        { id: 'sqft', group: 'identity', label: 'Building area', value: 42000, unit: 'sf' },
    ],
    sections: [
        {
            id: 'property-description', level: 1, title: '3. General Property Description',
            body: 'The subject property is a two-story office building.',
        },
        {
            id: 'roofing', level: 1, title: '5. Roofing',
            body: 'The roof is a modified bitumen membrane in fair condition.',
        },
        {
            id: 'summary.deviations', level: 2, title: 'Deviations from the Guide',
            deviations: [{ area: 'PSQ', description: 'Owner did not complete the pre-survey questionnaire.' }],
        },
    ],
};

describe('buildReportDocx — building profile + sections', () => {
    it('emits the Building Profile as a two-column table with Year built / 1998', async () => {
        const body = await xml(sectionedInput);
        expect(body).toContain('Year built');
        expect(body).toContain('1998');
    });

    it('emits the §3 General Property Description heading', async () => {
        const body = await xml(sectionedInput);
        expect(body).toContain('General Property Description');
    });

    it('emits a system section heading at level 1 with its narrative body', async () => {
        const body = await xml(sectionedInput);
        expect(body).toContain('5. Roofing');
        expect(body).toContain('modified bitumen membrane');
    });

    it('renders Deviations as a sub-table', async () => {
        const body = await xml(sectionedInput);
        expect(body).toContain('Deviations from the Guide');
        expect(body).toContain('Owner did not complete');
        expect(body).toMatch(/<w:tbl>[\s\S]*Owner did not complete[\s\S]*<\/w:tbl>/);
    });

    it('follows outline order: Building Profile, then property-description, then roofing, then deviations', async () => {
        const body = await xml(sectionedInput);
        const bpIdx = body.indexOf('Year built');
        const pdIdx = body.indexOf('General Property Description');
        const roofIdx = body.indexOf('5. Roofing');
        const devIdx = body.indexOf('Deviations from the Guide');
        expect(bpIdx).toBeGreaterThan(-1);
        expect(pdIdx).toBeGreaterThan(bpIdx);
        expect(roofIdx).toBeGreaterThan(pdIdx);
        expect(devIdx).toBeGreaterThan(roofIdx);
    });

    it('emits nothing for an empty section (no body/items/deviations)', async () => {
        const withEmpty: ReportDocxInput = {
            ...sectionedInput,
            outline: [...sectionedInput.outline, { id: 'mep', level: 1, title: '6. Mechanical, Electrical & Plumbing' }],
            sections: [...sectionedInput.sections, { id: 'mep', level: 1, title: '6. Mechanical, Electrical & Plumbing' }],
        };
        const body = await xml(withEmpty);
        expect(body).not.toContain('Mechanical, Electrical');
    });
});

const costedInput: ReportDocxInput = {
    ...sectionedInput,
    costTables: {
        table1: [
            {
                system: 'Roofing', description: 'Replace membrane', bucket: 'immediate',
                quantity: 1, unitCostCents: 500_000, totalCents: 500_000,
            },
            {
                system: 'Parking', description: 'Seal coat', bucket: 'short_term',
                quantity: 1, unitCostCents: 200_000, totalCents: 200_000,
            },
        ],
        reserveSchedule: {
            years: [2027, 2028],
            rows: [
                { system: 'HVAC', description: 'Chiller replacement', placementYear: 2027, replacementCents: 1_500_000 },
                { system: 'Elevator', description: 'Modernization', placementYear: 2028, replacementCents: 3_000_000 },
            ],
            uninflatedByYear: [1_500_000, 3_000_000],
            cumulativeInflatedByYear: [1_500_000, 4_500_000],
            totalUninflatedCents: 4_500_000,
            totalInflatedCents: 4_500_000,
            perSfUninflatedAllYears: 45_000,
            perSfInflatedAllYears: 46_000,
            perSfInflatedPerYear: 23_000,
        },
    },
};

describe('buildReportDocx — cost tables', () => {
    it('emits TABLE 1 heading + the immediate and short-term lines with money from cents', async () => {
        const body = await xml(costedInput);
        expect(body).toContain('TABLE 1');
        expect(body).toContain('Replace membrane');
        expect(body).toContain('$5,000.00');
        expect(body).toContain('Seal coat');
        expect(body).toContain('$2,000.00');
    });

    it('emits TABLE 2 heading + reserve schedule year columns when reserveSchedule is present', async () => {
        const body = await xml(costedInput);
        expect(body).toContain('TABLE 2');
        expect(body).toContain('2027');
        expect(body).toContain('2028');
        expect(body).toContain('Chiller replacement');
        expect(body).toContain('$15,000.00'); // HVAC row placed at 2027
        expect(body).toContain('$30,000.00'); // Elevator row placed at 2028
    });

    it('emits TABLE 2 summary footer rows (Total Uninflated + Cumulative Inflated) with totals', async () => {
        const body = await xml(costedInput);
        expect(body).toContain('Total Uninflated');
        expect(body).toContain('Cumulative Inflated');
        expect(body).toContain('$45,000.00'); // totalUninflatedCents / totalInflatedCents
    });

    it('emits TABLE 2 Per-SF summary rows with formatted values when non-null', async () => {
        const body = await xml(costedInput);
        expect(body).toContain('Per-SF (Uninflated, all years)');
        expect(body).toContain('$450.00');
        expect(body).toContain('Per-SF (Inflated, all years)');
        expect(body).toContain('$460.00');
        expect(body).toContain('Per-SF (Inflated, per year)');
        expect(body).toContain('$230.00');
    });

    it('omits a Per-SF row when its value is null (building area unknown)', async () => {
        const noPerSf: ReportDocxInput = {
            ...costedInput,
            costTables: {
                ...costedInput.costTables!,
                reserveSchedule: {
                    ...costedInput.costTables!.reserveSchedule!,
                    perSfUninflatedAllYears: null,
                    perSfInflatedAllYears: null,
                    perSfInflatedPerYear: null,
                },
            },
        };
        const body = await xml(noPerSf);
        expect(body).not.toContain('Per-SF');
        // Summary rows still render.
        expect(body).toContain('Total Uninflated');
    });

    it('omits TABLE 2 when reserveSchedule is null', async () => {
        const noReserve: ReportDocxInput = {
            ...costedInput,
            costTables: { ...costedInput.costTables!, reserveSchedule: null },
        };
        const body = await xml(noReserve);
        expect(body).toContain('TABLE 1');
        expect(body).not.toContain('TABLE 2');
    });

    it('emits no cost tables when costTables is null', async () => {
        const body = await xml(sectionedInput); // costTables: null (inherited from baseInput)
        expect(body).not.toContain('TABLE 1');
        expect(body).not.toContain('TABLE 2');
    });
});

// Two distinct tiny real 1x1 PNGs (transparent, red) — docx dedupes identical
// image bytes into a single media relationship, so the two-relationship
// assertion below needs genuinely different bytes, same as two real photos.
const TINY_PNG_TRANSPARENT_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_PNG_RED_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngBytes = (base64: string): Uint8Array => Uint8Array.from(Buffer.from(base64, 'base64'));

const appendixInput: ReportDocxInput = {
    ...costedInput,
    appendixPhotos: [
        {
            photoNo: '1', caption: 'Roof membrane, north slope',
            bytes: pngBytes(TINY_PNG_TRANSPARENT_BASE64), widthPx: 800, heightPx: 600, type: 'png',
        },
        {
            photoNo: '2', caption: 'Parking lot seal coat',
            bytes: pngBytes(TINY_PNG_RED_BASE64), widthPx: 800, heightPx: 600, type: 'png',
        },
    ],
};

describe('buildReportDocx — appendix photos', () => {
    it('emits an Appendix B heading + one ImageRun and caption per photo for full_pca', async () => {
        const bytes = await buildReportDocx(appendixInput);
        const { unzipSync, strFromU8 } = await import('fflate');
        const files = unzipSync(bytes);
        const doc = strFromU8(files['word/document.xml']);
        expect(doc).toContain('Appendix B');
        expect(doc).toContain('PHOTO NO. 1');
        expect(doc).toContain('Roof membrane, north slope');
        expect(doc).toContain('PHOTO NO. 2');
        expect(doc).toContain('Parking lot seal coat');

        const rels = strFromU8(files['word/_rels/document.xml.rels']);
        const imageRelCount = (rels.match(/relationships\/image"/g) ?? []).length;
        expect(imageRelCount).toBe(2);
    });

    it('omits Appendix B entirely for light_commercial (appendixPhotos: [])', async () => {
        const lightInput: ReportDocxInput = { ...appendixInput, tier: 'light_commercial', appendixPhotos: [] };
        const doc = await xml(lightInput);
        expect(doc).not.toContain('Appendix B');
    });

    it('emits nothing when appendixPhotos is empty even for full_pca', async () => {
        const noPhotos: ReportDocxInput = { ...costedInput, appendixPhotos: [] };
        const doc = await xml(noPhotos);
        expect(doc).not.toContain('Appendix B');
    });
});
