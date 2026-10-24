import { useEffect, useRef } from 'react';
import { Button } from '@core/shared-ui';
import { m } from "../../i18n";

export interface SpeedModeUndoToastProps {
    /** Null = hide */
    pending: {
        message: string;
        onUndo:  () => void;
    } | null;
    onDismiss:   () => void;
    durationMs?: number;
    /**
     * `floating` (default) is the fixed toast above the bottom bar. `inline` sits in the page flow, so on a touch
     * layout it takes its own row above the rating tiles instead of covering them: a tap meant for a tile can
     * never land on Undo.
     */
    placement?:  'floating' | 'inline';
}

const BOX = "px-4 py-2.5 bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover flex items-center gap-3 text-[13px]";

/**
 * Speed Mode rating-tap Undo toast. Auto-dismisses after `durationMs` (default
 * 3 s). Tapping [Undo] fires the captured revert and dismisses immediately.
 * Floating, it sits above the bottom mobile trigger bar (bottom-20).
 */
export function SpeedModeUndoToast({ pending, onDismiss, durationMs = 3000, placement = 'floating' }: SpeedModeUndoToastProps) {
    // The parent hands a new function on every render; the timer must not restart each time it re-renders.
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;
    useEffect(() => {
        if (!pending) return;
        const t = setTimeout(() => dismissRef.current(), durationMs);
        return () => clearTimeout(t);
    }, [pending, durationMs]);

    if (!pending) return null;
    return (
        <div className={placement === 'inline' ? `mx-auto mb-2 shrink-0 max-w-[calc(100%-2rem)] ${BOX}` : `fixed left-1/2 -translate-x-1/2 bottom-20 z-50 ${BOX}`}>
            <span>{pending.message}</span>
            <Button
                variant="link"
                size="sm"
                onClick={() => { pending.onUndo(); onDismiss(); }}
                className="px-2 py-1 hover:bg-ih-bg-muted rounded"
            >
                {m.common_undo()}
            </Button>
        </div>
    );
}
