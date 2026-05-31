import { useMemo } from 'react';

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
    onToggle:     (tag: TagPin) => void;
    /** Optional click handler for the "+ more" button — typically opens the full T-hotkey modal. */
    onOpenLibrary?: () => void;
}

/**
 * Workflow shortcuts PR — inline 1-click chip row showing up to 5 tenant-
 * pinned tags below the Notes field. The full library (T-hotkey modal)
 * stays for everything else.
 */
export function TagChipRow({ pinnedTags, activeTagIds, onToggle, onOpenLibrary }: TagChipRowProps) {
    const sorted = useMemo(() => pinnedTags.slice(0, 5), [pinnedTags]);
    if (sorted.length === 0) return null;
    return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {sorted.map(tag => {
                const active = activeTagIds.has(tag.id);
                return (
                    <button
                        key={tag.id}
                        onClick={() => onToggle(tag)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold transition-colors border ${
                            active
                                ? 'text-white border-transparent'
                                : 'text-ih-fg-3 border-ih-border bg-transparent hover:bg-ih-bg-muted'
                        }`}
                        style={active ? { backgroundColor: tag.color } : {}}
                    >
                        {tag.name}
                    </button>
                );
            })}
            {onOpenLibrary && (
                <button
                    onClick={onOpenLibrary}
                    className="px-2 py-0.5 rounded-full text-[11px] font-bold text-ih-fg-4 border border-dashed border-ih-border hover:bg-ih-bg-muted"
                    aria-label="Open tag library"
                >
                    + more
                </button>
            )}
        </div>
    );
}
