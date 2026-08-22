/**
 * PDF bytes to text, and nothing else.
 *
 * The fixtures are built here rather than checked in, for two reasons. A binary
 * fixture is unreadable in review, so nobody can tell what a failure means; and
 * a PDF built by the same library the extractor parses with is the shape this
 * code will actually meet — compressed content streams, hexadecimal strings,
 * standard fonts with a WinAnsi encoding.
 *
 * The low-level fixtures go further and assemble a page's content stream by
 * hand, because the high-level API cannot produce the two cases that matter
 * most: an UNCOMPRESSED stream, and a font whose bytes mean nothing without its
 * `/ToUnicode` map. Both are ordinary in files produced by other tools.
 */
import { describe, it, expect } from 'vitest';
import {
    PDFDocument,
    PDFName,
    PDFRawStream,
    StandardFonts,
    type PDFContext,
    type PDFDict,
} from 'pdf-lib';
import { extractPdfText } from '../../../server/lib/migration-intake/pdf-text';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A 1×1 PNG, so a fixture can carry a real image without a binary file. */
const ONE_PIXEL_PNG = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
), (c) => c.charCodeAt(0));

async function twoPagePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const a = doc.addPage([300, 300]);
    a.drawText('Roof Covering', { x: 20, y: 250, size: 12, font });
    a.drawText('Comments', { x: 20, y: 220, size: 12, font });
    const b = doc.addPage([300, 300]);
    b.drawText('Electrical Panel', { x: 20, y: 250, size: 12, font });
    return doc.save();
}

async function pdfWithPhotoAndCaption(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const png = await doc.embedPng(ONE_PIXEL_PNG);
    const page = doc.addPage([300, 300]);
    page.drawImage(png, { x: 20, y: 120, width: 100, height: 100 });
    page.drawText('Photo of the south elevation', { x: 20, y: 90, size: 12, font });
    return doc.save();
}

async function imageOnlyPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const png = await doc.embedPng(ONE_PIXEL_PNG);
    const page = doc.addPage([300, 300]);
    page.drawImage(png, { x: 0, y: 0, width: 300, height: 300 });
    return doc.save();
}

/**
 * A one-page PDF whose content stream is the literal text given, with one font
 * registered as `/F1` built from the dictionary the callback returns. The
 * stream is stored with NO filter, which is the branch the high-level fixtures
 * never reach — pdf-lib always deflates the streams it writes itself.
 */
async function rawContentPdf(
    content: string,
    font: (ctx: PDFContext) => PDFDict,
): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const ctx = doc.context;
    const fontRef = ctx.register(font(ctx));
    const streamRef = ctx.register(
        PDFRawStream.of(ctx.obj({ Length: content.length }), enc(content)),
    );
    page.node.set(PDFName.of('Contents'), streamRef);
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: fontRef } }));
    return doc.save();
}

const winAnsiFont = (ctx: PDFContext): PDFDict =>
    ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });

/** A font whose bytes mean nothing on their own — only its `/ToUnicode` map
 *  says what they stand for. This is what a subset font in a real export is. */
const subsetFontWithToUnicode = (cmap: string) => (ctx: PDFContext): PDFDict => {
    const stream = ctx.register(PDFRawStream.of(ctx.obj({ Length: cmap.length }), enc(cmap)));
    return ctx.obj({
        Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+Custom', ToUnicode: stream,
    });
};

describe('extractPdfText — pages', () => {
    it('returns one string per page', async () => {
        expect((await extractPdfText(await twoPagePdf()))?.length).toBe(2);
    });

    it('puts each page\'s own text on its own page', async () => {
        // POSITIVE CONTROL for the count above, which passes for a function
        // that returns the same string twice — and a scanner run over that
        // would report page 0 for something that is on page 1.
        const pages = await extractPdfText(await twoPagePdf());
        expect(pages?.[0]).toMatch(/Roof Covering/);
        expect(pages?.[0]).toMatch(/Comments/);
        expect(pages?.[1]).toMatch(/Electrical Panel/);
        expect(pages?.[1]).not.toMatch(/Roof/);
    });
});

describe('extractPdfText — what it cannot produce', () => {
    it('extracts NO images', async () => {
        // What leaves this process is text this function produced, and it
        // cannot produce an image: the operator that paints one is not read.
        //
        // ⚠️ THE ASSERTION IS AN EQUALITY, and the first draft of it was not.
        // That draft looked for `JFIF`, `PNG`, `IHDR` and runs of replacement
        // characters, and a mutation that appended the page's whole image
        // XObject to the text WALKED STRAIGHT THROUGH IT: the embedder strips
        // the PNG container, so those markers are not in the file to be found,
        // and the bytes are read as Latin-1, which has no replacement
        // character to produce. The test passed against an implementation that
        // was leaking the image. Naming what MAY be there is the only form
        // that fails on bytes nobody predicted.
        const text = await extractPdfText(await pdfWithPhotoAndCaption());
        expect(text!.join('').trim()).toBe('Photo of the south elevation');
    });

    it('lets no inline image data through as text', async () => {
        // An inline image is raw bytes sitting in the middle of the operator
        // stream, and a tokeniser that walked into them would read whatever
        // parentheses fell out of the pixel data. This payload is worse than
        // pixel data: it is a valid text-showing instruction. If the block is
        // not skipped as a unit, it is not merely leaked — it is EXECUTED.
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td (Caption) Tj ET\n'
            + 'q 100 0 0 100 20 100 cm BI /W 8 /H 2 /CS /G /BPC 8 ID '
            + '(LEAKED-IMAGE-DATA) Tj \x00\x01\x02\x03 EI Q',
            winAnsiFont,
        );
        const page = (await extractPdfText(bytes))?.[0] ?? '';
        expect(page).toMatch(/Caption/);
        expect(page).not.toMatch(/LEAKED-IMAGE-DATA/);
    });

    it('returns text with no control characters in it', async () => {
        // Whatever else is true of the output, it is text. A control character
        // reaching it means bytes came from somewhere that is not a decoded
        // string operand.
        const text = (await extractPdfText(await pdfWithPhotoAndCaption()))!.join('');
        // eslint-disable-next-line no-control-regex
        expect(text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
    });

    it('returns null for bytes that are not a PDF', async () => {
        expect(await extractPdfText(enc('Name,Email'))).toBeNull();
    });

    it('returns null for a document it recovered no text from at all', async () => {
        // A scanned page yields an empty string per page, and an empty string
        // is indistinguishable from a page that says nothing. Returning pages
        // of nothing would let "we could not read this" reach a caller wearing
        // the same face as "there is nothing in it" — and the caller after
        // that is a scan that reports no personal information.
        expect(await extractPdfText(await imageOnlyPdf())).toBeNull();
    });
});

