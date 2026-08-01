import { m } from "~/paraglide/messages";

/**
 * `actions` has no trigger in this nav — it opens from the app bar's own
 * "More actions" button, which is where a phone user already looks for the
 * things that end a job (publish, sign, preview). Adding a fifth tab here
 * would put the terminal action in the same row as the navigation.
 */
export type MobileDrawerId = 'sections' | 'items' | 'preview' | 'theme' | 'actions';

export interface MobileDrawerTriggersProps {
    onOpen: (id: MobileDrawerId) => void;
}

/**
 * Mobile (<768px) bottom-fixed nav of three icon + label buttons that open
 * the corresponding bottom drawer. Replaces the InspectorToolsDock on
 * mobile.
 */
export function MobileDrawerTriggers({ onOpen }: MobileDrawerTriggersProps) {
    return (
        <nav className="fixed left-0 right-0 bottom-0 z-30 h-14 bg-ih-bg-card border-t border-ih-border flex">
            {([
                { id: 'sections', label: m.editor_mobile_drawer_sections(), icon: '☰' },
                { id: 'items',    label: m.editor_mobile_drawer_items(),    icon: '≣' },
                { id: 'preview',  label: m.editor_route_drawer_preview(),  icon: '👁' },
                { id: 'theme',    label: m.nav_theme_label(),        icon: '◐' },
            ] as const).map(t => (
                <button
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                    className="flex-1 flex flex-col items-center justify-center text-ih-fg-2 hover:bg-ih-bg-muted active:bg-ih-bg-muted"
                >
                    <span className="text-[16px]">{t.icon}</span>
                    <span className="text-[10px] uppercase tracking-[0.1em]">{t.label}</span>
                </button>
            ))}
        </nav>
    );
}
