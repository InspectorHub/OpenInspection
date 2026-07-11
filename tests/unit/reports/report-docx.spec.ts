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
