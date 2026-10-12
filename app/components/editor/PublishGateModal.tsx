import { Icon, Button, Modal } from '@core/shared-ui';
import type { PublishReadiness, PublishBlockingDefect } from '../../lib/types';
import { m } from '~/paraglide/messages';

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
                        <div className="text-[11px] uppercase tracking-[0.1em] text-ih-fg-3">
                            {b.sectionTitle} &rsaquo; {b.itemLabel}
                        </div>
                        <div className="text-[13px] font-bold">{b.cannedTitle}</div>
                        <div className="mt-1 text-[12px] text-ih-fg-3">
                            {m.editor_gate_missing()}{b.missing.length === 0 ? <em>{m.editor_gate_none()}</em> : b.missing.join(', ')}
                            {b.unresolvedTokens.length > 0 && (
                                <>{m.editor_gate_unresolved()}{b.unresolvedTokens.map(t => `{{${t}}}`).join(', ')}</>
                            )}
                        </div>
                    </div>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onJump(b)}
                    >
                        {m.editor_gate_jump()} <Icon name="arrowR" size={13} />
                    </Button>
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
    const title = warningOnly
        ? (warnings.length === 1 ? m.editor_gate_warn_title_one({ count: warnings.length }) : m.editor_gate_warn_title_other({ count: warnings.length }))
        : (blocking.length === 1 ? m.editor_gate_block_title_one({ count: blocking.length }) : m.editor_gate_block_title_other({ count: blocking.length }));
    // Shared Modal owns Escape, Tab trap, scroll lock and focus return; the close
    // button and the footer both route to the same onClose.
    return (
        <Modal
            open
            onClose={onClose}
            title={title}
            size="xl"
            footer={(
                <>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {warningOnly ? m.common_cancel() : m.common_close()}
                    </Button>
                    {warningOnly && onProceed && (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={onProceed}
                            data-testid="publish-anyway"
                        >
                            {m.editor_gate_publish_anyway()}
                        </Button>
                    )}
                </>
            )}
        >
            <div className="-m-4">
                {blocking.length > 0 && <DefectList entries={blocking} onJump={onJump} tone="blocking" />}
                {warnings.length > 0 && (
                    <>
                        <div className="px-5 py-2 bg-ih-watch-bg text-ih-watch-fg text-[11px] font-bold uppercase tracking-[0.1em] border-y border-ih-border">
                            {m.editor_gate_warnings_banner()}
                        </div>
                        <DefectList entries={warnings} onJump={onJump} tone="warning" />
                    </>
                )}
            </div>
        </Modal>
    );
}
