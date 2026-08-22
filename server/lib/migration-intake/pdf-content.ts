/**
 * Reading the text out of a page's content stream.
 *
 * A content stream is a sequence of operands followed by an operator, in
 * postfix order. Almost all of them paint lines, curves and images; five show
 * text, and this reads only those five. That is the whole of why the compliance
 * statement about images holds: an image reaches a page through `Do` or an
 * inline `BI … EI` block, and neither produces a character here. There is no
 * branch in this file that can emit image data, so a caller cannot be handed
 * any however the document is shaped.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *
 *   - It does not lay text out. Real extraction orders glyphs by their painted
 *     position; this walks the stream in the order the producer wrote it, which
 *     is the same order for every ordinary document and wrong for a
 *     multi-column one. The consumer is a scanner looking for personal
 *     information and a model reading section headings; neither depends on
 *     column order, and pretending to a fidelity this does not have would
 *     invite one that does.
 *   - It does not follow `Do` into a form XObject, so text nested inside one is
 *     not seen. That is a MISS — text this does not return — never a wrong
 *     reading, and the two failures are not interchangeable.
 */
import type { FontDecoder } from './pdf-fonts';

type Operand =
    | { kind: 'string'; codes: Uint8Array }
    | { kind: 'number'; value: number }
    | { kind: 'name'; value: string }
    | { kind: 'array'; items: Operand[] }
    | { kind: 'other' };

const WHITESPACE = ' \t\r\n\f\0';
const DELIMITERS = '()<>[]{}/%';

/**
 * A kerning adjustment in a `TJ` array that is wide enough to be a word gap.
 *
 * Thousandths of an em, negated by the operator's own convention. Producers
 * routinely set a word space by moving the pen instead of showing a space
 * character, so without this the words of a heading arrive joined — and a
 * street address that reads `123MainStreet` is one no scanner will recognise.
 * The threshold is a heuristic: too low and ordinary letter kerning becomes
 * spaces, too high and words merge. It errs towards inserting the space,
 * because a spurious space splits a word a reader can still read, while a
 * missing one hides a match.
 */
const WORD_GAP = 120;

/** The scanner's position, kept in one object so the readers can share it. */
interface Cursor { s: string; i: number }

function isWhitespace(ch: string): boolean { return WHITESPACE.includes(ch); }
function isDelimiter(ch: string): boolean { return DELIMITERS.includes(ch); }

function skipTrivia(c: Cursor): void {
    for (;;) {
        while (c.i < c.s.length && isWhitespace(c.s[c.i]!)) c.i++;
        if (c.s[c.i] !== '%') return;
        while (c.i < c.s.length && c.s[c.i] !== '\n' && c.s[c.i] !== '\r') c.i++;
    }
}

/** `(…)`, with nested parentheses and the backslash escapes. */
function readLiteralString(c: Cursor): Uint8Array {
    c.i++; // the opening parenthesis
    const bytes: number[] = [];
    let depth = 1;
    while (c.i < c.s.length) {
        const ch = c.s[c.i]!;
        c.i++;
        if (ch === '\\') {
            const next = c.s[c.i];
            if (next === undefined) break;
            c.i++;
            const simple: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
            if (next in simple) { bytes.push(simple[next]!); continue; }
            if (next >= '0' && next <= '7') {
                let octal = next;
                while (octal.length < 3 && c.s[c.i] !== undefined && c.s[c.i]! >= '0' && c.s[c.i]! <= '7') {
                    octal += c.s[c.i]!;
                    c.i++;
                }
                bytes.push(parseInt(octal, 8) & 0xff);
                continue;
            }
            // A backslash before a newline is a line continuation and adds
            // nothing; before anything else it escapes that character.
            if (next === '\n') continue;
            if (next === '\r') { if (c.s[c.i] === '\n') c.i++; continue; }
            bytes.push(next.charCodeAt(0) & 0xff);
            continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (depth === 0) break; }
        bytes.push(ch.charCodeAt(0) & 0xff);
    }
    return Uint8Array.from(bytes);
}

/** `<…>`; an odd number of digits is padded, as the format specifies. */
function readHexString(c: Cursor): Uint8Array {
    c.i++; // the opening angle bracket
    let hex = '';
    while (c.i < c.s.length && c.s[c.i] !== '>') {
        const ch = c.s[c.i]!;
        if (/[0-9a-fA-F]/.test(ch)) hex += ch;
        c.i++;
    }
    c.i++; // the closing angle bracket
    if (hex.length % 2) hex += '0';
    const bytes = new Uint8Array(hex.length / 2);
    for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16);
    return bytes;
}

function readRegularToken(c: Cursor): string {
    let out = '';
    while (c.i < c.s.length && !isWhitespace(c.s[c.i]!) && !isDelimiter(c.s[c.i]!)) {
        out += c.s[c.i]!;
        c.i++;
    }
    return out;
}

