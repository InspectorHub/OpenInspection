import { Icon, IconButton } from "@core/shared-ui";
import { m } from "../../i18n";

/** Which host the editor runs in: the web app, or the native shell on iOS or Android. */
type AppBarPlatform = "web" | "ios" | "android";

export interface AppBarProps {
    platform: AppBarPlatform;
    sectionTitle: string;
    itemLabel: string;
    /** Back out one level: item to list, list to the host (through `exit()`, so the unsaved-changes guard still runs). */
    onBack: () => void;
    onMore: () => void;
    /** The tablet layout: a 56px bar with a Sections button before the title and a slot for actions after it. */
    tablet?: boolean;
    /** Tablet: opens the Sections drawer. The button is left out when this is absent. */
    onOpenSections?: () => void;
    /** Tablet: controls between the title and More (Preview, Publish). */
    actions?: React.ReactNode;
    /** Beside the title: the save indicator. Left out when absent. */
    status?: React.ReactNode;
}

const BTN = "w-11 h-11 touch-manipulation";

// Full class strings, because Tailwind reads literals. Native bars add the top inset to the same visible height.
const HEIGHT = {
    phone: { web: "h-12", native: "pt-[env(safe-area-inset-top)] h-[calc(3rem+env(safe-area-inset-top))]" },
    tablet: {
        web: "h-14 [@media(max-height:499px)]:h-12",
        native: "pt-[env(safe-area-inset-top)] h-[calc(3.5rem+env(safe-area-inset-top))] [@media(max-height:499px)]:h-[calc(3rem+env(safe-area-inset-top))]",
    },
} as const;

function BackGlyph({ platform }: { platform: AppBarPlatform }) {
    if (platform === "ios") {
        return <span data-testid="app-bar-back-icon" data-glyph="chevron-left" className="inline-flex"><Icon name="chevL" size={24} /></span>;
    }
    return <span data-testid="app-bar-back-icon" data-glyph={platform === "android" ? "arrow-left" : "back"} className="inline-flex"><Icon name="back" size={18} /></span>;
}

function MoreGlyph({ platform }: { platform: AppBarPlatform }) {
    if (platform === "web") return <>⋮</>;
    const vertical = platform === "android";
    return (
        <svg data-testid="app-bar-more-icon" data-orientation={vertical ? "vertical" : "horizontal"} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {vertical
                ? <><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></>
                : <><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></>}
        </svg>
    );
}

/**
 * The editor's top bar on the phone and tablet layouts.
 *
 * `web` is the bar the phone has always had (section above the item, back arrow, a vertical-dots glyph). `ios` puts a
 * centred title (item over section), a chevron back and a horizontal ellipsis; `android` a left-aligned title, an
 * arrow back and a vertical ellipsis. Native bars reserve the top safe-area inset (the host sets `viewport-fit=cover`
 * and owns the status bar) without changing the visible height. Every control is a 44px target.
 */
export function AppBar({ platform, sectionTitle, itemLabel, onBack, onMore, tablet = false, onOpenSections, actions, status }: AppBarProps) {
    const native = platform !== "web";
    const height = HEIGHT[tablet ? "tablet" : "phone"][native ? "native" : "web"];
    let title: React.ReactNode;
    if (platform === "web") {
        title = (
            <div data-testid="app-bar-title" className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-3 truncate">{sectionTitle}</div>
                <div className="text-[13px] font-bold truncate">{itemLabel}</div>
            </div>
        );
    } else {
        const ios = platform === "ios";
        title = (
            <div data-testid="app-bar-title" className={`flex-1 min-w-0 ${ios ? "text-center" : "text-left"}`}>
                <div className={`${ios ? "text-[15px] font-semibold" : "text-[16px] font-medium"} text-ih-fg-1 truncate`}>{itemLabel}</div>
                <div className="text-[11px] text-ih-fg-3 truncate">{sectionTitle}</div>
            </div>
        );
    }
    return (
        <header
            data-platform={platform}
            className={`sticky top-0 z-30 ${height} bg-ih-bg-card border-b border-ih-border flex items-center pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] gap-2`}
        >
            <IconButton onClick={onBack} className={BTN} aria-label={m.common_back()}>
                <BackGlyph platform={platform} />
            </IconButton>
            {tablet && onOpenSections && (
                <IconButton onClick={onOpenSections} className={BTN} aria-label={m.editor_mobile_drawer_sections()}>☰</IconButton>
            )}
            {title}
            {status && <div data-testid="app-bar-status" className="shrink-0">{status}</div>}
            {actions}
            <IconButton onClick={onMore} className={BTN} aria-label={m.editor_mobile_more()}>
                <MoreGlyph platform={platform} />
            </IconButton>
        </header>
    );
}
