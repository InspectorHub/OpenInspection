import { Icon } from "@core/shared-ui";

export interface MobileAppBarProps {
    sectionTitle: string;
    itemLabel:    string;
    onBack:       () => void;
    onMore:       () => void;
}

/**
 * Mobile (<768px) top app bar — replaces the desktop header chrome with a
 * compact 12px-tall bar showing section + item context plus back/more
 * affordances.
 */
export function MobileAppBar({ sectionTitle, itemLabel, onBack, onMore }: MobileAppBarProps) {
    return (
        <header className="sticky top-0 z-30 h-12 bg-ih-bg-card border-b border-ih-border flex items-center px-2 gap-2">
            <button
                onClick={onBack}
                className="w-10 h-10 flex items-center justify-center text-ih-fg-2 hover:bg-ih-bg-muted rounded"
                aria-label="Back"
            ><Icon name="back" size={18} /></button>
            <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-4 truncate">{sectionTitle}</div>
                <div className="text-[13px] font-bold truncate">{itemLabel}</div>
            </div>
            <button
                onClick={onMore}
                className="w-10 h-10 flex items-center justify-center text-ih-fg-2 hover:bg-ih-bg-muted rounded"
                aria-label="More actions"
            >⋮</button>
        </header>
    );
}
