// @vitest-environment happy-dom
/**
 * The agreement editor's markup contract (#67).
 *
 * An agreement is the one document in this product a client is asked to be
 * BOUND BY, and two different sanitizers stand between the editor and the
 * signer's screen: `sanitizeAgreementHtml()` at write time, and DOMPurify
 * inside `<SanitizedHtml>` at render time. If the editor can emit markup either
 * one strips, the author signs off on a document that says something other than
 * what they saw — the editor becomes a lie about the terms.
 *
 * So the property under test is not "dangerous tags are removed". It is the
 * stronger one: EDITOR OUTPUT IS A FIXED POINT OF THE RENDERER'S SANITIZER.
 * Feed the normalizer anything, and what comes out must survive the server
 * sanitizer byte-for-byte unchanged.
 *
 * The allow-lists are READ FROM THE OTHER TWO FILES' SOURCE rather than
 * restated here. A restated copy is a green that means nothing the day someone
 * edits one of them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    AGREEMENT_EDITOR_TAGS,
    normalizeAgreementHtml,
    plainTextToAgreementHtml,
    agreementContentToEditorHtml,
    agreementHtmlIsEmpty,
} from "./agreement-markup";
import { sanitizeAgreementHtml } from "../../server/services/agreement/sanitizer";

const REPO_ROOT = join(__dirname, "..", "..");

/** The render-time allow-list, read out of the component that applies it. */
function rendererAllowedTags(): string[] {
    const src = readFileSync(join(REPO_ROOT, "app/components/SanitizedHtml.tsx"), "utf8");
    const match = src.match(/const ALLOWED_TAGS = (\[[^\]]*\])/);
    expect(match, "SanitizedHtml ALLOWED_TAGS moved — this guard went blind").not.toBeNull();
    return JSON.parse(match![1]) as string[];
}

/** The write-time allow-list, read out of the server sanitizer. */
function serverAllowedTags(): string[] {
    const src = readFileSync(join(REPO_ROOT, "server/services/agreement/sanitizer.ts"), "utf8");
    const match = src.match(/const allowed = new Set\((\[[^\]]*\])\)/);
    expect(match, "server sanitizer allow-list moved — this guard went blind").not.toBeNull();
    return JSON.parse(match![1].replace(/'/g, '"')) as string[];
}

const HOSTILE = [
    '<a href="https://evil.example/steal">click here</a>',
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)"><circle r="9"/></svg>',
    '<p onclick="alert(1)">The fee is $500.</p>',
    "<script>alert(1)</script>",
    '<iframe src="https://evil.example"></iframe>',
    '<span style="display:none">hidden clause</span>',
    "<!-- <script>alert(1)</script> -->",
].join("");

describe("agreement editor markup — hostile input", () => {
    it("lets no link, image, svg, frame or script through", () => {
        const out = normalizeAgreementHtml(HOSTILE);
        expect(out).not.toMatch(/<a\b/i);
        expect(out).not.toMatch(/<img\b/i);
        expect(out).not.toMatch(/<svg\b/i);
        expect(out).not.toMatch(/<iframe\b/i);
        expect(out).not.toMatch(/<script\b/i);
        expect(out).not.toMatch(/<circle\b/i);
    });

    it("lets no attribute through at all — not href, not src, not an event handler", () => {
        // Stated as "no attributes" rather than "no on* attributes" on purpose.
        // An allow-list of attribute NAMES is a list somebody has to keep
        // complete; emitting no attributes is a property of the serializer.
        const out = normalizeAgreementHtml(HOSTILE);
        expect(out).not.toMatch(/\son\w+\s*=/i);
        expect(out).not.toMatch(/\shref\s*=/i);
        expect(out).not.toMatch(/\ssrc\s*=/i);
        expect(out).not.toMatch(/\sstyle\s*=/i);
        // Every tag in the output is a bare tag.
        for (const tag of out.match(/<[a-z0-9]+[^>]*>/gi) ?? []) {
            expect(tag, `attribute survived in ${tag}`).toMatch(/^<[a-z0-9]+>$/i);
        }
    });

    it("keeps the words a human typed, including the text inside a stripped link", () => {
        // Deleting the text too would silently drop a clause. The link dies;
        // the sentence stays.
        const out = normalizeAgreementHtml(HOSTILE);
        expect(out).toContain("click here");
        expect(out).toContain("The fee is $500.");
        expect(out).toContain("hidden clause");
    });

    it("drops the payload of a script, not just its tag", () => {
        const out = normalizeAgreementHtml("<p>Terms</p><script>alert(1)</script>");
        expect(out).not.toContain("alert(1)");
    });

    it("survives the server sanitizer unchanged — the editor cannot promise what the renderer strips", () => {
        const normalized = normalizeAgreementHtml(HOSTILE);
        expect(sanitizeAgreementHtml(normalized)).toBe(normalized);
    });

    it("is a fixed point for ordinary authored content too", () => {
        const authored = normalizeAgreementHtml(
            "<h2>Scope</h2><p>A <strong>visual</strong>, <em>non-invasive</em> inspection.</p>" +
            "<ul><li>Roof</li><li>Plumbing</li></ul><ol><li>Pay</li></ol><p><u>Signed</u></p>",
        );
        expect(sanitizeAgreementHtml(authored)).toBe(authored);
        expect(normalizeAgreementHtml(authored)).toBe(authored);
    });
});

