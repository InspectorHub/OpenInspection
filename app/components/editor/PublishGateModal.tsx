import { Icon } from '@core/shared-ui';
import type { PublishReadiness, PublishBlockingDefect } from '../../lib/types';

export interface PublishGateModalProps {
    open: boolean;
    readiness: PublishReadiness | null;
    onClose: () => void;
    onJump: (b: PublishBlockingDefect) => void;
    /** IA-7 warning mode — called by "Publish anyway" when nothing blocks
     *  but soft gaps exist. Omitting it hides the button. */
    onProceed?: () => void;
}

function DefectList({ entries, onJump, tone }: {
    entries: PublishBlockingDefect[];
    onJump: (b: PublishBlockingDefect) => void;
    tone: 'blocking' | 'warning';
}) {
    return (
        <ul className="divide-y divide-ih-border">
            {entries.map((b, i) => (
                <li key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-ih-bg-muted">
                    <span
                        aria-hidden="true"
                        className={`mt-1 inline-block w-2 h-2 rounded-full shrink-0 ${tone === 'blocking' ? 'bg-ih-bad-fg' : 'bg-ih-watch-fg'}`}
                    />
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
                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-ih-primary text-white text-[12px] font-bold hover:opacity-90"
                    >
                        Jump <Icon name="arrowR" size={13} />
                    </button>
                </li>
            ))}
        </ul>
    );
}

export function PublishGateModal({ open, readiness, onClose, onJump, onProceed }: PublishGateModalProps) {
    if (!open || !readiness) return null;
    const warnings = readiness.warningDefects ?? [];
    const blocking = readiness.blockingDefects;
    // IA-7: ready + warnings = soft gate ("Publish anyway" allowed);
    // !ready = hard gate, warnings (if any) listed beneath the blockers.
    const warningOnly = readiness.ready && warnings.length > 0;
    if (readiness.ready && warnings.length === 0) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ih-backdrop">
            <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-2xl max-h-[80vh] flex flex-col">
                <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
                    <h2 className="text-[14px] font-bold">
                        {warningOnly
                            ? <>Publish with warnings? &mdash; {warnings.length} defect{warnings.length === 1 ? '' : 's'} incomplete</>
                            : <>Cannot publish &mdash; {blocking.length} defect{blocking.length === 1 ? '' : 's'} need attention</>}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
                        aria-label="Close"
                    >
                        &#x2715;
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {blocking.length > 0 && <DefectList entries={blocking} onJump={onJump} tone="blocking" />}
                    {warnings.length > 0 && (
                        <>
                            <div className="px-5 py-2 bg-ih-watch-bg text-ih-watch-fg text-[11px] font-bold uppercase tracking-[0.1em] border-y border-ih-border">
                                Warnings — won&apos;t block publishing
                            </div>
                            <DefectList entries={warnings} onJump={onJump} tone="warning" />
                        </>
                    )}
                </div>
                <div className="px-5 py-3 border-t border-ih-border flex items-center justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1 rounded border border-ih-border text-[12px]">
                        {warningOnly ? 'Cancel' : 'Close'}
                    </button>
                    {warningOnly && onProceed && (
                        <button
                            onClick={onProceed}
                            className="px-3 py-1 rounded bg-ih-primary text-white text-[12px] font-bold hover:opacity-90"
                            data-testid="publish-anyway"
                        >
                            Publish anyway
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
