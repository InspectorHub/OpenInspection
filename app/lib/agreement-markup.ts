/**
 * The markup contract for the agreement template editor (#67).
 *
 * WHY A NORMALISER AND NOT JUST A SANITISER. Two sanitizers already stand
 * between a stored agreement and a signer's screen: `sanitizeAgreementHtml()`
 * at write time and DOMPurify inside `<SanitizedHtml>` at render time. Both
 * only ever REMOVE. That is the right posture for a renderer and the wrong one
 * for an editor: if the author can put something on screen that a later pass
 * deletes, the editor has shown them a document they are not actually
 * publishing — on the one surface in this product a client is asked to be bound
 * by. So the editor converges its own output onto the intersection of the two
 * allow-lists BEFORE anything is saved, and `agreement-markup.test.ts` pins
 * that as a fixed point: `sanitizeAgreementHtml(normalize(x)) === normalize(x)`
 * for every input, hostile ones included.
 *
 * NO ATTRIBUTES SURVIVE — none, not even a `class`. The renderer permits
 * `class` (for the `ql-indent-N` of a Quill toolbar this repository does not
 * actually contain — see the note below), and an attribute allow-list is a list
 * somebody has to keep complete. Emitting bare tags makes "no href, no src, no
 * on*" a property of the serializer instead of a rule to be maintained, and it
 * is strictly inside what both sanitizers accept.
 *
 * ⚠️ NOT A SECURITY BOUNDARY. This runs in the browser, where the author
 * controls everything. The boundary is `sanitizeAgreementHtml()` on the server
 * at write time; this module exists so that what the author sees and what that
 * boundary stores are the same document.
 *
 * ⚠️ HISTORICAL NOTE. Comments in `SanitizedHtml.tsx` and
 * `server/services/agreement/sanitizer.ts` describe their allow-lists as
 * mirroring "the Quill editor toolbar". There is no Quill in this repository
 * and no editor of any kind ever shipped — the allow-lists were written for a
 * toolbar that did not exist. This module is that toolbar, arriving late, and
 * it is deliberately a SUBSET rather than a match.
 */

/**
 * Every tag this module can emit. Asserted to be a subset of BOTH sanitizers'
 * allow-lists, which are read out of their source rather than copied here.
 */
export const AGREEMENT_EDITOR_TAGS = [
    "p",
    "h2",
    "h3",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "u",
    "br",
] as const;

/** Block elements a paste might carry, mapped onto the three we can emit. */
const BLOCK_MAP: Record<string, "p" | "h2" | "h3"> = {
    p: "p",
    div: "p",
    section: "p",
    article: "p",
    main: "p",
    aside: "p",
    header: "p",
    footer: "p",
    blockquote: "p",
    pre: "p",
    address: "p",
    figcaption: "p",
    figure: "p",
    dd: "p",
    dt: "p",
    tr: "p",
    caption: "p",
    hr: "p",
    h1: "h2",
    h2: "h2",
    h3: "h3",
    h4: "h3",
    h5: "h3",
    h6: "h3",
};

/**
 * Inline emphasis, mapped onto the three we can emit. `b`/`i` are what Word,
 * Google Docs and `document.execCommand` all produce; dropping them would
 * flatten a pasted agreement into unformatted prose.
 */
const INLINE_MAP: Record<string, "strong" | "em" | "u"> = {
    strong: "strong",
    b: "strong",
    em: "em",
    i: "em",
    cite: "em",
    dfn: "em",
    u: "u",
    ins: "u",
};

/**
 * Elements removed WITH their contents. Everything not listed here and not
 * mapped above is unwrapped instead — `<a>` loses the link but keeps the
 * sentence, because silently deleting a clause is its own kind of wrong.
 */
const DROP_WITH_CONTENT = new Set([
    "script", "style", "iframe", "object", "embed", "svg", "math", "img", "picture",
    "source", "input", "button", "textarea", "select", "option", "form", "link",
    "meta", "base", "noscript", "template", "video", "audio", "canvas", "track",
    "area", "applet", "frame", "frameset", "marquee", "dialog", "slot", "head",
    "title", "param", "portal", "object",
]);

const NODE_TEXT = 3;
const NODE_ELEMENT = 1;

interface Block {
    tag: "p" | "h2" | "h3" | "li";
    list?: "ul" | "ol";
    el: HTMLElement;
}

