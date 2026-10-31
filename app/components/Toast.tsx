import { useToastQueue } from '../hooks/useToast';

/**
 * The stack sits at `--ih-toast-bottom`, which defaults to 1rem. A page with a fixed bottom bar (the phone editor's nav)
 * marks the document and the stylesheet raises the variable above that bar and the safe-area inset, so notices never
 * cover its labels. Desktop has no such bar and keeps the default.
 *
 * The stack and its notices let taps through to what is under them (a retry control in a dialog that stays open after a
 * refusal must stay reachable); only a notice's action button takes them.
 *
 * z-[110] puts a notice above the full-screen studio overlays (the cropper at z-70, the annotator and speed mode at
 * z-100): at z-50 a refusal raised while one of them stays open was in the DOM but hidden under it.
 */
export function ToastPortal() {
    const queue = useToastQueue();
    if (queue.length === 0) return null;
    return (
        <div className="fixed bottom-[var(--ih-toast-bottom,1rem)] left-1/2 -translate-x-1/2 z-[110] flex flex-col gap-2 pointer-events-none">
            {queue.map(t => (
                <div key={t.id} role={t.variant === 'error' ? 'alert' : 'status'} aria-atomic="true" className={`bg-ih-bg-card text-ih-fg-1 border border-ih-border rounded-lg shadow-ih-popover px-4 py-2 text-[13px] flex items-center gap-3 min-w-[260px] pointer-events-none${
                    t.variant === 'error' ? ' border-l-4 border-l-ih-bad'
                    : t.variant === 'warning' ? ' border-l-4 border-l-ih-watch'
                    : t.variant === 'success' ? ' border-l-4 border-l-ih-ok'
                    : ''
                }`}>
                    {t.variant === 'error' && <span aria-hidden className="text-ih-bad font-bold">!</span>}
                    {t.variant === 'warning' && <span aria-hidden className="text-ih-watch-fg font-bold">!</span>}
                    <span className="flex-1">{t.message}</span>
                    {t.actionLabel && t.onAction && (
                        <button
                            onClick={() => t.onAction?.()}
                            className="pointer-events-auto text-[12px] font-bold text-ih-primary-text hover:opacity-80"
                        >
                            {t.actionLabel}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
