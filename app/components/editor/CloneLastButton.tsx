import { useState, useRef, useEffect } from 'react';
import { Button, MenuItem } from '@core/shared-ui';
import { m } from '~/paraglide/messages';

export type CloneScope = 'rating' | 'rating_notes' | 'all';

export interface CloneLastButtonProps {
    defaultScope: CloneScope;
    onClone:      (scope: CloneScope) => void;
    disabled?:    boolean;
}

/**
 * Workflow shortcuts PR — replaces the over-eager R-key `repeatPreviousRating`
 * (which copied photos/tags) with an explicit-scope clone button + dropdown.
 * The session scope starts at `defaultScope` (tenant config) and persists for
 * this mount only — settings changes propagate via the defaultScope prop.
 */
export function CloneLastButton({ defaultScope, onClone, disabled }: CloneLastButtonProps) {
    const [open, setOpen] = useState(false);
    const [sessionScope, setSessionScope] = useState<CloneScope>(defaultScope);
    const ref = useRef<HTMLDivElement>(null);

    // Built in render so the message functions resolve per-render (never frozen
    // at import).
    const SCOPE_LABELS: Record<CloneScope, string> = {
        rating:       m.editor_clone_scope_rating(),
        rating_notes: m.editor_clone_scope_rating_notes(),
        all:          m.editor_clone_scope_all(),
    };

    useEffect(() => { setSessionScope(defaultScope); }, [defaultScope]);

    useEffect(() => {
        if (!open) return;
        const fn = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', fn);
        return () => document.removeEventListener('mousedown', fn);
    }, [open]);

    const pick = (scope: CloneScope) => {
        setSessionScope(scope);
        setOpen(false);
        onClone(scope);
    };

    return (
        <div ref={ref} className="relative inline-block">
            <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {m.editor_clone_last()}
                <span className="text-[10px]">▾</span>
            </Button>
            {open && (
                <div role="menu" className="absolute z-10 mt-1 min-w-[160px] bg-ih-bg-card border border-ih-border rounded shadow-ih-popover py-1">
                    {(['rating', 'rating_notes', 'all'] as const).map(s => (
                        <MenuItem
                            key={s}
                            onClick={() => pick(s)}
                        >
                            <span className={`w-3 inline-block ${s === sessionScope ? 'text-ih-primary' : 'text-transparent'}`}>✓</span>
                            {SCOPE_LABELS[s]}
                        </MenuItem>
                    ))}
                </div>
            )}
        </div>
    );
}
