/**
 * Mark a rendered statutory form as a PREVIEW, on every page.
 *
 * ── WHY THIS IS NOT OPTIONAL DECORATION ─────────────────────────────────────
 * A statutory form is an authority's own document. Once it is bytes on disk,
 * nothing about it says whether it came from a published report or from an
 * editor preview of half-finished work -- it prints, and it looks filed. The
 * preview exists so an inspector can check the layout BEFORE publishing, which
 * necessarily means it renders content that is still changing; a copy of that
 * escaping into a submission is precisely the failure the produce path's
 * reproducibility rule was written to prevent.
 *
 * So the mark is applied to EVERY page rather than a cover, and it says what is
 * wrong with the document rather than just its status: "not for submission" is
 * the actionable half, and a person holding page 4 of 6 is the reader.
 *
 * ── WHY IT IS DRAWN, NOT STAMPED IN METADATA ────────────────────────────────
 * A PDF keyword or title nobody renders is invisible on the printout, and the
 * printout is what gets handed to an insurer. It is drawn into the page content
 * for the same reason the refusals elsewhere in this subsystem are sentences
 * rather than codes: the person who must act on it is looking at the paper.
 *
 * It is deliberately NOT made tamper-proof. Anyone who wants a clean copy can
 * publish the report and download the real one in two clicks, so hardening this
 * would spend effort defending against someone taking the longer route to a
 * document they are entitled to.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/** What the mark says. One sentence, and the second half is the actionable one. */
export const PREVIEW_WATERMARK_TEXT = 'PREVIEW — NOT FOR SUBMISSION';

/**
 * Returns new bytes. The input is not modified, because the caller may still be
 * holding the produced document for something else and a function that quietly
 * mutated its argument would be the kind of surprise that shows up as a
 * watermarked deliverable.
 */
export async function watermarkAsPreview(pdf: Uint8Array): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdf);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);

    for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        // Sized to the page's own diagonal so it spans a Letter form and an A4
        // one alike, rather than to a constant that fits whichever was tested.
        const diagonal = Math.sqrt(width * width + height * height);
        const size = Math.min(48, (diagonal / PREVIEW_WATERMARK_TEXT.length) * 1.6);
        const textWidth = font.widthOfTextAtSize(PREVIEW_WATERMARK_TEXT, size);
        const angle = Math.atan2(height, width);

        page.drawText(PREVIEW_WATERMARK_TEXT, {
            x: (width - Math.cos(angle) * textWidth) / 2,
            y: (height - Math.sin(angle) * textWidth) / 2,
            size,
            font,
            // Light enough to read the form underneath -- an inspector is here
            // to check that values landed in the right boxes, and a mark that
            // hides them defeats the only reason to look.
            color: rgb(0.85, 0.1, 0.1),
            opacity: 0.28,
            rotate: degrees((angle * 180) / Math.PI),
        });
    }

    return doc.save();
}
