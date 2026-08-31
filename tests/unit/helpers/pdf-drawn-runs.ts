/**
 * What text was drawn where, read back off the page.
 *
 * ── Why "it rendered" is not an assertion ───────────────────────────────────
 * The failure this repository's statutory subsystem is built around draws
 * perfectly well. A date written as one string onto a form that prints three
 * separate blanks produces a page that renders, prints and files — with the year
 * sitting across the wrong blank. Every assertion of the form "the page changed"
 * holds for it. Only the COORDINATE tells the two apart.
 *
 * ── What is being parsed ────────────────────────────────────────────────────
 * pdf-lib's `drawText` emits one text object per call:
 *
 *     BT
 *     /Helvetica-7098480789 9 Tf
 *     8.325 TL
 *     1 0 0 1 472.2 439.84 Tm
 *     <3033> Tj
 *     T*
 *     ET
 *
 * `Tm` carries the origin, `Tf` the size, and `<hex> Tj` the bytes shown. A
 * standard-font Helvetica is WinAnsi-encoded, so those bytes are the characters.
 *
 * ⚠️ THIS READS pdf-lib's OWN OUTPUT, not PDF in general. It is a measuring
 * instrument for these tests, exactly like `pageContentDigests` beside it, and
 * it is not a capability the product has. A page produced by anything else — an
 * agency's own file, a different writer — is out of its scope by construction.
 *
 * ⚠️ AN EMPTY RESULT READS AS FAILURE, NOT AS PASS. A parser that matched
 * nothing would return `[]`, and `[]` satisfies every assertion of the form
 * "none of the runs is wrong". So the tests here assert the runs they EXPECT,
 * by value, rather than asserting the absence of bad ones.
 */
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export interface DrawnRun {
    /** The characters shown by one `Tj`. */
    text: string;
    /** The text-matrix origin: pdf-lib's `x`/`y`, in PDF user space. */
    x: number;
    y: number;
    /** The size from the `Tf` that governs this block. */
    size: number;
}

const BLOCK = /BT\b([\s\S]*?)\bET\b/g;

/**
 * The WinAnsi codes that are NOT the Unicode code point of the same number.
 *
 * A shown byte is a WinAnsi code, and for 0x20-0x7E and 0xA0-0xFF that code IS
 * the Unicode code point, so `String.fromCharCode` is right for every one of
 * them. 0x80-0x9F is the range where it is wrong, and wrong in the direction
 * that hides: an em dash is byte 0x97 on the page, and reading it as U+0097
 * turns a run that says "Roof 3 — Covering material: ..." into one that
 * matches nothing, while neither the page nor the run looks damaged.
 *
 * The five codes WinAnsi leaves undefined are simply ABSENT rather than given a
 * placeholder, so a byte landing on one keeps itself. An earlier draft held all
 * 32 in one string with a blank in each undefined slot, which is a table nobody
 * can proofread and which landed those slots as NULs.
 */
const WIN_ANSI_HIGH: Readonly<Record<number, string>> = {
    0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
    0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š',
    0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’',
    0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
    0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ',
    0x9E: 'ž', 0x9F: 'Ÿ',
};

/** One shown byte, as the character WinAnsi says it is. */
function winAnsiChar(byte: number): string {
    return WIN_ANSI_HIGH[byte] ?? String.fromCharCode(byte);
}

/**
 * The three operators that matter, matched in the order the stream writes them.
 *
 * Scanned as one alternation rather than three separate searches because a text
 * object may set the matrix again between two shown strings — which is exactly
 * what a GENERATED FORM-FIELD APPEARANCE does: one `BT`…`ET` holding a `Tm` and
 * a `Tj` per line. Taking the block's first `Tm` for every `Tj` in it would put
 * all of those lines at the first line's origin, and a value whose last line
 * falls out of the box would then measure as sitting comfortably inside it.
 *
 * A `T*` carries no matrix, so lines broken that way — which is how pdf-lib
 * wraps a `drawText` with a `maxWidth` — keep sharing one origin, exactly as
 * they always have.
 */
const OPERATOR = /\/\S+\s+(-?[\d.]+)\s+Tf|1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|<([0-9A-Fa-f]+)>\s*Tj/g;

/** The decoded content streams of one page, as a byte-per-character string. */
async function contentOf(bytes: Uint8Array, page: number): Promise<string> {
    const doc = await PDFDocument.load(bytes);
    const pg = doc.getPages()[page];
    const contents = pg.node.get(PDFName.of('Contents'));
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let out = '';
    for (const ref of refs) {
        const stream = pg.doc.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) continue;
        // Built character by character rather than through TextDecoder: the
        // stream is binary, and every decoder that has a name also has an
        // opinion about bytes above 0x7F.
        for (const byte of decodePDFRawStream(stream).decode()) {
            out += String.fromCharCode(byte);
        }
    }
    return out;
}

/** Every run of text drawn on one page, in the order it was written. */
export async function drawnRuns(bytes: Uint8Array, page: number): Promise<DrawnRun[]> {
    return runsInContentStream(await contentOf(bytes, page));
}

/**
 * The same parse, over a content stream somebody else already decoded.
 *
 * A page is not the only place pdf-lib writes text objects. Filling a form field
 * makes it GENERATE that widget's appearance stream, and the lines it lays out
 * in there are where a value too tall for its box gets clipped — the appearance
 * carries its own BBox and its own clip path, so the overflow is invisible from
 * the page. `scripts/verify-statutory-render.mjs` reads those, and it reads them
 * through this function rather than a second copy of the regexes below.
 */
export function runsInContentStream(stream: string): DrawnRun[] {
    const runs: DrawnRun[] = [];
    for (const [, body] of stream.matchAll(BLOCK)) {
        let size: number | null = null;
        let x: number | null = null;
        let y: number | null = null;
        for (const match of body.matchAll(OPERATOR)) {
            // Which alternative fired is read off the operator the token ENDS
            // with, not off which capture group came back undefined. The groups
            // of an alternation are typed as present whichever branch matched,
            // so testing them against `undefined` is a comparison the compiler
            // is right to reject.
            const token = match[0];
            if (token.endsWith('Tf')) {
                size = Number(match[1]);
            } else if (token.endsWith('Tm')) {
                x = Number(match[2]);
                y = Number(match[3]);
            } else {
                // Shown before any matrix or any font: nothing here can say
                // where it is or how big, so it is reported as absent rather
                // than guessed at.
                if (size === null || x === null || y === null) continue;
                runs.push({
                    text: (match[4].match(/../g) ?? [])
                        .map((pair) => winAnsiChar(parseInt(pair, 16)))
                        .join(''),
                    x,
                    y,
                    size,
                });
            }
        }
    }
    return runs;
}
