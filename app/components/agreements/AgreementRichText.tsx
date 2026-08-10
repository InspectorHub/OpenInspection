/**
 * The agreement rich-text editor (#67).
 *
 * WHAT IT IS. A `contenteditable` region plus a toolbar whose buttons are
 * exactly the formatting the two agreement sanitizers keep — bold, italic,
 * underline, two heading levels, two kinds of list. No dependency: no Quill, no
 * TipTap, no ProseMirror. That is not thrift. A general-purpose editor arrives
 * knowing how to insert links, images, tables and colours, and every one of
 * those is stripped on the way to a signer's screen; the work would then be
 * subtracting features until the toolbar matched an allow-list ten tags long.
 *
 * WHAT IT GUARANTEES. Everything entering the editable region goes through
 * `normalizeAgreementHtml()` first, so the author never sees markup that a
 * later pass will remove. That matters most on PASTE, which is how real
 * agreements get written — out of Word, an email, another inspector's PDF —
 * and which carries links, inline styles, images, and from a hostile page,
 * event handlers.
 *
 * WHEN IT NORMALISES, and why not always. On paste and on blur; never per
 * keystroke. Rewriting `innerHTML` under a caret moves it to the start of the
 * element, so a per-keystroke normalisation is unusable. Blur is the moment
 * where converging the visible document onto the storable one costs nothing —
 * and the caller is handed the normalised value on every change regardless, so
 * a save mid-typing still saves the clean document.
 *
 * ⚠️ THIS IS NOT THE SECURITY BOUNDARY. It runs in the browser, where the
 * author already controls everything. `sanitizeAgreementHtml()` on the server
 * is the boundary; `<SanitizedHtml>`'s DOMPurify pass is defense in depth at
 * render. This component exists so those two never have to disagree with what
 * the author was shown. `agreement-markup.test.ts` pins the relationship:
 * editor output is a FIXED POINT of the server sanitizer.
 */
import { useEffect, useRef } from "react";
import {
    normalizeAgreementHtml,
    plainTextToAgreementHtml,
    agreementContentToEditorHtml,
} from "~/lib/agreement-markup";
import { m } from "~/paraglide/messages";

interface AgreementRichTextProps {
    /** The stored `agreements.content`. Plain text and HTML are both accepted. */
    value: string;
    /** Receives NORMALISED html — always safe to save as-is. */
    onChange: (html: string) => void;
    disabled?: boolean;
    /** Id of a hint element, so the description reaches assistive technology. */
    describedBy?: string;
}

/** `execCommand` is deprecated and irreplaceable: no standard successor exists
 *  for "bold the selection" inside `contenteditable`. Absent in some runtimes
 *  (happy-dom among them), so every call is guarded rather than assumed. */
function exec(command: string, value?: string): boolean {
    const doc = document as Document & {
        execCommand?: (command: string, showUi?: boolean, value?: string) => boolean;
    };
    if (typeof doc.execCommand !== "function") return false;
    try {
        return doc.execCommand(command, false, value);
    } catch {
        return false;
    }
}

/**
 * Insert already-normalised markup at the caret.
 *
 * Hand-rolled rather than `execCommand('insertHTML')` because that command is
 * the one most inconsistently implemented across engines, and because the
 * fragment is built through a `<template>` — inert, so nothing in it can load
 * or run even in the instant before it is inserted.
 */
function insertHtmlAtCaret(root: HTMLElement, html: string): void {
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    const lastNode = fragment.lastChild;

    const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    // A caret outside the editor is not this editor's caret. Append instead of
    // writing into whatever else on the page happens to be focused.
    if (!range || !root.contains(range.commonAncestorContainer)) {
        root.appendChild(fragment);
        return;
    }

    range.deleteContents();
    range.insertNode(fragment);
    if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection!.removeAllRanges();
        selection!.addRange(range);
    }
}

interface ToolbarAction {
    label: string;
    /** Glyph, styled to look like what the button does. */
    glyph: string;
    glyphClass?: string;
    command: string;
    value?: string;
}

