import { createPortal } from "react-dom";
import { m } from "~/paraglide/messages";

export interface SuggestedContact {
    id: string;
    name: string;
    email: string | null;
}

/**
 * The dropdown under a contact typeahead. One implementation for the client and
 * the agent: both search the same contacts table through the same action, and a
 * second copy would be the one that misses the next fix.
 */
export function ContactSuggestions<T extends SuggestedContact>({
    open,
    loading,
    contacts,
    emptyLabel,
    onPick,
    style,
}: {
    open: boolean;
    loading: boolean;
    /** Undefined = no search has answered yet (so: no "none found" message). */
    contacts: T[] | undefined;
    emptyLabel: string;
    onPick: (contact: T) => void;
    /** Fixed-position placement from `useContactSearch` — see useAnchoredDropdown. */
    style: React.CSSProperties | null;
}) {
    // Portaled to <body>: the wizard body scrolls, and an absolutely-positioned
    // list inside it gets clipped by that scroll box.
    if (!open || !style) return null;
    return createPortal(
        <div
            style={style}
            className="z-50 rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover overflow-y-auto"
        >
            {loading ? (
                <p className="px-3 py-2 text-[12px] text-ih-fg-4">{m.newinsp_people_searching()}</p>
            ) : contacts && contacts.length > 0 ? (
                contacts.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        // mouseDown, not click: the input's blur handler closes this
                        // list, and click would fire after it had gone.
                        onMouseDown={() => onPick(c)}
                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-ih-bg-muted border-b border-ih-border last:border-b-0"
                    >
                        <span className="font-medium">{c.name}</span>
                        {c.email ? <span className="ml-2 text-ih-fg-4 text-[12px]">{c.email}</span> : null}
                    </button>
                ))
            ) : contacts ? (
                <p className="px-3 py-2 text-[12px] text-ih-fg-4">{emptyLabel}</p>
            ) : null}
        </div>,
        document.body,
    );
}
