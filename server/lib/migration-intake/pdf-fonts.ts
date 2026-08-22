/**
 * How to read the bytes a PDF shows through a given font — or the admission
 * that we cannot.
 *
 * A PDF string operand is not text. It is a sequence of CODES whose meaning is
 * decided by the font that was selected when they were shown, and two documents
 * can carry identical bytes that stand for entirely different sentences. So a
 * decoder is built per font, from that font's own dictionary, and text shown
 * through a font with no decoder is not read at all.
 *
 * ⚠️ THE REFUSAL IS THE FEATURE. Every arm below that returns `null` could
 * instead have returned the bytes reinterpreted as Latin-1, which would produce
 * something for every document ever uploaded. It would also be wrong in a way
 * nobody downstream could detect: correct for the ASCII range, quietly wrong
 * above it, and entirely wrong for a subset font, whose byte `\x01` is
 * whichever glyph the producer happened to put first. The consumer of this text
 * derives a template from it — a garbled reading produces a garbled template
 * that looks like a real one, which is worse than producing nothing.
 *
 * TWO ENCODINGS ARE UNDERSTOOD, AND THAT IS DELIBERATELY NARROW.
 *
 *   - `/ToUnicode`, a CMap the producer wrote precisely so that its bytes could
 *     be read back. Where it exists it is authoritative, whatever else the font
 *     says.
 *   - `/WinAnsiEncoding`, the flat byte-to-character table almost every simple
 *     Latin font declares.
 *
 * Everything else — MacRoman, a base encoding with a `/Differences` array,
 * StandardEncoding by omission, a CID font with an identity CMap and no
 * `/ToUnicode` — has no decoder here and yields `null`. Some of those are
 * readable in principle. Reading them needs a glyph-name table this repository
 * does not carry, and half-implementing one is how the wrong answer gets in.
 */
import { PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/**
 * Reads one string operand.
 *
 * Returns `null` — never a partial reading — when any code in it has no
 * character. A sentence with three characters silently missing is still a
 * sentence, and it is the shape a reader cannot tell from a correct one.
 */
export type FontDecoder = (codes: Uint8Array) => string | null;

/**
 * WinAnsi (code page 1252) differs from Latin-1 only in `0x80`–`0x9F`, so only
 * that block is listed. `null` marks the five codes the encoding leaves
 * undefined: a viewer draws nothing for them, so dropping them is what the
 * encoding SAYS rather than a guess about what was meant.
 */
const WIN_ANSI_HIGH: readonly (string | null)[] = [
    '€', null, '‚', 'ƒ', '„', '…', '†', '‡',
    'ˆ', '‰', 'Š', '‹', 'Œ', null, 'Ž', null,
    null, '‘', '’', '“', '”', '•', '–', '—',
    '˜', '™', 'š', '›', 'œ', null, 'ž', 'Ÿ',
];

const winAnsiDecoder: FontDecoder = (codes) => {
    let out = '';
    for (const code of codes) {
        if (code >= 0x80 && code <= 0x9f) {
            const ch = WIN_ANSI_HIGH[code - 0x80];
            if (ch) out += ch;
            continue;
        }
        // Control codes carry no glyph in this encoding either. A tab and a
        // newline inside a shown string are not layout — layout is the
        // positioning operators — so they are dropped with the rest.
        if (code < 0x20 || code === 0x7f) continue;
        out += String.fromCharCode(code);
    }
    return out;
};

/** Hexadecimal digits to a number, or null if any digit is not one. */
function hexValue(hex: string): number | null {
    if (!hex.length || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    return parseInt(hex, 16);
}

/** UTF-16BE hex, as a CMap destination is always written. */
function hexToText(hex: string): string | null {
    if (hex.length % 4 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
    let out = '';
    for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
}

/** Every `<…>` in a chunk of CMap source, in order. */
function hexTokens(chunk: string): string[] {
    return Array.from(chunk.matchAll(/<([0-9a-fA-F]*)>/g), (m) => m[1] ?? '');
}

/** One item of a `bfrange` chunk: a hexadecimal string, or a bracketed list of
 *  them. Kept apart so the third item of an entry stays one thing. */
interface RangeItem { hex?: string; list?: string[] }

function rangeItems(chunk: string): RangeItem[] {
    return Array.from(chunk.matchAll(/<([0-9a-fA-F]*)>|\[([\s\S]*?)\]/g), (m) =>
        m[2] === undefined ? { hex: m[1] ?? '' } : { list: hexTokens(m[2]) });
}

function sections(source: string, begin: string, end: string): string[] {
    const re = new RegExp(`begin${begin}([\\s\\S]*?)end${end}`, 'g');
    return Array.from(source.matchAll(re), (m) => m[1] ?? '');
}

/**
 * A `/ToUnicode` CMap as a code-to-text map, plus how many bytes a code is.
 *
 * Returns `null` when the codespace is neither one nor two bytes wide, or
 * declares two widths at once. A mixed-width codespace needs the full CMap
 * matching algorithm, and approximating it would split codes in the wrong
 * places — which produces text, in the wrong order, from the right document.
 */
function parseToUnicodeCMap(source: string): { width: number; map: Map<number, string> } | null {
    const widths = new Set<number>();
    for (const range of sections(source, 'codespacerange', 'codespacerange')) {
        for (const token of hexTokens(range)) widths.add(token.length / 2);
    }
    if (widths.size > 1) return null;
    const width = widths.size === 1 ? [...widths][0]! : 1;
    if (width !== 1 && width !== 2) return null;

    const map = new Map<number, string>();
    for (const chunk of sections(source, 'bfchar', 'bfchar')) {
        const tokens = hexTokens(chunk);
        for (let i = 0; i + 1 < tokens.length; i += 2) {
            const code = hexValue(tokens[i]!);
            const text = hexToText(tokens[i + 1]!);
            if (code === null || text === null) return null;
            map.set(code, text);
        }
    }
    for (const chunk of sections(source, 'bfrange', 'bfrange')) {
        // Entries come in THREES — `<lo> <hi> <dst>` or `<lo> <hi> [<a> <b> …]`
        // — and the two forms mean different things, so the third item is read
        // as a unit rather than as more hexadecimal tokens. A parser that
        // flattened the array form would take its first element for a
        // start-of-range destination and renumber every character after it,
        // producing text that is the right length and the wrong words.
        const items = rangeItems(chunk);
        for (let i = 0; i + 2 < items.length; i += 3) {
            const loItem = items[i]!;
            const hiItem = items[i + 1]!;
            const dst = items[i + 2]!;
            if (loItem.list || hiItem.list) return null;
            const lo = hexValue(loItem.hex ?? '');
            const hi = hexValue(hiItem.hex ?? '');
            if (lo === null || hi === null || hi < lo) return null;
            if (dst.list) {
                for (let code = lo; code <= hi; code++) {
                    const text = hexToText(dst.list[code - lo] ?? '');
                    if (text === null) return null;
                    map.set(code, text);
                }
                continue;
            }
            const base = hexToText(dst.hex ?? '');
            if (base === null || base.length === 0) return null;
            for (let code = lo; code <= hi; code++) {
                const last = base.charCodeAt(base.length - 1) + (code - lo);
                map.set(code, base.slice(0, -1) + String.fromCharCode(last));
            }
        }
    }
    return map.size ? { width, map } : null;
}

function cmapDecoder(parsed: { width: number; map: Map<number, string> }): FontDecoder {
    return (codes) => {
        let out = '';
        for (let i = 0; i < codes.length; i += parsed.width) {
            if (i + parsed.width > codes.length) return null;
            const code = parsed.width === 1 ? codes[i]! : (codes[i]! << 8) | codes[i + 1]!;
            const text = parsed.map.get(code);
            // A code the producer's own map does not name has no reading. This
            // is the one place the difference from WinAnsi matters: there, an
            // undefined code draws nothing and dropping it is faithful; here,
            // the map IS the meaning, and a missing entry means we do not know
            // what the glyph was.
            if (text === undefined) return null;
            out += text;
        }
        return out;
    };
}

/** Whether an `/Encoding` entry names the one flat encoding understood here. */
function isWinAnsi(encoding: unknown): boolean {
    if (encoding instanceof PDFName) return encoding.asString() === '/WinAnsiEncoding';
    if (encoding instanceof PDFDict) {
        // A `/Differences` array remaps codes to GLYPH NAMES, which need a
        // name-to-character table this repository does not carry.
        if (encoding.has(PDFName.of('Differences'))) return false;
        return isWinAnsi(encoding.lookup(PDFName.of('BaseEncoding')));
    }
    return false;
}

/**
 * The decoder for one font dictionary, or `null` when its bytes cannot be read.
 *
 * `/ToUnicode` is consulted FIRST and wins outright. A subset font commonly
 * declares `/WinAnsiEncoding` alongside a `/ToUnicode` that contradicts it, and
 * the encoding is the one that is wrong: the producer wrote the CMap because
 * the codes do not mean what a flat table would say.
 */
export function fontDecoderFor(font: PDFDict): FontDecoder | null {
    const toUnicode = font.lookup(PDFName.of('ToUnicode'));
    if (toUnicode instanceof PDFRawStream) {
        const source = new TextDecoder('latin1').decode(decodePDFRawStream(toUnicode).decode());
        const parsed = parseToUnicodeCMap(source);
        return parsed ? cmapDecoder(parsed) : null;
    }
    return isWinAnsi(font.lookup(PDFName.of('Encoding'))) ? winAnsiDecoder : null;
}
