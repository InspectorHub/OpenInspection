/**
 * PDF bytes to text, one string per page — and nothing else, ever.
 *
 * WHY THIS EXISTS RATHER THAN A LIBRARY CALL. `pdf-lib` is already a dependency
 * and cannot do this: it is a WRITING library, and not one of the nineteen
 * methods on its page type reads any text. Nothing else in the bundle can
 * either, and adding a reader would cost more than the deployment's whole
 * remaining bundle budget — a self-hosted deploy genuinely fails over that
 * ceiling. So `pdf-lib` is used for what it is good at, which is parsing the
 * file's object graph, and the content streams are read here.
 *
 * WHAT THIS FUNCTION IS FOR, AND THE LIMIT THAT COMES WITH IT. It exists so
 * that what leaves this process towards anything else is TEXT THIS PRODUCED. It
 * has no branch that emits image data, no branch that emits raw stream bytes,
 * and no parameter through which a caller could ask for either. The compliance
 * statement that no feature here sends an image is not a promise made
 * elsewhere and honoured here; it is a property of this file having no code
 * that could break it.
 *
 * ⚠️ IT REFUSES FAR MORE READILY THAN A VIEWER WOULD, ON PURPOSE. `null` is
 * returned for a file that is not a PDF, for one whose fonts are encoded in any
 * way but the two understood in `pdf-fonts.ts`, and for one no text was
 * recovered from at all. A viewer in the same position draws its best guess and
 * a person corrects it by eye; the consumer here is a scanner looking for
 * personal information and a model deriving a template, and neither can tell a
 * confident wrong reading from a right one. A refusal costs an operator a
 * different file. A garbled reading costs them a template built out of noise,
 * and a personal-information scan that found nothing because there was nothing
 * legible to find.
 *
 * SO THE RETURN VALUE HAS EXACTLY TWO SHAPES, and callers must keep them apart:
 * pages of text that were read, or `null` meaning nothing was. There is no
 * third shape — no array of empty strings, no partial page — because a partial
 * result is the one a caller forgets to check.
 */
import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFName,
    PDFRawStream,
    PDFStream,
    decodePDFRawStream,
    type PDFContext,
} from 'pdf-lib';
import { extractContentText } from './pdf-content';
import { fontDecoderFor, type FontDecoder } from './pdf-fonts';

/** Every content stream of one page, decoded and joined. A page may hold its
 *  operators in several streams, and the split may fall mid-operator, so they
 *  are one stream as far as reading is concerned. */
function pageContentBytes(contents: PDFStream | PDFArray | undefined, ctx: PDFContext): Uint8Array | null {
    const streams: PDFStream[] = [];
    if (contents instanceof PDFArray) {
        for (const entry of contents.asArray()) {
            const looked = ctx.lookup(entry);
            if (looked instanceof PDFStream) streams.push(looked);
        }
    } else if (contents instanceof PDFStream) {
        streams.push(contents);
    }
    if (!streams.length) return null;

    const parts: Uint8Array[] = [];
    for (const stream of streams) {
        // `PDFRawStream` is what a PARSED stream is; anything else came from
        // this process building one, which a loaded document does not contain.
        if (!(stream instanceof PDFRawStream)) return null;
        parts.push(decodePDFRawStream(stream).decode());
        parts.push(Uint8Array.of(0x0a));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { joined.set(part, at); at += part.length; }
    return joined;
}

/** Resolves `/F1` against the page's own font resources, once per name. */
function pageFontLookup(resources: PDFDict | undefined): (name: string) => FontDecoder | null {
    const fonts = resources?.lookup(PDFName.of('Font'));
    const cache = new Map<string, FontDecoder | null>();
    return (name) => {
        if (cache.has(name)) return cache.get(name) ?? null;
        let decoder: FontDecoder | null = null;
        if (fonts instanceof PDFDict) {
            const font = fonts.lookup(PDFName.of(name));
            if (font instanceof PDFDict) decoder = fontDecoderFor(font);
        }
        cache.set(name, decoder);
        return decoder;
    };
}

/**
 * One string per page, or `null`.
 *
 * Asynchronous only because parsing is: nothing here reaches the network, the
 * filesystem or a database, and no Node API is used, so it runs unchanged in
 * the worker runtime.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string[] | null> {
    let doc: PDFDocument;
    try {
        // `throwOnInvalidObject` is left at its default: a real vendor export
        // routinely carries an object this parser dislikes on a page nobody
        // needs, and refusing the file over it would refuse most of them. What
        // must never be tolerated is a MISREAD, and that is guarded at the
        // encoding layer instead.
        doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch {
        // Not a PDF, or encrypted, or damaged past parsing. All three are "we
        // cannot read this", which is the only answer this function has.
        return null;
    }

    const ctx = doc.context;
    const pages: string[] = [];
    for (const page of doc.getPages()) {
        const content = pageContentBytes(page.node.Contents(), ctx);
        if (content === null) { pages.push(''); continue; }
        const text = extractContentText(content, pageFontLookup(page.node.Resources()));
        // One unreadable page fails the document. A page silently replaced by
        // an empty string is the shape that reads as "this page was blank".
        if (text === null) return null;
        pages.push(text);
    }

    // A document every page of which came back empty is a scanned one, or one
    // whose text lives somewhere this does not follow. Returning pages of
    // nothing would hand a caller a result indistinguishable from a genuinely
    // blank document — and the caller after that is a scan that would report,
    // truthfully and uselessly, that it detected no personal information.
    return pages.some((p) => p.trim().length > 0) ? pages : null;
}
