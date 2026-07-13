import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractAnchorPages } from '../../../server/lib/toc-pages';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Deterministic fixture produced by the validated spike
// (scripts/spike/toc-pdflib-spike.mjs) — a TOC of 5 <a href="#id"> entries
// followed by tall sections, rendered via Chromium's page.pdf(). Known-correct
// pages per scripts/spike/toc-pdflib-spike.md.
const FIXTURE_PATH = join(__dirname, '../../fixtures/toc-fixture.pdf');

describe('extractAnchorPages', () => {
    it('resolves each named TOC anchor to its 1-based target page', async () => {
        const bytes = readFileSync(FIXTURE_PATH);
        const result = await extractAnchorPages(bytes);
        expect(result).toEqual({
            roof: 3,
            structural: 5,
            mechanical: 7,
            electrical: 9,
            plumbing: 11,
        });
    });

    it('returns an empty map for a PDF with no named destinations', async () => {
        // Minimal single-page PDF with no /Names /Dests tree and no link
        // annotations — extractAnchorPages must resolve zero entries, not throw.
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.create();
        doc.addPage();
        const bytes = await doc.save();
        const result = await extractAnchorPages(bytes);
        expect(result).toEqual({});
    });

    it('never throws on malformed/garbage input — returns an empty map', async () => {
        const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]); // "%PDF" + junk
        await expect(extractAnchorPages(garbage)).resolves.toEqual({});
    });
});
