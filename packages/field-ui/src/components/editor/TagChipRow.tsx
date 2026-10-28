import { useMemo } from 'react';
import { Button } from '@core/shared-ui';
import { m } from "../../i18n";
import { readableTextOn, safeCssColor } from "../../lib/readable-text";

export interface TagPin {
    id:    string;
    name:  string;
    color: string;
}

export interface TagChipRowProps {
    /** Resolved tag rows from the library, in pin order (max 5 shown). */
    pinnedTags:   TagPin[];
    /** Tag ids currently linked to the active item. */
    activeTagIds: Set<string>;
    /**
     * Every tag on the active item. The ones that are not pinned (chosen from the full list) are shown after the
     * pinned ones, and are not cut to five, so every tag on the item is visible and can be taken off again.
     */
    chosenTags?:  Array<{ id: string; name: string; color?: string }>;
    onToggle:     (tag: TagPin) => void;
    /**
     * Opens the full tag list. Without it a phone has no way to reach that list (its only other trigger is the T key),
     * so the row offers it even when no tag is pinned.
     */
    onOpenLibrary?: () => void;
}

/** A finger-sized target on a coarse pointer (a phone, a tablet): 36px tall with room between chips; a mouse keeps the compact chip. */
const COARSE = "[@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:text-xs";

/**
 * Workflow shortcuts PR — inline 1-click chip row showing up to 5 tenant-
 * pinned tags below the Notes field. The full library (T-hotkey modal)
 * stays for everything else.
 */
export function TagChipRow({ pinnedTags, chosenTags, activeTagIds, onToggle, onOpenLibrary }: TagChipRowProps) {
    const sorted = useMemo<TagPin[]>(() => {
        const pinned = pinnedTags.slice(0, 5);
        const shown = new Set(pinned.map(t => t.id));
        const unpinned = (chosenTags ?? []).filter(t => !shown.has(t.id)).map(t => ({ ...t, color: t.color ?? "" }));
        return [...pinned, ...unpinned];
    }, [pinnedTags, chosenTags]);
    if (sorted.length === 0 && !onOpenLibrary) return null;
    return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 [@media(pointer:coarse)]:gap-2">
            {sorted.map(tag => {
                const active = activeTagIds.has(tag.id);
                const colour = safeCssColor(tag.color);
                return (
                    <button
                        key={tag.id}
                        onClick={() => onToggle(tag)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold transition-colors border ${COARSE} ${
                            active
                                ? `${colour ? 'text-white' : 'bg-ih-bg-muted text-ih-fg-1'} border-transparent`
                                : 'text-ih-fg-3 border-ih-border bg-transparent hover:bg-ih-bg-muted'
                        }`}
                        style={active && colour ? { backgroundColor: colour, color: readableTextOn(colour) ?? undefined } : {}}
                    >
                        {tag.name}
                    </button>
                );
            })}
            {onOpenLibrary && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onOpenLibrary}
                    className={`h-auto px-2 py-0.5 rounded-full border border-dashed border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted ${COARSE}`}
                    aria-label={m.editor_tagchiprow_open_library_aria()}
                >
                    {m.editor_tagchiprow_more()}
                </Button>
            )}
        </div>
    );
}
