import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@core/shared-ui";
import type { WizardTemplate } from "../NewInspectionWizard";
import { matchTemplates } from "~/lib/wizard-review";
import { useAnchoredDropdown } from "~/hooks/useAnchoredDropdown";
import { m } from "~/paraglide/messages";

/**
 * One control for one decision: which template this inspection is built from.
 *
 * It replaces three. A filter box appeared past six templates, a <select> held
 * the options that box narrowed, and a line under both echoed the name the
 * select was already showing — so the inspector had to understand that the top
 * field did not choose anything and the bottom line was not a choice either. A
 * fourth behaviour was invisible: narrowing the filter to a single match
 * selected that template without being asked, which meant the selection could
 * change while the inspector was still typing.
 *
 * Here, typing filters and only picking selects. The input shows the chosen
 * template's name when it is not being searched, so what the field says is what
 * will be sent.
 */
export function TemplateCombobox({
    id,
    templates,
    templateId,
    setTemplateId,
}: {
    /** Ties the caller's <label> to this control. */
    id: string;
    templates: WizardTemplate[];
    templateId: string;
    setTemplateId: (v: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [activeIdx, setActiveIdx] = useState(0);
    const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The list is portaled to <body>: the wizard body scrolls, and an `absolute`
    // list inside it was clipped to a 16px sliver.
    const { anchorRef, style } = useAnchoredDropdown<HTMLInputElement>(open);

    const selected = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId]);
    const matches = useMemo(() => matchTemplates(templates, query), [templates, query]);

    // Closed: the field states the selection. Open: it holds what is being typed.
    const displayValue = open ? query : selected?.name ?? "";

    // A retired template is LISTED, so its absence never reads as a lost
    // permission or a broken product -- and it is not selectable, because the
    // reason it was retired is that nobody may start on it any more. Both
    // halves live here: `aria-disabled` is a message to a reader, this is the
    // part that holds.
    function pick(t: WizardTemplate) {
        if (t.retiredAt) return;
        setTemplateId(t.id);
        setQuery("");
        setOpen(false);
    }

    /** Why a template left, in the reader's own language, or null. */
    function retiredNote(t: WizardTemplate): string | null {
        if (!t.retiredAt) return null;
        const date = new Date(t.retiredAt).toISOString().slice(0, 10);
        // Two reasons, two sentences: being replaced is nothing to do about,
        // while an uninstall is something an administrator can undo. One word
        // for both would tell the reader neither.
        return t.retiredReason === "uninstalled"
            ? m.statutory_template_retired_uninstalled({ date })
            : m.statutory_template_retired_superseded({ date });
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
                setOpen(true);
                return;
            }
            const delta = e.key === "ArrowDown" ? 1 : -1;
            setActiveIdx((i) => {
                if (matches.length === 0) return 0;
                return (i + delta + matches.length) % matches.length;
            });
            return;
        }
        if (e.key === "Enter") {
            // Only a deliberate pick selects. Enter on an empty match list does
            // nothing rather than clearing a valid selection.
            if (open && matches[activeIdx]) {
                e.preventDefault();
                pick(matches[activeIdx]);
            }
            return;
        }
        if (e.key === "Escape" && open) {
            setOpen(false);
            setQuery("");
        }
    }

    if (templates.length === 0) {
        return (
            <p className="text-[12px] text-ih-fg-3 px-1 py-2">{m.newinsp_property_no_templates()}</p>
        );
    }

    return (
        <div className="relative">
            <input
                ref={anchorRef}
                id={id}
                role="combobox"
                aria-expanded={open}
                aria-controls="template-combobox-list"
                aria-autocomplete="list"
                value={displayValue}
                placeholder={selected ? selected.name : m.newinsp_property_select_option()}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setActiveIdx(0);
                }}
                onFocus={() => {
                    setOpen(true);
                    setActiveIdx(0);
                }}
                onBlur={() => {
                    // Let a click on an option land before the list unmounts.
                    blurTimer.current = setTimeout(() => {
                        setOpen(false);
                        setQuery("");
                    }, 150);
                }}
                onKeyDown={onKeyDown}
                className="w-full h-9 pl-3 pr-9 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
            />
            {/* A chosen template and a half-typed word looked the same: plain
                text in a plain box. The magnifier says "type to search", and
                once something is selected it becomes the way to unselect it —
                which is also the only signal that the field holds a real
                choice rather than whatever was last typed into it. */}
            <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                {selected && !open ? (
                    <button
                        type="button"
                        aria-label={m.newinsp_property_clear_template()}
                        onClick={() => {
                            setTemplateId("");
                            setQuery("");
                        }}
                        className="p-1 rounded text-ih-fg-4 hover:text-ih-fg-2"
                    >
                        <Icon name="x" size={14} />
                    </button>
                ) : (
                    <Icon name="search" size={14} className="text-ih-fg-4" />
                )}
            </span>
            {open && style && createPortal(
                <ul
                    id="template-combobox-list"
                    role="listbox"
                    style={style}
                    className="z-50 overflow-y-auto rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover"
                >
                    {matches.length === 0 ? (
                        <li className="px-3 py-2 text-[12px] text-ih-fg-3">
                            {m.newinsp_property_no_match({ query: query.trim() })}
                        </li>
                    ) : (
                        matches.map((t, i) => {
                            const note = retiredNote(t);
                            return (
                            <li
                                key={t.id}
                                role="option"
                                aria-selected={t.id === templateId}
                                aria-disabled={note !== null ? true : undefined}
                            >
                                <button
                                    type="button"
                                    disabled={note !== null}
                                    onMouseEnter={() => setActiveIdx(i)}
                                    onMouseDown={() => {
                                        if (blurTimer.current) clearTimeout(blurTimer.current);
                                        pick(t);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-[13px] border-b border-ih-border last:border-b-0 ${
                                        note !== null
                                            ? "cursor-not-allowed opacity-60"
                                            : i === activeIdx ? "bg-ih-primary-tint" : "hover:bg-ih-bg-muted"
                                    }`}
                                >
                                    <span className={t.id === templateId ? "font-bold" : "font-medium"}>{t.name}</span>
                                    {note === null && typeof t.itemCount === "number" && (
                                        <span className="ml-2 text-[11px] text-ih-fg-3">
                                            {t.itemCount === 1
                                                ? m.newinsp_property_item_one({ count: t.itemCount })
                                                : m.newinsp_property_item_many({ count: t.itemCount })}
                                        </span>
                                    )}
                                    {note !== null && (
                                        <span className="block mt-0.5 text-[11px] text-ih-fg-3">{note}</span>
                                    )}
                                </button>
                            </li>
                            );
                        })
                    )}
                </ul>,
                document.body,
            )}
        </div>
    );
}