export function AgreementRichText({ value, onChange, disabled = false, describedBy }: AgreementRichTextProps) {
    const ref = useRef<HTMLDivElement>(null);
    /** The last value this component put in the DOM or handed to the caller.
     *  `null` until the first sync, so an initial empty value still writes. */
    const applied = useRef<string | null>(null);

    // Only re-sync when the value changed OUTSIDE this component (a different
    // template was opened). Writing on every render would erase what is being
    // typed, and writing on our own emissions would move the caret home.
    useEffect(() => {
        const el = ref.current;
        if (!el || value === applied.current) return;
        el.innerHTML = agreementContentToEditorHtml(value);
        applied.current = value;
    }, [value]);

    useEffect(() => {
        // Produce `<b>` / `<i>` rather than `<span style="font-weight:bold">`,
        // which the sanitizers strip to nothing. The normaliser maps b→strong.
        exec("styleWithCSS", "false");
    }, []);

    const emit = (): string => {
        const el = ref.current;
        if (!el) return "";
        const html = normalizeAgreementHtml(el.innerHTML);
        applied.current = html;
        onChange(html);
        return html;
    };

    const runCommand = (action: ToolbarAction) => {
        if (disabled) return;
        ref.current?.focus();
        exec(action.command, action.value);
        emit();
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const el = ref.current;
        if (!el || disabled) return;
        const clipboard = event.clipboardData;
        const html = clipboard?.getData("text/html") ?? "";
        const text = clipboard?.getData("text/plain") ?? "";
        // Plain text is TEXT: it is escaped into paragraphs, never parsed. A
        // clipboard holding the characters `<script>` is someone quoting a tag
        // in a clause, not someone writing one.
        const markup = html ? normalizeAgreementHtml(html) : plainTextToAgreementHtml(text);
        if (!markup) return;
        insertHtmlAtCaret(el, markup);
        emit();
    };

    // A drop bypasses `onPaste` entirely and the browser inserts the dragged
    // markup verbatim — the same hole, through a different door.
    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const el = ref.current;
        if (!el || disabled) return;
        const html = event.dataTransfer?.getData("text/html") ?? "";
        const text = event.dataTransfer?.getData("text/plain") ?? "";
        const markup = html ? normalizeAgreementHtml(html) : plainTextToAgreementHtml(text);
        if (!markup) return;
        insertHtmlAtCaret(el, markup);
        emit();
    };

    const handleBlur = () => {
        const el = ref.current;
        if (!el) return;
        const html = normalizeAgreementHtml(el.innerHTML);
        if (el.innerHTML !== html) el.innerHTML = html;
        applied.current = html;
        onChange(html);
    };

    const actions: ToolbarAction[] = [
        { label: m.agreement_editor_bold(), glyph: "B", glyphClass: "font-black", command: "bold" },
        { label: m.agreement_editor_italic(), glyph: "I", glyphClass: "italic font-serif", command: "italic" },
        { label: m.agreement_editor_underline(), glyph: "U", glyphClass: "underline", command: "underline" },
        { label: m.agreement_editor_heading2(), glyph: "H2", command: "formatBlock", value: "<h2>" },
        { label: m.agreement_editor_heading3(), glyph: "H3", command: "formatBlock", value: "<h3>" },
        { label: m.agreement_editor_paragraph(), glyph: "¶", command: "formatBlock", value: "<p>" },
        { label: m.agreement_editor_bullet_list(), glyph: "•—", command: "insertUnorderedList" },
        { label: m.agreement_editor_numbered_list(), glyph: "1—", command: "insertOrderedList" },
    ];

    return (
        <div className="rounded-ih-input border border-ih-border bg-ih-bg-card focus-within:border-ih-primary">
            <div
                role="toolbar"
                aria-label={m.agreement_editor_toolbar_label()}
                className="flex flex-wrap items-center gap-1 border-b border-ih-border px-2 py-1.5"
            >
                {actions.map((action) => (
                    <button
                        key={action.label}
                        type="button"
                        aria-label={action.label}
                        title={action.label}
                        disabled={disabled}
                        // Keep the selection: a button that takes focus collapses
                        // it, and the command then applies to nothing.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand(action)}
                        className={`min-w-8 h-8 px-2 rounded-ih-button text-[13px] text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-fg-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${action.glyphClass ?? ""}`}
                    >
                        {action.glyph}
                    </button>
                ))}
            </div>

            <div
                ref={ref}
                role="textbox"
                aria-multiline="true"
                aria-label={m.agreement_editor_body_label()}
                aria-describedby={describedBy}
                contentEditable={!disabled}
                suppressContentEditableWarning
                spellCheck
                tabIndex={0}
                onInput={emit}
                onPaste={handlePaste}
                onDrop={handleDrop}
                onDragOver={(event) => event.preventDefault()}
                onBlur={handleBlur}
                className="ih-agreement-prose min-h-64 max-h-[50vh] overflow-y-auto px-4 py-3 text-[14px] leading-relaxed text-ih-fg-1 outline-none"
            />
        </div>
    );
}
