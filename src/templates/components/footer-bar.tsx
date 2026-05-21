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
            {/* Keyboard hint cluster — same shortcuts as the editor's
                hotkey handler in public/js/inspection-edit.js. Hidden on
                narrow widths so the sync chip always has room. */}
            <span class="whitespace-nowrap"><kbd class="ih-kbd">1</kbd>-<kbd class="ih-kbd">5</kbd> rate + advance</span>
            <span class="hidden sm:inline whitespace-nowrap"><kbd class="ih-kbd">J</kbd><kbd class="ih-kbd">K</kbd> nav</span>
            <span class="hidden md:inline whitespace-nowrap"><kbd class="ih-kbd">/</kbd> snippet</span>
            <span class="hidden md:inline whitespace-nowrap"><kbd class="ih-kbd">P</kbd> photo</span>
            <span class="hidden lg:inline whitespace-nowrap"><kbd class="ih-kbd">V</kbd> voice</span>
            <span class="hidden lg:inline whitespace-nowrap"><kbd class="ih-kbd">Z</kbd> speed</span>
            <span class="hidden xl:inline whitespace-nowrap"><kbd class="ih-kbd">?</kbd> all shortcuts</span>

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
