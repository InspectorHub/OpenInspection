/**
 * Design System 0520 subsystem B phase 3 task 3.6 — live (online) conflict
 * modal.
 *
 * Triggered when an online PATCH /api/inspections/:id/items/:itemId returns
 * 409 because another inspector saved the same field first. Companion to
 * the existing conflict-modal.tsx (which handles OFFLINE-replay conflicts
 * coming out of the Dexie sync queue) — kept separate so the offline
 * surface is unaffected by changes to the online flow.
 *
 * Trigger: window.dispatchEvent(new CustomEvent('present-live-conflict', {
 *   detail: {
 *     inspectionId, itemId, field,
 *     yours:  { value, expectedVersion },
 *     theirs: { value, by?, at?, v },
 *   },
 * }))
 *
 * Resolution dispatches:
 *   - keep-mine    → re-PATCH with expectedVersion = theirs.v, force=false
 *   - keep-theirs  → close (no write)
 *   - merge        → re-PATCH with merged textarea value, expectedVersion = theirs.v
 *
 * Successful retry fires `live-conflict-resolved` so the editor can
 * refresh local state.
 */

export function LiveConflictModal(): JSX.Element {
    return (
        <div
            x-data="liveConflictModal()"
            x-show="open"
            x-cloak
            style="display:none"
            class="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Resolve concurrent edit"
        >
            <div class="ih-card max-w-3xl w-full max-h-[90vh] overflow-y-auto bg-white">
                <header class="px-6 py-4 border-b border-slate-200">
                    <h2 class="ih-h2">Resolve concurrent edit</h2>
                    <p class="ih-meta mt-1">
                        <span x-text="conflict.field"></span> on
                        <span x-text="conflict.itemId"></span>
                        — last edited by
                        <strong x-text="conflict.theirs?.by || 'another inspector'"></strong>
                        ·
                        <span x-text="theirsRelTime"></span>
                    </p>
                </header>

                <div class="grid grid-cols-2 gap-0 border-b border-slate-200">
                    <div class="p-4 border-r border-slate-200 bg-amber-50">
                        <div class="ih-eyebrow mb-2 text-amber-800">Yours</div>
                        <pre class="text-sm whitespace-pre-wrap" x-text="String(conflict.yours?.value ?? '')"></pre>
                    </div>
                    <div class="p-4 bg-sky-50">
                        <div class="ih-eyebrow mb-2 text-sky-800">Theirs (server)</div>
                        <pre class="text-sm whitespace-pre-wrap" x-text="String(conflict.theirs?.value ?? '')"></pre>
                    </div>
                </div>

                <div x-show="action === 'merge'" class="p-4 border-b border-slate-200">
                    <label class="ih-eyebrow block mb-2">Merged value</label>
                    <textarea
                        class="ih-input w-full h-32"
                        x-model="mergedValue"
                        aria-label="Merged value"
                    ></textarea>
                </div>

                <footer class="px-6 py-4 flex justify-end gap-2 bg-slate-50">
                    <button
                        type="button"
                        class="ih-btn ih-btn--ghost"
                        x-on:click="action = 'keep-theirs'; resolve()"
                    >Keep theirs</button>

                    <button
                        type="button"
                        class="ih-btn ih-btn--secondary"
                        x-show="action !== 'merge'"
                        x-on:click="action = 'merge'"
                    >Merge…</button>

                    <button
                        type="button"
                        class="ih-btn ih-btn--primary"
                        x-show="action !== 'merge'"
                        x-on:click="action = 'keep-mine'; resolve()"
                        x-bind:disabled="saving"
                    >Keep mine</button>

                    <button
                        type="button"
                        class="ih-btn ih-btn--primary"
                        x-show="action === 'merge'"
                        x-on:click="resolve()"
                        x-bind:disabled="saving || !mergedValue?.length"
                    >Save merged</button>
                </footer>
            </div>
        </div>
    );
}
