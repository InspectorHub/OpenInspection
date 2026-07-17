import { useEffect } from 'react';
import { Button } from '@core/shared-ui';
import { m } from "~/paraglide/messages";

export interface SpeedModeUndoToastProps {
    /** Null = hide */
    pending: {
        message: string;
        onUndo:  () => void;
    } | null;
    onDismiss:   () => void;
    durationMs?: number;
}

/**
 * Speed Mode rating-tap Undo toast. Auto-dismisses after `durationMs` (default
 * 3 s). Tapping [Undo] fires the captured revert and dismisses immediately.
 * Sits above the bottom mobile trigger bar (bottom-20).
 */
export function SpeedModeUndoToast({ pending, onDismiss, durationMs = 3000 }: SpeedModeUndoToastProps) {
    useEffect(() => {
        if (!pending) return;
        const t = setTimeout(onDismiss, durationMs);
        return () => clearTimeout(t);
    }, [pending, onDismiss, durationMs]);

    if (!pending) return null;
    return (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-20 z-50 px-4 py-2.5 bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover flex items-center gap-3 text-[13px]">
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
