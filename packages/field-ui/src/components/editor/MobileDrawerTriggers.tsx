import { useEffect, type ReactNode } from "react";
import { m } from "../../i18n";

/**
 * `actions` has no trigger in this nav — it opens from the app bar's own
 * "More actions" button, which is where a phone user already looks for the
 * things that end a job (publish, sign, preview). Adding a fifth tab here
 * would put the terminal action in the same row as the navigation.
 */
export type MobileDrawerId = 'sections' | 'items' | 'preview' | 'theme' | 'actions';

export interface MobileDrawerTriggersProps {
    onOpen: (id: MobileDrawerId) => void;
    /** False when the host supplies no theme control: the Theme tab would open an empty drawer, so it is left out. Defaults to true. */
    showTheme?: boolean;
}

/**
 * One drawing per tab, all in the same 24px line style (2px stroke, round caps, `currentColor`).
 * They are SVG on purpose: the earlier text glyphs were drawn by whatever font the phone picked, and the eye was a
 * colour emoji, which looked unlike the plain-text marks beside it and changed from one OS to the next.
 */
const TAB_ICONS: Record<'sections' | 'items' | 'preview' | 'theme', ReactNode> = {
    sections: <path d="M4 6h16M4 12h16M4 18h16" />,
    items: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
    preview: (
        <>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
        </>
    ),
    theme: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
        </>
    ),
};

function TabIcon({ id }: { id: keyof typeof TAB_ICONS }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            {TAB_ICONS[id]}
        </svg>
    );
}

/** Mounted instances. The page mark is set by the first and removed by the last, so overlapping instances cannot clear each other's. */
let mountedNavs = 0;

/**
 * Mobile (<768px) bottom-fixed nav of three icon + label buttons that open
 * the corresponding bottom drawer. Replaces the InspectorToolsDock on
 * mobile.
 */
export function MobileDrawerTriggers({ onOpen, showTheme = true }: MobileDrawerTriggersProps) {
    // While this nav is on screen the document carries `data-mobile-nav`; theme.css lifts the floating notices
    // (`--ih-toast-bottom`) above the nav so they never cover its labels. The mark is set in an effect, so it is absent
    // until the first client commit; no floating notice exists before the person does something, so none is mispositioned.
    useEffect(() => {
        mountedNavs += 1;
        document.documentElement.setAttribute('data-mobile-nav', '');
        return () => {
            mountedNavs -= 1;
            if (mountedNavs === 0) document.documentElement.removeAttribute('data-mobile-nav');
        };
    }, []);
    return (
        <nav aria-label={m.editor_mobile_nav_label()} className="fixed left-0 right-0 bottom-0 z-30 h-[var(--ih-mobile-nav-h)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-ih-bg-card border-t border-ih-border flex">
            {([
                { id: 'sections', label: m.editor_mobile_drawer_sections(), icon: 'sections' },
                { id: 'items',    label: m.editor_mobile_drawer_items(),    icon: 'items' },
                { id: 'preview',  label: m.editor_route_drawer_preview(),  icon: 'preview' },
                { id: 'theme',    label: m.nav_theme_label(),        icon: 'theme' },
            ] as const).filter(t => showTheme || t.id !== 'theme').map(t => (
                <button
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                    className="flex-1 min-h-11 touch-manipulation flex flex-col items-center justify-center text-ih-fg-2 hover:bg-ih-bg-muted active:bg-ih-bg-muted"
                >
                    <span className="flex h-5 items-center" aria-hidden="true"><TabIcon id={t.icon} /></span>
                    <span className="text-[10px] uppercase tracking-[0.1em]">{t.label}</span>
                </button>
            ))}
        </nav>
    );
}
