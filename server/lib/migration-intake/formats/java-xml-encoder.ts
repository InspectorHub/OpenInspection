/**
 * Property and value pairs out of a `java.beans.XMLDecoder` document.
 *
 * ⚠️ READS, NEVER EXECUTES. That format is a well-known remote-code-execution
 * vector precisely because a real decoder INSTANTIATES the classes a document
 * names and CALLS the methods it names. Nothing here constructs anything: these
 * functions extract text, so a hostile document is inert. `java-xml-encoder.spec.ts`
 * pins that with a document naming a process-launching class.
 *
 * ── Why textual rather than a parse of the object graph ─────────────────────
 * The graph carries object identity and back-references, so a faithful reader
 * is an interpreter — which is the thing that must not be built. Nothing here
 * needs one: what a template reader wants is a name, a vocabulary, and two
 * nested lists of names.
 *
 * ── Why nesting still has to be tracked ─────────────────────────────────────
 * The elements nest, and the same tag names repeat at every level. A reader
 * that took the next closing tag would end a section at its first item, and a
 * reader that flattened would report every item name as a value of the list
 * property that contains them. Both produce a confident wrong answer, so the
 * scans below are depth-aware.
 */

/**
 * The tokens this reader matches, and nothing else.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. `void` is the element
 * this serialisation format writes both properties and list appends as; the
 * rest is XML's own syntax, from a published specification. None of it is
 * anybody's content, and no class name or property name is embedded here — the
 * caller passes those, and classifies them where it does.
 */
const TOKEN = {
    void: 'void',
    selfClosing: '/>',
    closingSlash: '/',
    yes: 'true',
} as const;

/**
 * The index of the closing tag matching an element that opened at `afterOpen`,
 * or -1 when the document ends first.
 *
 * Self-closing elements do not add depth. Nothing here is tolerant of a `>`
 * inside an attribute value, and it does not need to be: this format writes
 * attributes that are class names and method names.
 */
function closingIndex(xml: string, tag: string, afterOpen: number): number {
    const open = new RegExp(`<${tag}\\b`, 'g');
    const close = new RegExp(`</${tag}\\s*>`, 'g');
    let depth = 1;
    let at = afterOpen;
    while (depth > 0) {
        open.lastIndex = at;
        close.lastIndex = at;
        const nextOpen = open.exec(xml);
        const nextClose = close.exec(xml);
        if (!nextClose) return -1;
        if (nextOpen && nextOpen.index < nextClose.index) {
            const tagEnd = xml.indexOf('>', nextOpen.index);
            if (tagEnd < 0) return -1;
            if (xml[tagEnd - 1] !== TOKEN.closingSlash) depth++;
            at = tagEnd + 1;
            continue;
        }
        depth--;
        at = nextClose.index + nextClose[0].length;
        if (depth === 0) return nextClose.index;
    }
    return -1;
}

/**
 * The body of the first `<void property="name">…</void>`, or null when the
 * document does not carry that property.
 *
 * An empty string is a real answer and is NOT null: a property present and
 * empty is a statement, and a property absent is silence.
 */
function propertyBody(xml: string, property: string): string | null {
    const opener = new RegExp(`<${TOKEN.void}\\b[^>]*\\bproperty="${escapeForRegExp(property)}"[^>]*>`, 'g');
    const match = opener.exec(xml);
    if (!match) return null;
    // `<void property="x"/>` — present, empty, and it never opened.
    if (match[0].endsWith(TOKEN.selfClosing)) return '';
    const start = match.index + match[0].length;
    const end = closingIndex(xml, TOKEN.void, start);
    return end < 0 ? null : xml.slice(start, end);
}

function escapeForRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every `<object …>…</object>` region replaced by nothing, so a scan stays at this level. */
function withoutNestedObjects(xml: string): string {
    let out = '';
    let at = 0;
    const opener = /<object\b[^>]*>/g;
    for (;;) {
        opener.lastIndex = at;
        const match = opener.exec(xml);
        if (!match) return out + xml.slice(at);
        out += xml.slice(at, match.index);
        if (match[0].endsWith(TOKEN.selfClosing)) {
            at = match.index + match[0].length;
            continue;
        }
        const bodyStart = match.index + match[0].length;
        const end = closingIndex(xml, 'object', bodyStart);
        if (end < 0) return out;
        at = xml.indexOf('>', end) + 1;
        if (at === 0) return out;
    }
}

/** The five entities this format writes, decoded once. `&amp;` last, or it eats the others. */
function decodeXml(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * The `<string>` values a property holds, VERBATIM — leading and trailing
 * whitespace included.
 *
 * Verbatim because real vocabularies carry entries with a leading or trailing
 * space, and the person being asked what those words mean has to see them as
 * they are. Trimming would also silently merge two entries that differ only by
 * a space, which is a template quietly losing a rating.
 *
 * Strings inside a NESTED object are not returned: they belong to that object,
 * and a list property whose members are objects has no string values of its own.
 */
export function propertyStrings(xml: string, property: string): string[] {
    const body = propertyBody(xml, property);
    if (body === null) return [];
    const own = withoutNestedObjects(body);
    const out: string[] = [];
    for (const match of own.matchAll(/<string\s*\/>|<string\s*>([\s\S]*?)<\/string\s*>/g)) {
        out.push(decodeXml(match[1] ?? ''));
    }
    return out;
}

/**
 * A boolean property, or NULL when the document does not carry it.
 *
 * The null arm is the whole reason this exists rather than a `?? false`. In
 * real templates the flag it reads was absent far more often than present, and
 * a reader that folded absent into false would state, on the operator's behalf,
 * something his file never said.
 */
export function propertyBoolean(xml: string, property: string): boolean | null {
    const body = propertyBody(xml, property);
    if (body === null) return null;
    const match = withoutNestedObjects(body).match(/<boolean\s*>\s*(true|false)\s*<\/boolean\s*>/);
    return match ? match[1] === TOKEN.yes : null;
}

/**
 * The body of every object whose class name's LAST SEGMENT is `className`.
 *
 * The package prefix is deliberately not matched. These files span fifteen
 * years and the same class has shipped under more than one package, so a reader
 * pinned to one prefix reads none of the others — and reports an empty template
 * rather than an error while doing it.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: the class names callers pass are FORMAT
 * DISCRIMINATORS — the tokens a reader must match to locate anything in a
 * serialised object graph. This module embeds none of them itself.
 */
export function objectsOfClass(xml: string, className: string): string[] {
    const out: string[] = [];
    const opener = /<object\b[^>]*\bclass="([^"]*)"[^>]*>/g;
    let at = 0;
    for (;;) {
        opener.lastIndex = at;
        const match = opener.exec(xml);
        if (!match) return out;
        const full = match[1] ?? '';
        const lastSegment = full.slice(full.lastIndexOf('.') + 1);
        const bodyStart = match.index + match[0].length;
        if (match[0].endsWith(TOKEN.selfClosing)) {
            if (lastSegment === className) out.push('');
            at = bodyStart;
            continue;
        }
        const end = closingIndex(xml, 'object', bodyStart);
        if (end < 0) return out;
        if (lastSegment === className) out.push(xml.slice(bodyStart, end));
        // Scanning CONTINUES inside the body rather than skipping past it, so a
        // nested object of the same class is found too. The reader that skipped
        // would see one item per section however many the section holds.
        at = bodyStart;
    }
}
