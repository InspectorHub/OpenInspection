/**
 * Design System 0520 subsystem B phase 4 task 4.5 — ReconnectBanner.
 *
 * Top-of-editor amber strip shown when the offline queue has either:
 *   - Pending writes while offline ("⤷ Reconnecting… N queued"), or
 *   - Conflicts blocking the queue ("⤷ N change(s) conflict — Review →")
 *
 * The Review button defers to the EXISTING conflict-modal (offline-replay
 * surface) by setting `conflictModal.open = true` via window event. That
 * modal already iterates db.conflicts; the banner just makes the entry
 * point visible at the top of the page.
 */

export function ReconnectBanner(): JSX.Element {
    return (
        <div
            x-data="reconnectBanner()"
            x-show="visible"
            x-cloak
            role="alert"
        >
            {/* Clean reconnect — green, auto-dismisses */}
            <div
                x-show="kind === 'clean'"
                class="sticky top-0 inset-x-0 z-40 border-b px-4 py-2 text-sm flex items-center justify-between gap-3"
                style="background: var(--ih-status-ok-bg); border-color: var(--ih-status-ok); color: var(--ih-status-ok-fg);"
            >
                <div class="flex items-center gap-2">
                    <span class="w-5 h-5 rounded-full flex items-center justify-center" style="background: var(--ih-status-ok);">
                        <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
                    </span>
                    <span>
                        <strong>Reconnected</strong> · <span x-text="mergedCount"></span> changes auto-merged · You're back in sync.
                    </span>
                </div>
                <button type="button" {...{ 'x-on:click': 'dismiss()' }} class="text-emerald-700 hover:text-emerald-900" aria-label="Dismiss">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>

            {/* Conflict reconnect — red, requires action */}
            <div
                x-show="kind === 'conflicts'"
                class="sticky top-0 inset-x-0 z-40 border-b px-4 py-2 text-sm flex items-center justify-between gap-3"
                style="background: var(--ih-status-bad-bg); border-color: var(--ih-status-bad); color: var(--ih-status-bad-fg);"
            >
                <div class="flex items-center gap-2">
                    <span class="w-5 h-5 rounded-full flex items-center justify-center" style="background: var(--ih-status-bad);">
                        <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 9v2m0 4h.01"/></svg>
                    </span>
                    <span>
                        <strong>Reconnected</strong> · <span x-text="mergedCount"></span> auto-merged · <span x-text="conflictCount"></span> conflicts to resolve
                    </span>
                </div>
                <button type="button" class="ih-btn ih-btn--sm" style="background: var(--ih-status-bad); color: white;" {...{ 'x-on:click': 'reviewConflicts()' }}>
                    Review →
                </button>
            </div>

            {/* Offline reconnecting — amber, progress */}
            <div
                x-show="kind === 'reconnecting'"
                class="sticky top-0 inset-x-0 z-40 bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900 flex items-center gap-3"
            >
                <span class="w-4 h-4 rounded-full bg-amber-500 animate-pulse"></span>
                <span>Reconnecting… <span x-text="queuedCount"></span> queued changes syncing</span>
            </div>
        </div>
    );
}
