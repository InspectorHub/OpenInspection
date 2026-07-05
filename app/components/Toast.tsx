import { useToastQueue } from '../hooks/useToast';

export function ToastPortal() {
    const queue = useToastQueue();
    if (queue.length === 0) return null;
    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
            {queue.map(t => (
                <div key={t.id} role={t.variant === 'error' ? 'alert' : 'status'} aria-atomic="true" className={`bg-ih-bg-card text-ih-fg-1 border border-ih-border rounded-lg shadow-ih-popover px-4 py-2 text-[13px] flex items-center gap-3 min-w-[260px]${
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
                            className="text-[12px] font-bold text-ih-primary hover:opacity-80"
                        >
                            {t.actionLabel}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
