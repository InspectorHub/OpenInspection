/**
 * Design System 0520 — M15 InspectorTools FAB dock (subsystem A, phase 5).
 *
 * Right-bottom floating action button that consolidates four mouse-driven
 * entry points for editor tools. Hot keys remain authoritative; the dock
 * is purely a discoverability surface.
 *
 * Mounted inside the inspectionEditor x-data scope so tiles can call the
 * factory's methods directly (toggleSpeedMode, toggleCheatsheet) without
 * dispatching to a sibling component.
 *
 * Tiles:
 *   Speed mode  (Z)        — toggleSpeedMode()
 *   Burst camera           — dispatches `burst-camera:open` with activeItemId
 *   Photo studio           — dispatches `open-photo-studio` (off when no
 *                            active photo selected; tile shows a hint toast)
 *   Shortcuts   (?)        — toggleCheatsheet()
 *
 * FAB hidden while SpeedMode or PhotoStudio overlay is active (no
 * overlapping floats).
 */

interface DockTile {
    id:         string;
    label:      string;
    /** Heroicons-outline path data — rendered inside a 24-viewBox SVG with
     *  stroke=2 / linecap+linejoin=round / fill=none / stroke=currentColor. */
    iconPath:   string;
    hotkey?:    string;
    /** Inline Alpine expression invoked on click. Closes the dock too. */
    action:     string;
    /** Optional Alpine expression to disable the tile. */
    disabledIf?: string;
}

const TILES: DockTile[] = [
    {
        id:       'speed-mode',
        label:    'Speed mode',
        iconPath: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
        hotkey:   'Z',
        action:   'toggleSpeedMode(); dockOpen = false',
    },
    {
        id:       'burst-camera',
        label:    'Burst camera',
        iconPath: 'M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z',
        action:   `if (activeItemId) { $dispatch('burst-camera:open', { itemId: activeItemId }); dockOpen = false } else if (typeof showToast === 'function') { showToast('Select an item first to start a camera burst'); }`,
    },
    {
        id:       'photo-studio',
        label:    'Photo studio',
        iconPath: 'M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42',
        action:   `if (typeof showToast === 'function') showToast('Tap any photo to annotate'); dockOpen = false`,
    },
    {
        id:       'shortcuts',
        label:    'Shortcuts',
        iconPath: 'M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122',
        hotkey:   '?',
        action:   'toggleCheatsheet(); dockOpen = false',
    },
];

export function InspectorToolsDock(): JSX.Element {
    return (
        <div
            x-show="!speedMode && !(window.__oiPhotoStudioOpen || false)"
            class="fixed bottom-6 right-6 z-40"
            {...{ 'x-on:keydown.escape.window': 'dockOpen = false' }}
        >
            {/* Backdrop (click-outside closes the dock) */}
            <div
                x-show="dockOpen"
                x-cloak
                class="fixed inset-0 z-[-1]"
                x-on:click="dockOpen = false"
                aria-hidden="true"
            />

            {/* Dock panel */}
            <div
                x-show="dockOpen"
                x-cloak
                {...{ 'x-transition.scale.origin.bottom.right.duration.200ms': '' }}
                class="absolute bottom-16 right-0 mb-2 ih-card p-2 min-w-[200px]"
                role="menu"
                aria-label="Inspector tools"
            >
                {TILES.map(t => (
                    <button
                        type="button"
                        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-100"
                        x-on:click={t.action}
                        role="menuitem"
                        key={t.id}
                    >
                        <svg aria-hidden="true" class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                            <path d={t.iconPath} />
                        </svg>
                        <span class="flex-1 text-left text-sm">{t.label}</span>
                        {t.hotkey && <span class="ih-kbd">{t.hotkey}</span>}
                    </button>
                ))}
            </div>

            {/* FAB itself — uses the spec'd brand gradient (#6366F1 → #4F46E5
                via the indigo-500/600 Tailwind aliases) and a plus icon that
                rotates 45° into an X when open. */}
            <button
                type="button"
                class="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg flex items-center justify-center text-white active:scale-95 transition-transform"
                x-on:click="dockOpen = !dockOpen"
                aria-label="Open inspector tools"
                x-bind:aria-expanded="dockOpen"
            >
                <svg aria-hidden="true" class="w-6 h-6 transition-transform duration-150" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" x-bind:style="dockOpen ? 'transform: rotate(45deg)' : ''">
                    <path d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
            </button>
        </div>
    );
}
