// @vitest-environment happy-dom
/**
 * The agreement rich-text editor (#67).
 *
 * The assertion that matters here is not "the toolbar works". It is that
 * NOTHING THE AUTHOR CANNOT PUBLISH CAN GET ONTO THEIR SCREEN. Pasting from
 * Word, an email or a web page is how a real agreement gets written, and a
 * paste carries links, images, inline styles and — from a hostile page — event
 * handlers. If any of that lands in the editable region, the author reviews a
 * document that the write-time sanitizer will quietly rewrite, and signs off on
 * terms they never read.
 *
 * So: hostile markup is asserted dead in TWO places — the DOM the author looks
 * at, and the value handed to the caller for saving — and the value is checked
 * against the real server sanitizer rather than a restatement of it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { AgreementRichText } from "./AgreementRichText";
import { sanitizeAgreementHtml } from "../../../server/services/agreement/sanitizer";

const HOSTILE_PASTE =
    '<p onclick="steal()">Buyer waives <a href="https://evil.example">all claims</a>.</p>' +
    '<img src="https://evil.example/pixel.gif" onerror="steal()">' +
    '<svg onload="steal()"></svg>' +
    "<script>steal()</script>";

function pasteInto(el: HTMLElement, html: string, text = "") {
    fireEvent.paste(el, {
        clipboardData: {
            getData: (type: string) => (type === "text/html" ? html : text),
            types: html ? ["text/html", "text/plain"] : ["text/plain"],
        },
    });
}

function editorEl(): HTMLElement {
    return screen.getByRole("textbox", { name: /agreement/i });
}

beforeEach(() => {
    // happy-dom does not implement execCommand; the component must tolerate
    // that rather than throw, and the toolbar assertions stub it explicitly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (document as any).execCommand;
});

describe("AgreementRichText — what a paste may bring in", () => {
    it("puts no link, image, svg or script into the editable region", () => {
        render(<AgreementRichText value="" onChange={() => {}} />);
        const editor = editorEl();
        pasteInto(editor, HOSTILE_PASTE);

        expect(editor.querySelector("a")).toBeNull();
        expect(editor.querySelector("img")).toBeNull();
        expect(editor.querySelector("svg")).toBeNull();
        expect(editor.querySelector("script")).toBeNull();
        expect(editor.innerHTML).not.toMatch(/\son\w+\s*=/i);
        expect(editor.innerHTML).not.toContain("steal()");
    });

    it("keeps the clause that was pasted, minus its link", () => {
        render(<AgreementRichText value="" onChange={() => {}} />);
        const editor = editorEl();
        pasteInto(editor, HOSTILE_PASTE);
        expect(editor.textContent).toContain("Buyer waives all claims.");
    });

    it("hands the caller a value the server sanitizer will not alter", () => {
        const onChange = vi.fn();
        render(<AgreementRichText value="" onChange={onChange} />);
        pasteInto(editorEl(), HOSTILE_PASTE);

        expect(onChange).toHaveBeenCalled();
        const emitted = onChange.mock.calls.at(-1)![0] as string;
        expect(emitted).not.toMatch(/<a\b|<img\b|<svg\b|<script\b/i);
        expect(sanitizeAgreementHtml(emitted)).toBe(emitted);
    });

    it("keeps the formatting of a benign paste instead of flattening it", () => {
        const onChange = vi.fn();
        render(<AgreementRichText value="" onChange={onChange} />);
        pasteInto(editorEl(), "<h1>Scope</h1><div><b>Visual</b> inspection only.</div>");

        const emitted = onChange.mock.calls.at(-1)![0] as string;
        expect(emitted).toContain("<h2>Scope</h2>");
        expect(emitted).toContain("<strong>Visual</strong>");
    });

    it("treats a plain-text paste as text, not as markup", () => {
        const onChange = vi.fn();
        render(<AgreementRichText value="" onChange={onChange} />);
        pasteInto(editorEl(), "", "<script>steal()</script> is not a clause");

        const emitted = onChange.mock.calls.at(-1)![0] as string;
        expect(emitted).not.toMatch(/<script/i);
        expect(emitted).toContain("&lt;script&gt;");
        expect(editorEl().querySelector("script")).toBeNull();
    });

    it("refuses a drop for the same reason it intercepts a paste", () => {
        render(<AgreementRichText value="" onChange={() => {}} />);
        const editor = editorEl();
        const dropped = fireEvent.drop(editor, { dataTransfer: { getData: () => HOSTILE_PASTE, types: ["text/html"] } });
        // preventDefault() ⇒ fireEvent returns false. A drop that reached the
        // browser's default handler would insert the markup verbatim.
        expect(dropped).toBe(false);
        expect(editor.querySelector("a, img, svg")).toBeNull();
    });
});

describe("AgreementRichText — the document it shows", () => {
    it("shows the stored agreement it was given", () => {
        render(<AgreementRichText value="<p>Existing <strong>terms</strong>.</p>" onChange={() => {}} />);
        expect(editorEl().textContent).toContain("Existing terms.");
        expect(editorEl().querySelector("strong")).not.toBeNull();
    });

    it("converges the visible document onto the saved one when focus leaves", () => {
        // Typing and the browser's own editing commands can leave markup the
        // normaliser will change. Rewriting on blur — rather than on every
        // keystroke, which would fight the caret — means the author is never
        // looking at something different from what a save would store.
        const onChange = vi.fn();
        render(<AgreementRichText value="" onChange={onChange} />);
        const editor = editorEl();
        editor.innerHTML = '<div>a</div><a href="https://evil.example">b</a>';
        fireEvent.blur(editor);

        expect(editor.innerHTML).toBe("<p>a</p><p>b</p>");
        expect(onChange).toHaveBeenLastCalledWith("<p>a</p><p>b</p>");
    });

    it("does not fight the caret by rewriting the DOM while typing", () => {
        const onChange = vi.fn();
        render(<AgreementRichText value="" onChange={onChange} />);
        const editor = editorEl();
        editor.innerHTML = "<div>half-typed";
        fireEvent.input(editor);

        // The caller is told the normalised value…
        expect(onChange).toHaveBeenLastCalledWith("<p>half-typed</p>");
        // …but the author's own markup is left where their cursor is.
        expect(editor.innerHTML).toBe("<div>half-typed</div>");
    });

    it("is reachable and named for a screen reader", () => {
        render(<AgreementRichText value="" onChange={() => {}} />);
        const editor = editorEl();
        expect(editor).toHaveAttribute("contenteditable", "true");
        expect(editor).toHaveAttribute("role", "textbox");
        expect(editor).toHaveAttribute("aria-multiline", "true");
    });
});

describe("AgreementRichText — the toolbar", () => {
    it("offers only formatting the renderer can display", () => {
        // A toolbar button for something the sanitizer strips — a link, an
        // image, a text colour — is a promise the document cannot keep.
        render(<AgreementRichText value="" onChange={() => {}} />);
        const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
        expect(labels.join("|")).not.toMatch(/link|image|photo|colou?r|font|table/i);
    });

    it("applies bold through the browser's own editing command", () => {
        const exec = vi.fn(() => true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document as any).execCommand = exec;
        render(<AgreementRichText value="" onChange={() => {}} />);

        fireEvent.click(screen.getByRole("button", { name: /bold/i }));
        expect(exec).toHaveBeenCalledWith("bold", false, undefined);
    });

    it("makes a heading a heading the allow-list contains", () => {
        const exec = vi.fn(() => true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document as any).execCommand = exec;
        render(<AgreementRichText value="" onChange={() => {}} />);

        fireEvent.click(screen.getByRole("button", { name: /heading 2/i }));
        expect(exec).toHaveBeenCalledWith("formatBlock", false, "<h2>");
    });

    it("does not throw where the browser has no execCommand", () => {
        render(<AgreementRichText value="" onChange={() => {}} />);
        expect(() => fireEvent.click(screen.getByRole("button", { name: /bold/i }))).not.toThrow();
    });

    it("takes no focus away from the text being formatted", () => {
        // A toolbar button that focuses itself collapses the selection, so the
        // command lands on nothing.
        render(<AgreementRichText value="" onChange={() => {}} />);
        const button = screen.getByRole("button", { name: /bold/i });
        expect(fireEvent.mouseDown(button)).toBe(false);
    });
});