/**
 * Parse untrusted markup INERTLY, into a `<template>`'s content fragment.
 *
 * The fragment's owner is the template-contents document, which has no
 * browsing context: scripts do not run, `<img src>` issues no request and an
 * `<iframe src>` is never navigated. Setting `innerHTML` on an ordinary
 * detached element would still fetch remote images on the way in — the payload
 * would fire before a single tag was stripped.
 *
 * `document.implementation.createHTMLDocument()` is inert per spec too, and was
 * the first implementation here; it was changed because happy-dom does NOT
 * emulate that inertness — running these very tests against it issued a real
 * request to the hostile fixture's host. A template fragment is inert in both.
 */
function inertFragment(html: string): DocumentFragment {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
        // Callers are client-only by construction (the editor sets its content
        // in an effect). Failing loudly beats silently returning the input,
        // which would hand a caller unnormalised markup that looks normalised.
        throw new Error("normalizeAgreementHtml requires a DOM; call it from the browser only.");
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
}

/** Text-node escaping, matching what a DOM serializer does. */
function escapeText(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Strip the leading/trailing whitespace pretty-printed source leaves behind. */
function trimEdges(el: HTMLElement): void {
    while (el.firstChild?.nodeType === NODE_TEXT) {
        const node = el.firstChild;
        const text = (node.nodeValue ?? "").replace(/^\s+/, "");
        if (text) { node.nodeValue = text; break; }
        el.removeChild(node);
    }
    while (el.lastChild?.nodeType === NODE_TEXT) {
        const node = el.lastChild;
        const text = (node.nodeValue ?? "").replace(/\s+$/, "");
        if (text) { node.nodeValue = text; break; }
        el.removeChild(node);
    }
}

/**
 * Flatten arbitrary markup into an ordered list of blocks, each holding only
 * text and allow-listed inline elements.
 *
 * Flat by construction — a block is never appended inside another block — so
 * the output cannot contain the nested `<p>` that a `<div><p>` paste produces
 * and that re-parses into a different tree than it serialized from.
 */
function buildBlocks(root: Node, doc: Document): Block[] {
    const blocks: Block[] = [];
    const listStack: Array<"ul" | "ol"> = [];
    let current: Block | null = null;
    let inline: HTMLElement[] = [];

    const closeBlock = () => { current = null; inline = []; };

    const openBlock = (tag: Block["tag"], list?: "ul" | "ol") => {
        const block: Block = { tag, el: doc.createElement(tag), ...(list ? { list } : {}) };
        blocks.push(block);
        current = block;
        inline = [];
        return block;
    };

    const target = (): HTMLElement => {
        if (inline.length > 0) return inline[inline.length - 1];
        return (current ?? openBlock("p")).el;
    };

    const walk = (node: Node): void => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === NODE_TEXT) {
                // HTML collapses runs of whitespace; do the same so source
                // indentation does not become content.
                const text = (child.nodeValue ?? "").replace(/\s+/g, " ");
                if (!text) continue;
                // Whitespace BETWEEN blocks is layout, not text.
                if (!text.trim() && !current) continue;
                target().appendChild(doc.createTextNode(text));
                continue;
            }
            // Comment nodes fall through here and are never read, so a payload
            // hidden in `<!-- … -->` never reaches the output.
            if (child.nodeType !== NODE_ELEMENT) continue;

            const el = child as Element;
            const tag = el.tagName.toLowerCase();
            if (DROP_WITH_CONTENT.has(tag)) continue;

            if (tag === "ul" || tag === "ol") {
                closeBlock();
                listStack.push(tag);
                walk(el);
                listStack.pop();
                closeBlock();
                continue;
            }
            if (tag === "li") {
                closeBlock();
                openBlock("li", listStack[listStack.length - 1] ?? "ul");
                walk(el);
                closeBlock();
                continue;
            }
            if (tag === "br") {
                // A break before any block has started is nothing at all.
                if (!current) continue;
                target().appendChild(doc.createElement("br"));
                continue;
            }
            const blockTag = BLOCK_MAP[tag];
            if (blockTag) {
                closeBlock();
                openBlock(blockTag);
                walk(el);
                closeBlock();
                continue;
            }
            const inlineTag = INLINE_MAP[tag];
            if (inlineTag) {
                const wrapper = doc.createElement(inlineTag);
                target().appendChild(wrapper);
                inline.push(wrapper);
                walk(el);
                inline.pop();
                continue;
            }
            // Unwrapped: <a>, <span>, <font>, <table>, <code>, … The element
            // goes, its words stay.
            walk(el);
        }
    };

    walk(root);
    return blocks;
}