/** `<<…>>`, skipped whole: no text-showing operator takes a dictionary. */
function skipDictionary(c: Cursor): void {
    c.i += 2;
    let depth = 1;
    while (c.i < c.s.length && depth > 0) {
        if (c.s.startsWith('<<', c.i)) { depth++; c.i += 2; continue; }
        if (c.s.startsWith('>>', c.i)) { depth--; c.i += 2; continue; }
        if (c.s[c.i] === '(') { readLiteralString(c); continue; }
        c.i++;
    }
}

/**
 * An inline image: `BI <dict> ID <raw bytes> EI`.
 *
 * Skipped as a unit, and it has to be: the bytes between `ID` and `EI` are
 * image samples, and a tokeniser walking through them would read parentheses
 * and angle brackets out of pixel data and emit whatever fell between as text.
 * That is precisely the failure mode the "no images leave this process"
 * assertion is about.
 */
function skipInlineImage(c: Cursor): void {
    const id = c.s.indexOf('ID', c.i);
    if (id === -1) { c.i = c.s.length; return; }
    c.i = id + 2;
    const end = c.s.slice(c.i).search(/[\s>]EI(?=[\s\]/[<(]|$)/);
    c.i = end === -1 ? c.s.length : c.i + end + 3;
}

function readOperand(c: Cursor): Operand | { kind: 'operator'; value: string } | null {
    skipTrivia(c);
    if (c.i >= c.s.length) return null;
    const ch = c.s[c.i]!;
    if (ch === '(') return { kind: 'string', codes: readLiteralString(c) };
    if (ch === '<' && c.s[c.i + 1] === '<') { skipDictionary(c); return { kind: 'other' }; }
    if (ch === '<') return { kind: 'string', codes: readHexString(c) };
    if (ch === '/') { c.i++; return { kind: 'name', value: readRegularToken(c) }; }
    if (ch === '[') {
        c.i++;
        const items: Operand[] = [];
        for (;;) {
            skipTrivia(c);
            if (c.i >= c.s.length || c.s[c.i] === ']') { c.i++; break; }
            const item = readOperand(c);
            if (item === null) break;
            if (item.kind === 'operator') continue;
            items.push(item);
        }
        return { kind: 'array', items };
    }
    if (ch === ']' || ch === '{' || ch === '}' || ch === ')' || ch === '>') { c.i++; return { kind: 'other' }; }
    const token = readRegularToken(c);
    if (token === '') { c.i++; return { kind: 'other' }; }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) return { kind: 'number', value: Number(token) };
    return { kind: 'operator', value: token };
}

/**
 * The text of one content stream, or `null` if any of it was shown through a
 * font whose bytes cannot be read.
 *
 * Null propagates out of the whole page rather than dropping the unreadable
 * run, because a page missing its headings is a page that reads as a different
 * document — and nothing downstream could tell that had happened.
 *
 * `fontDecoder` is asked per resource name rather than handed a table, so the
 * caller decides what "not found" means and this file never has to guess.
 */
export function extractContentText(
    content: Uint8Array,
    fontDecoder: (resourceName: string) => FontDecoder | null,
): string | null {
    const c: Cursor = { s: new TextDecoder('latin1').decode(content), i: 0 };
    const out: string[] = [];
    let operands: Operand[] = [];
    let current: FontDecoder | null = null;
    let pendingBreak = false;
    let failed = false;

    const show = (codes: Uint8Array): void => {
        if (!current) { failed = true; return; }
        const text = current(codes);
        if (text === null) { failed = true; return; }
        if (!text) return;
        if (pendingBreak && out.length) out.push('\n');
        pendingBreak = false;
        out.push(text);
    };

    while (!failed) {
        const token = readOperand(c);
        if (token === null) break;
        if (token.kind !== 'operator') {
            operands.push(token);
            if (operands.length > 64) operands = operands.slice(-64);
            continue;
        }
        switch (token.value) {
            case 'Tf': {
                const name = operands.find((o) => o.kind === 'name');
                // A `Tf` naming a font the page does not list leaves NO
                // decoder, so the next show fails rather than continuing under
                // whichever font happened to be selected before it.
                current = name?.kind === 'name' ? fontDecoder(name.value) : null;
                break;
            }
            case 'Tj':
            case '\'':
            case '"': {
                if (token.value !== 'Tj') pendingBreak = true;
                const last = operands.filter((o) => o.kind === 'string').pop();
                if (last?.kind === 'string') show(last.codes);
                break;
            }
            case 'TJ': {
                const array = operands.filter((o) => o.kind === 'array').pop();
                if (array?.kind === 'array') {
                    for (const item of array.items) {
                        if (item.kind === 'string') show(item.codes);
                        else if (item.kind === 'number' && item.value <= -WORD_GAP) out.push(' ');
                    }
                }
                break;
            }
            case 'BT':
            case 'ET':
            case 'Td':
            case 'TD':
            case 'Tm':
            case 'T*':
                pendingBreak = true;
                break;
            case 'BI':
                skipInlineImage(c);
                break;
            default:
                break;
        }
        operands = [];
    }

    return failed ? null : out.join('');
}