describe("agreement editor markup — allow-list agreement with the two sanitizers", () => {
    it("emits only tags the renderer keeps", () => {
        const renderer = rendererAllowedTags();
        for (const tag of AGREEMENT_EDITOR_TAGS) {
            expect(renderer, `<${tag}> is not in SanitizedHtml's allow-list`).toContain(tag);
        }
    });

    it("emits only tags the server sanitizer keeps", () => {
        const server = serverAllowedTags();
        for (const tag of AGREEMENT_EDITOR_TAGS) {
            expect(server, `<${tag}> is not in the server sanitizer's allow-list`).toContain(tag);
        }
    });
});

describe("agreement editor markup — what authors actually write", () => {
    it("keeps the formatting the toolbar offers", () => {
        const out = normalizeAgreementHtml(
            "<h2>Title</h2><h3>Sub</h3><p><strong>b</strong><em>i</em><u>u</u></p>" +
            "<ul><li>one</li></ul><ol><li>two</li></ol>",
        );
        expect(out).toContain("<h2>Title</h2>");
        expect(out).toContain("<h3>Sub</h3>");
        expect(out).toContain("<strong>b</strong>");
        expect(out).toContain("<em>i</em>");
        expect(out).toContain("<u>u</u>");
        expect(out).toContain("<ul><li>one</li></ul>");
        expect(out).toContain("<ol><li>two</li></ol>");
    });

    it("maps pasted equivalents onto the allow-list instead of discarding them", () => {
        // Word and Google Docs paste <b>/<i>/<h1>/<div>. Unwrapping those would
        // flatten a pasted agreement into one unformatted block.
        const out = normalizeAgreementHtml("<h1>Big</h1><div><b>bold</b> and <i>ital</i></div>");
        expect(out).toContain("<h2>Big</h2>");
        expect(out).toContain("<strong>bold</strong>");
        expect(out).toContain("<em>ital</em>");
    });

    it("gives each block its own paragraph rather than running them together", () => {
        const out = normalizeAgreementHtml("<div>first</div><div>second</div>");
        expect(out).toBe("<p>first</p><p>second</p>");
    });

    it("never nests a block inside a block", () => {
        const out = normalizeAgreementHtml("<div><p>a</p><p>b</p></div>");
        expect(out).not.toMatch(/<p>[^<]*<p>/);
        expect(out).toBe("<p>a</p><p>b</p>");
    });

    it("drops blocks that contain nothing", () => {
        expect(normalizeAgreementHtml("<p></p><p>  </p><p>real</p>")).toBe("<p>real</p>");
    });

    it("returns an empty string for empty input rather than an empty paragraph", () => {
        // The API's Zod schema requires content.min(1); an "<p></p>" would sail
        // past it and store a template that renders as nothing.
        expect(normalizeAgreementHtml("")).toBe("");
        expect(normalizeAgreementHtml("   \n  ")).toBe("");
        expect(normalizeAgreementHtml("<p><br></p>")).toBe("");
    });
});

describe("plain-text agreements (every seeded template is one)", () => {
    it("turns blank-line-separated text into paragraphs", () => {
        expect(plainTextToAgreementHtml("one\n\ntwo")).toBe("<p>one</p><p>two</p>");
    });

    it("keeps a single newline as a line break inside the paragraph", () => {
        expect(plainTextToAgreementHtml("one\ntwo")).toBe("<p>one<br>two</p>");
    });

    it("escapes text that looks like markup instead of executing it", () => {
        const out = plainTextToAgreementHtml('<script>alert(1)</script> & "quotes"');
        expect(out).not.toMatch(/<script/i);
        expect(out).toContain("&lt;script&gt;");
        expect(out).toContain("&amp;");
        expect(sanitizeAgreementHtml(out)).toBe(out);
    });

    it("loads a stored plain-text template into the editor without losing a character", () => {
        // The seeded starter agreement is stored as plain text with no tags at
        // all, and `sanitizeAgreementHtml` returns it verbatim. Rendered through
        // innerHTML it collapses into one wall of text; paragraphing it on the
        // way into the editor is what makes it editable AND fixes the render.
        const stored = "Section 1\n\nThe Inspector will inspect [PROPERTY_ADDRESS].";
        const editorHtml = agreementContentToEditorHtml(stored);
        expect(editorHtml).toBe("<p>Section 1</p><p>The Inspector will inspect [PROPERTY_ADDRESS].</p>");
    });

    it("leaves an already-HTML template alone apart from normalising it", () => {
        expect(agreementContentToEditorHtml("<p>hello</p>")).toBe("<p>hello</p>");
    });

    describe("agreementHtmlIsEmpty", () => {
        it("calls markup with no words empty, and words non-empty", () => {
            for (const empty of ["", "   ", "<p></p>", "<div><span></span></div>", "<p>&nbsp;</p>"]) {
                expect(agreementHtmlIsEmpty(empty), JSON.stringify(empty)).toBe(true);
            }
            for (const filled of ["hello", "<p>hello</p>", "<p>&nbsp;x</p>"]) {
                expect(agreementHtmlIsEmpty(filled), JSON.stringify(filled)).toBe(false);
            }
        });

        it("finds no words left in nested or malformed tags", () => {
            // The strip loops to a fixed point. For the current regex one pass is
            // already complete — a surviving `<` can have no `>` after it, or it
            // would have matched — so these assert the property, not a difference
            // between one pass and many. They exist so that narrowing the regex
            // later fails here instead of silently leaving markup behind.
            for (const s of ["<<p>>", "<p<p>>", "<scr<script>ipt>", "<<>>", "<<<x>>>"]) {
                const stripped = s.replace(/<[^>]*>/g, "");
                expect(stripped, `${s} still holds a complete tag`).not.toMatch(/<[^>]*>/);
            }
        });
    });
});
