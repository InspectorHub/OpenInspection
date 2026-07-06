import { useEffect } from 'react';

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
 * Escape close, scroll-lock while open, slides up via translate. Three
 * editor drawers (Sections / Items / Preview) share this primitive.
 */
export function MobileBottomDrawer({ open, onClose, title, children, heightFraction = 0.7 }: MobileBottomDrawerProps) {
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', fn);
        return () => document.removeEventListener('keydown', fn);
    }, [open, onClose]);

    return (
        <>
            <div
                onClick={onClose}
                className={`fixed inset-0 z-40 bg-ih-backdrop transition-opacity ${
                    open ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`fixed left-0 right-0 bottom-0 z-50 bg-ih-bg-card rounded-t-2xl shadow-ih-popover flex flex-col transition-transform ${
                    open ? 'translate-y-0' : 'translate-y-full'
                }`}
                style={{ height: `${Math.round(heightFraction * 100)}vh` }}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <div className="w-10 h-1 rounded-full bg-ih-border" />
                </div>
                {title && (
                    <div className="px-4 pb-2 text-[14px] font-bold text-ih-fg-1 border-b border-ih-border">
                        {title}
                    </div>
                )}
                <div className="flex-1 overflow-y-auto">{children}</div>
            </div>
        </>
    );
}
