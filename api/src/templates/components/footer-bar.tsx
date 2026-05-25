/**
 * Design System 0520 subsystem B phase 4 task 4.4 — FooterBar.
 *
 * Sticky bottom strip on the inspection editor. Mirrors the design's
 * FooterBar:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ [1]-[5] rate · [J][K] nav · [/] snippet · [P] photo · [V] voice …   │
 *   │                                       [○ Solo]  [● Synced 4 s ago]  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Keyboard hints are always visible (the editor is keyboard-first); the
 * sync chip on the right shows live state from window.OfflineQueue.
 */

export function FooterBar(): JSX.Element {
    return (
        <div
            x-data="footerBar"
            class="fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pl-4 pr-24 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3 flex-nowrap overflow-hidden"
            role="contentinfo"
            aria-label="Editor shortcuts and sync status"
        >
            {/* Gap 9 — ? Shortcuts popover replaces inline hints. */}
            <div x-data="{ shortcutsOpen: false }" class="relative">
                <button
                    type="button"
                    {...{ 'x-on:click': 'shortcutsOpen = !shortcutsOpen' }}
                    class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-bold text-[10px] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                    <kbd class="ih-kbd">?</kbd> Shortcuts
                </button>
                <div
                    x-show="shortcutsOpen"
                    x-cloak
                    {...{ 'x-on:click.outside': 'shortcutsOpen = false', 'x-on:keydown.escape.window': 'shortcutsOpen = false' }}
                    class="absolute bottom-full left-0 mb-2 w-[320px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 p-3"
                >
                    <h4 class="ih-eyebrow mb-2">Keyboard shortcuts</h4>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">1</kbd>-<kbd class="ih-kbd">5</kbd> <span class="text-slate-600 dark:text-slate-300">Rate item</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">J</kbd> / <kbd class="ih-kbd">K</kbd> <span class="text-slate-600 dark:text-slate-300">Next / Prev</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">/</kbd> <span class="text-slate-600 dark:text-slate-300">Open library</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">P</kbd> <span class="text-slate-600 dark:text-slate-300">Capture photo</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">V</kbd> <span class="text-slate-600 dark:text-slate-300">Voice note</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">R</kbd> <span class="text-slate-600 dark:text-slate-300">Repeat rating</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">Z</kbd> <span class="text-slate-600 dark:text-slate-300">Speed mode</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">G</kbd><kbd class="ih-kbd">D</kbd> <span class="text-slate-600 dark:text-slate-300">Next defect</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">Tab</kbd> <span class="text-slate-600 dark:text-slate-300">Next [FIELD]</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">⇧Tab</kbd> <span class="text-slate-600 dark:text-slate-300">Prev [FIELD]</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">Esc</kbd> <span class="text-slate-600 dark:text-slate-300">Cancel action</span></div>
                        <div class="flex items-center gap-2"><kbd class="ih-kbd">⌘\</kbd> <span class="text-slate-600 dark:text-slate-300">Toggle sidebar</span></div>
                    </div>
                </div>
            </div>

            {/* Spacer pushes the live state to the right edge. */}
            <span class="flex-1"></span>

            {/* Sync chip — dot + label. Dot colour pairs with syncStatus
                token (ok / watch / bad). Label rotates between four
                states; the queued-count is folded into the label so the
                chip never expands beyond a single token. */}
            <span
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-bold text-[10px] tabular-nums"
                x-bind:style="syncStatus === 'online' ? 'color: var(--ih-status-ok-fg)' :
                              syncStatus === 'syncing' ? 'color: #b45309' :
                              syncStatus === 'offline' ? 'color: var(--ih-status-bad-fg)' : ''"
                aria-live="polite"
            >
                <span
                    class="w-1.5 h-1.5 rounded-full"
                    x-bind:style="syncStatus === 'online' ? 'background: var(--ih-status-ok)' :
                                  syncStatus === 'syncing' ? 'background: #f59e0b' :
                                  'background: var(--ih-status-bad)'"
                ></span>
                <span x-show="syncStatus === 'online'" x-text="lastSyncedRel ? `Synced ${lastSyncedRel}` : 'Synced'"></span>
                <span x-show="syncStatus === 'syncing'" x-text="state.length > 0 ? `Syncing ${state.length}…` : 'Syncing…'"></span>
                <span x-show="syncStatus === 'offline'" x-text="state.length > 0 ? `Offline · ${state.length} queued` : 'Offline'"></span>
            </span>
        </div>
    );
}
