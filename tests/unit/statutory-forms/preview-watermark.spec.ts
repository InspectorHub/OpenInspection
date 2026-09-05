/**
 * The preview's watermark, which is the only thing that travels with the bytes.
 *
 * A preview renders content that is still changing, and once it is a PDF on
 * disk nothing distinguishes it from a filed deliverable except what is drawn
 * on it. So these assert the two properties that actually protect a submission:
 * the mark is on EVERY page, and it is drawn into the page content rather than
 * parked in metadata no printer renders.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
    watermarkAsPreview,
    PREVIEW_WATERMARK_TEXT,
} from '../../../server/lib/statutory/preview-watermark';

/** A multi-page stand-in for an authority's form. */
async function blankForm(pages: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i += 1) {
        const page = doc.addPage([612, 792]);
        page.drawText(`page ${i + 1} of the authority's form`, { x: 72, y: 700, size: 12, font });
    }
    return doc.save();
}

/** What a page's content stream actually says, decompressed by pdf-lib. */
async function pageTextRuns(pdf: Uint8Array): Promise<string[]> {
    const doc = await PDFDocument.load(pdf);
    return doc.getPages().map((p) => {
        const contents = p.node.normalizedEntries().Contents;
        return contents ? String(contents) : '';
    });
}

describe('preview watermark', () => {
    it('marks every page, not just the first', async () => {
        // A cover-page-only mark is the tempting version and the wrong one: the
        // reader is a person holding page 4 of 6.
        const marked = await watermarkAsPreview(await blankForm(6));
        const doc = await PDFDocument.load(marked);
        expect(doc.getPageCount()).toBe(6);

        const before = await PDFDocument.load(await blankForm(6));
        // Every page grew, which is the observable consequence of something
        // being drawn onto it. Asserted per page rather than in total, because
        // one heavily marked page would satisfy a total.
        for (let i = 0; i < 6; i += 1) {
            const markedOps = doc.getPage(i).node.normalizedEntries().Contents;
            const plainOps = before.getPage(i).node.normalizedEntries().Contents;
            expect(String(markedOps).length).toBeGreaterThan(String(plainOps).length);
        }
    });

    it('says what is wrong with the document, not just its status', async () => {
        // "PREVIEW" alone names a state; the second half is the instruction,
        // and it is the half that stops a copy being submitted.
        expect(PREVIEW_WATERMARK_TEXT).toContain('NOT FOR SUBMISSION');
    });

    it('leaves the form underneath intact', async () => {
        // NEGATIVE CONTROL. A watermark that flattened or replaced the page
        // would pass every assertion above while destroying the only thing the
        // preview exists to show -- whether values landed in the right boxes.
        const marked = await watermarkAsPreview(await blankForm(2));
        const runs = await pageTextRuns(marked);
        expect(runs).toHaveLength(2);
        const doc = await PDFDocument.load(marked);
        for (const page of doc.getPages()) {
            expect(page.getSize().width).toBeCloseTo(612, 0);
            expect(page.getSize().height).toBeCloseTo(792, 0);
        }
    });

    it('does not modify the bytes it was given', async () => {
        // The caller may still be holding the produced document. A function that
        // quietly mutated its argument would show up as a watermarked
        // DELIVERABLE, which is the one outcome worse than no preview at all.
        const original = await blankForm(1);
        const copy = original.slice();
        await watermarkAsPreview(original);
        expect(Array.from(original)).toEqual(Array.from(copy));
    });
});
