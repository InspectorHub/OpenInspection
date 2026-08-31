/**
 * Two PDFs, built here rather than committed.
 *
 * ⚠️ NO OFFICIAL FORM IS IN THIS REPOSITORY, and these fixtures are not
 * stand-ins for one. A government agency's published form is that agency's
 * document; it is not automatically free of copyright, and this repository does
 * not carry one. The bytes an operator publishes live in object storage, keyed
 * and hashed (`statutory_form_versions.object_key`).
 *
 * What the fixtures reproduce is the SHAPE these forms come in, which is what
 * the code has to handle:
 *
 *   `buildFieldedPdf()` — an AcroForm with named text fields, where values are
 *   set by field name. Real examples of this shape carry hand-typed names that
 *   mean nothing (`Text1`, `1`) and sometimes carry a typo, which is the whole
 *   reason a map is bound to one revision's hash.
 *
 *   `buildFlatPdf()` — no `/AcroForm`, no widgets, no annotations at all: a
 *   print-out of a word processor document. Every value on one of these has to
 *   be drawn at measured coordinates, so a validator that required form fields
 *   would reject it outright.
 *
 * Both return their own sha256, because every check in this subsystem is
 * against the hash of the exact bytes rather than a file name.
 */
import {
    PDFArray,
    PDFDocument,
    PDFName,
    PDFRawStream,
    StandardFonts,
    decodePDFRawStream,
} from 'pdf-lib';
import { sha256Hex } from '../../../server/lib/sha256';

export interface PdfFixture {
    bytes: Uint8Array;
    hash: string;
}

/** An AcroForm PDF: 3 pages, two named text fields on page 0. */
export async function buildFieldedPdf(): Promise<PdfFixture> {
    const doc = await PDFDocument.create();
    const first = doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    first.drawText('OFFICIAL FORM — do not rebuild', { x: 40, y: 750, size: 12, font });

    const form = doc.getForm();
    for (const [i, name] of ['Name of Client', 'Text1'].entries()) {
        const field = form.createTextField(name);
        field.addToPage(first, { x: 50, y: 700 - i * 40, width: 200, height: 20 });
    }

    const bytes = await doc.save();
    return { bytes, hash: await sha256Hex(bytes) };
}

/**
 * An AcroForm PDF whose CHECKBOXES ARE REAL WIDGETS: 1 page, one text field and
 * three `/Btn` boxes.
 *
 * The third shape, and the one the Texas form turned out to be: 245 fields, 81
 * of them text and 164 of them genuine checkbox widgets. A map that draws an
 * `X` over one of those produces a document that is right on paper and wrong in
 * its data — every box still reads as unticked to anything that opens the file.
 * The other two fixtures cannot reproduce that, because neither has a widget to
 * leave unticked.
 */
export async function buildCheckboxPdf(): Promise<PdfFixture> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('OFFICIAL FORM — with real boxes', { x: 40, y: 750, size: 12, font });

    const form = doc.getForm();
    form.createTextField('Name of Client').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    for (const [i, name] of ['Box.Copper', 'Box.Aluminum', 'Box.KnobAndTube'].entries()) {
        form.createCheckBox(name).addToPage(page, { x: 80 + i * 40, y: 400, width: 10, height: 10 });
    }

    const bytes = await doc.save();
    return { bytes, hash: await sha256Hex(bytes) };
}

/** A flat PDF: 2 pages, printed text, and nothing fillable anywhere in it. */
export async function buildFlatPdf(): Promise<PdfFixture> {
    const doc = await PDFDocument.create();
    const first = doc.addPage([612, 792]);
    const second = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    first.drawText('OFFICIAL FORM — page one', { x: 40, y: 750, size: 12, font });
    second.drawText('OFFICIAL FORM — page two', { x: 40, y: 750, size: 12, font });

    const bytes = await doc.save();
    return { bytes, hash: await sha256Hex(bytes) };
}

/**
 * One sha256 per page, over that page's decoded content streams.
 *
 * This is the measurement that can prove we did not rebuild a form. Everything
 * an authority drew on a page — every rule, border, label and instruction —
 * lives in these streams. If the digest of a page is unchanged after we filled
 * the form, the page beneath our values is that agency's page, byte for byte,
 * rather than something of ours that resembles it. A rebuilt form passes every
 * assertion about its own values and fails this one.
 *
 * Read here rather than in `server/` because it is a measuring instrument for
 * the tests, not a capability the product has.
 */
export async function pageContentDigests(bytes: Uint8Array): Promise<string[]> {
    const doc = await PDFDocument.load(bytes);
    const digests: string[] = [];
    for (const page of doc.getPages()) {
        const contents = page.node.get(PDFName.of('Contents'));
        const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
        const parts: Uint8Array[] = [];
        for (const ref of refs) {
            const stream = page.doc.context.lookup(ref);
            if (stream instanceof PDFRawStream) parts.push(decodePDFRawStream(stream).decode());
        }
        const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const part of parts) {
            joined.set(part, at);
            at += part.length;
        }
        digests.push(await sha256Hex(joined));
    }
    return digests;
}

/** The stored value of one AcroForm text field. */
export async function readFieldValue(bytes: Uint8Array, name: string): Promise<string | undefined> {
    const doc = await PDFDocument.load(bytes);
    return doc.getForm().getTextField(name).getText();
}

/**
 * Whether one AcroForm checkbox is ticked IN THE DOCUMENT'S DATA.
 *
 * Deliberately not "is there an X visible there". The failure this exists to
 * measure is a mark drawn over a widget: the printed page looks answered and
 * every reader of the field data sees an empty box.
 */
export async function readCheckBox(bytes: Uint8Array, name: string): Promise<boolean> {
    const doc = await PDFDocument.load(bytes);
    return doc.getForm().getCheckBox(name).isChecked();
}
