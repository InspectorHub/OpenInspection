import { useRef } from 'react';
import { useDialogBehavior } from '@core/shared-ui';
import { m } from '../i18n';

export interface MobileBottomDrawerProps {
    open:    boolean;
    onClose: () => void;
    title?:  string;
    children: React.ReactNode;
    /** Drawer covers this fraction of viewport height. Default 0.7. */
    heightFraction?: number;
}

/**
 * Generic bottom-sheet primitive for the mobile layout: backdrop click +
 * Escape close, scroll-lock, Tab trap, initial focus and focus return while open,
 * slides up via translate. Three
 * editor drawers (Sections / Items / Preview) share this primitive.
 */
export function MobileBottomDrawer({ open, onClose, title, children, heightFraction = 0.7 }: MobileBottomDrawerProps) {
    const sheetRef = useRef<HTMLDivElement>(null);
    useDialogBehavior(open, onClose, sheetRef);

    return (
        <>
            <div
                onClick={onClose}
                className={`fixed inset-x-0 top-0 bottom-[var(--keyboard-height,0px)] z-40 bg-ih-backdrop transition-opacity ${
                    open ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
            />
            <div
                ref={sheetRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                // Closed, the sheet is only parked below the viewport: keep it out of the tab order and the accessibility tree.
                inert={!open}
                aria-hidden={open ? undefined : true}
                className={`fixed left-0 right-0 bottom-[var(--keyboard-height,0px)] z-50 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-ih-bg-card rounded-t-2xl flex flex-col outline-none transition-transform ${
                    open ? 'translate-y-0 shadow-ih-popover' : 'translate-y-full'
                }`}
                // `vh` first, then `dvh` as a cap: a browser without dynamic viewport units ignores the cap and keeps the `vh`
                // height, and one with them stops the sheet from reaching under the mobile browser's address bar.
                style={{ height: `${Math.round(heightFraction * 100)}vh`, maxHeight: `min(${Math.round(heightFraction * 100)}dvh, calc(100dvh - var(--keyboard-height, 0px) - env(safe-area-inset-top, 0px)))` }}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <div className="w-10 h-1 rounded-full bg-ih-border" />
                </div>
                {/* A sheet always has a worded way out: iOS has no back key, and the backdrop is easy to miss under a tall sheet. */}
                <div className="flex items-center justify-between pl-4 pr-1 border-b border-ih-border">
                    <span className="text-[14px] font-bold text-ih-fg-1">{title}</span>
                    <button type="button" onClick={onClose} className="min-h-11 min-w-11 px-3 text-[14px] font-semibold text-ih-primary-text touch-manipulation">
                        {m.common_close()}
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
            </div>
        </>
    );
}
