import type { PublishReadiness, PublishBlockingDefect } from '../../lib/types';

export interface PublishGateModalProps {
    open: boolean;
    readiness: PublishReadiness | null;
    onClose: () => void;
    onJump: (b: PublishBlockingDefect) => void;
}

export function PublishGateModal({ open, readiness, onClose, onJump }: PublishGateModalProps) {
    if (!open || !readiness || readiness.ready) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
            <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-2xl max-h-[80vh] flex flex-col">
                <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
                    <h2 className="text-[14px] font-bold">
                        Cannot publish &mdash; {readiness.blockingDefects.length} defect{readiness.blockingDefects.length === 1 ? '' : 's'} need attention
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
                        aria-label="Close"
                    >
                        &#x2715;
                    </button>
                </div>
                <ul className="flex-1 overflow-y-auto divide-y divide-ih-border">
                    {readiness.blockingDefects.map((b, i) => (
                        <li key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-ih-bg-muted">
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] uppercase tracking-[0.1em] text-ih-fg-4">
                                    {b.sectionTitle} &rsaquo; {b.itemLabel}
                                </div>
                                <div className="text-[13px] font-bold">{b.cannedTitle}</div>
                                <div className="mt-1 text-[12px] text-ih-fg-3">
                                    Missing: {b.missing.length === 0 ? <em>(none)</em> : b.missing.join(', ')}
                                    {b.unresolvedTokens.length > 0 && (
                                        <> &middot; Unresolved tokens: {b.unresolvedTokens.map(t => `{{${t}}}`).join(', ')}</>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => onJump(b)}
                                className="px-3 py-1 rounded bg-ih-primary text-white text-[12px] font-bold hover:opacity-90"
                            >
                                Jump &rarr;
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="px-5 py-3 border-t border-ih-border text-right">
                    <button onClick={onClose} className="px-3 py-1 rounded border border-ih-border text-[12px]">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
