import { useToastQueue } from '../hooks/useToast';

export function ToastPortal() {
    const queue = useToastQueue();
    if (queue.length === 0) return null;
    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
            {queue.map(t => (
                <div key={t.id} className="bg-ih-bg-card text-ih-fg-1 border border-ih-border rounded-lg shadow-lg px-4 py-2 text-[13px] flex items-center gap-3 min-w-[260px]">
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