/** Re-wrap consecutive `li` blocks into their list and serialize. */
function serializeBlocks(blocks: Block[], doc: Document): string {
    const out = doc.createElement("div");
    let list: HTMLElement | null = null;
    let listType: "ul" | "ol" | null = null;

    for (const block of blocks) {
        if (block.tag === "li") {
            const type = block.list ?? "ul";
            if (!list || listType !== type) {
                list = doc.createElement(type);
                listType = type;
                out.appendChild(list);
            }
            list.appendChild(block.el);
            continue;
        }
        list = null;
        listType = null;
        out.appendChild(block.el);
    }
    return out.innerHTML;
}

/**
 * Convert arbitrary HTML into the editor's subset.
 *
 * Browser-only (see `inertDocument`). Idempotent: normalising already-normal
 * markup returns it unchanged, which is what lets the editor re-run this on
 * every blur without the document drifting under the author.
 */
export function normalizeAgreementHtml(html: string): string {
    if (!html || !html.trim()) return "";
    const fragment = inertFragment(html);
    // Output nodes are built with the LIVE document's factory but never
    // inserted into it — a detached `<p>`/`<strong>`/`<br>` has no side effect,
    // and none of the tags this module can emit load anything.
    const doc = document;

    const blocks = buildBlocks(fragment, doc);
    for (const block of blocks) trimEdges(block.el);
    // A block with no text is not an empty paragraph the author wanted; it is
    // the residue of an unwrapped container. `content` is `min(1)` on the API's
    // Zod schema, and "<p></p>" would satisfy that while rendering as nothing.
    const kept = blocks.filter((block) => (block.el.textContent ?? "").trim() !== "");
    return serializeBlocks(kept, doc);
}

/**
 * Turn plain text into paragraphs. No DOM needed, so this is safe during SSR.
 *
 * Every agreement template seeded by `starter-content.service` is stored as
 * PLAIN TEXT — `sanitizeAgreementHtml` returns anything without a `<`
 * verbatim — and `<SanitizedHtml>` renders it through `innerHTML`, where the
 * newlines that separate its clauses disappear and the whole document collapses
 * into one paragraph. Paragraphing it on the way into the editor makes it
 * editable and, once saved, fixes that rendering.
 */
export function plainTextToAgreementHtml(text: string): string {
    if (!text) return "";
    return text
        .replace(/\r\n?/g, "\n")
        .split(/\n{2,}/)
        .map((block) =>
            block
                .split("\n")
                .map((line) => escapeText(line.trim()))
                .filter(Boolean)
                .join("<br>"),
        )
        .filter(Boolean)
        .map((inner) => `<p>${inner}</p>`)
        .join("");
}

/**
 * Load a STORED `agreements.content` value into the editor.
 *
 * The "no `<` means plain text" test is the server sanitizer's own, quoted
 * here deliberately: the two must agree on what a stored value IS, or a
 * template would be interpreted one way on write and another on read.
 */
export function agreementContentToEditorHtml(content: string): string {
    if (!content || !content.trim()) return "";
    if (!content.includes("<")) return plainTextToAgreementHtml(content);
    return normalizeAgreementHtml(content);
}

/**
 * Words in the document, for the editor's "is there anything here" check.
 *
 * NOT a sanitizer, and its output is never rendered — both callers use only the
 * boolean. Rendering goes through `SanitizedHtml` + DOMPurify, which is the only
 * thing allowed to decide what is safe markup.
 *
 * The strip nonetheless runs to a fixed point, and the honest reason is not the
 * one the rule name suggests. For THIS regex a single pass is already complete:
 * `[^>]*` cannot cross a `>`, so a match starting at `<` consumes everything up
 * to the first following `>` — including any `<` in between. A `<` that survives
 * therefore has no `>` after it and cannot form a tag. Checked against eleven
 * nested and malformed constructions: looping changes nothing.
 *
 * So this is not a fix for an exploitable case, and it is not claimed as one. It
 * is here because CodeQL flags the single-pass form
 * (js/incomplete-multi-character-sanitization) on a file in the agreement-HTML
 * family, and because the completeness argument above depends entirely on the
 * exact regex — narrow the character class or add an alternation and one pass
 * stops being enough, silently. The loop keeps the guarantee that the argument
 * currently provides by hand.
 */
export function agreementHtmlIsEmpty(html: string): boolean {
    let stripped = html;
    let previous: string;
    do {
        previous = stripped;
        stripped = stripped.replace(/<[^>]*>/g, "");
    } while (stripped !== previous);
    return !stripped.replace(/&nbsp;/g, " ").trim();
}