describe('extractPdfText — WinAnsi', () => {
    it('reads an uncompressed stream and a literal string', async () => {
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td (Roof Covering) Tj ET',
            winAnsiFont,
        );
        expect((await extractPdfText(bytes))?.[0]).toMatch(/Roof Covering/);
    });

    it('unescapes a literal string rather than showing its escapes', async () => {
        const bytes = await rawContentPdf(
            String.raw`BT /F1 12 Tf 20 250 Td (Attic \(north\) \\ crawlspace) Tj ET`,
            winAnsiFont,
        );
        expect((await extractPdfText(bytes))?.[0]).toMatch(/Attic \(north\) \\ crawlspace/);
    });

    it('reads the pieces of a TJ array and drops its kerning numbers', async () => {
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td [(Roof) -250 (Covering)] TJ ET',
            winAnsiFont,
        );
        const page = (await extractPdfText(bytes))?.[0] ?? '';
        expect(page).toMatch(/Roof/);
        expect(page).toMatch(/Covering/);
        expect(page).not.toMatch(/-?250/);
    });

    it('maps a high byte through WinAnsi, not through Latin-1', async () => {
        // 0x96 is an en dash in WinAnsi and an unassigned control code in
        // Latin-1. A decoder that treated the two as the same would put a
        // control character into text that is then read by a scanner and sent
        // to a model — `RoofCov` and `Roof–Cov` look identical in a diff.
        //                R o  o  f  –  C  o  v
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td <526F6F6696436F76> Tj ET',
            winAnsiFont,
        );
        const page = (await extractPdfText(bytes))?.[0] ?? '';
        expect(page).toMatch(/Roof–Cov/);
        expect(page).not.toMatch(//);
    });
});

describe('extractPdfText — /ToUnicode', () => {
    const CMAP = `/CIDInit /ProcSet findresource begin
begincmap
1 begincodespacerange
<00> <FF>
endcodespacerange
2 beginbfchar
<01> <0052>
<02> <006F>
endbfchar
1 beginbfrange
<10> <12> <0041>
endbfrange
endcmap
end`;

    it('maps bytes through a bfchar table', async () => {
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td <010202> Tj ET',
            subsetFontWithToUnicode(CMAP),
        );
        expect((await extractPdfText(bytes))?.[0]).toMatch(/Roo/);
    });

    it('maps bytes through a bfrange, incrementing across the range', async () => {
        // POSITIVE CONTROL for the range arm: a parser that read only the
        // first entry of a range would give `AAA`, which is text, looks fine,
        // and is wrong.
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td <101112> Tj ET',
            subsetFontWithToUnicode(CMAP),
        );
        expect((await extractPdfText(bytes))?.[0]).toMatch(/ABC/);
    });

    it('returns null when a byte falls outside the map rather than inventing one', async () => {
        // The subset font's `/ToUnicode` is the ONLY thing that says what its
        // bytes mean. A byte it does not name has no reading, and a decoder
        // that substituted the byte's own value would emit plausible ASCII for
        // a glyph that is not that letter.
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td <0199> Tj ET',
            subsetFontWithToUnicode(CMAP),
        );
        expect(await extractPdfText(bytes)).toBeNull();
    });
});

describe('extractPdfText — refusing rather than guessing', () => {
    it('returns null for a font encoding it cannot read', async () => {
        // Garbled text sent to a model produces a garbled template, which is
        // worse than refusing: the operator gets a plausible-looking result
        // built out of nothing.
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td (Roof Covering) Tj ET',
            (ctx) => ctx.obj({
                Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica',
                Encoding: 'MacExpertEncoding',
            }),
        );
        expect(await extractPdfText(bytes)).toBeNull();
    });

    it('POSITIVE CONTROL — the same document with a readable encoding is read', async () => {
        // Without this, the refusal above passes for an extractor that returns
        // null for every low-level fixture, and the refusal would prove
        // nothing about encodings at all.
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td (Roof Covering) Tj ET',
            winAnsiFont,
        );
        expect(await extractPdfText(bytes)).not.toBeNull();
    });

    it('returns null for a subset font with neither an encoding nor a /ToUnicode', async () => {
        const bytes = await rawContentPdf(
            'BT /F1 12 Tf 20 250 Td (Roof) Tj ET',
            (ctx) => ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+Custom' }),
        );
        expect(await extractPdfText(bytes)).toBeNull();
    });

    it('returns null when text is shown with no font selected at all', async () => {
        // No `Tf`, so nothing says how to read the bytes. Latin-1 would be a
        // guess that happens to be right for ASCII and silently wrong above it.
        const bytes = await rawContentPdf('BT 20 250 Td (Roof) Tj ET', winAnsiFont);
        expect(await extractPdfText(bytes)).toBeNull();
    });
});
