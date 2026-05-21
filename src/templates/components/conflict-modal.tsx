/**
 * Conflict resolution sheet — full-viewport overlay with a queue list
 * (left) and the active conflict's base/yours/theirs diff (right).
 *
 * Triggered when db.conflicts is non-empty (the Alpine factory polls
 * dexie every 1 s — see public/js/conflict-modal.js for the data
 * machinery). The previous version was a 3-column compare modal that
 * showed exactly one conflict at a time; this upgrade mirrors the
 * ConflictResolver page from the inspector-app design kit:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Banner: "N conflicts need your input"          [Close]       │
 *   ├──────────────────────┬───────────────────────────────────────┤
 *   │ Queue list  (280 px) │ Compare pane                          │
 *   │  · numbered chip     │  · field + section header             │
 *   │  · section · field   │  · 3-column base / yours / theirs     │
 *   │  · item label        │  · action bar:                        │
 *   │  · click-to-jump     │      Keep mine / Take theirs /        │
 *   │                      │      Edit merged / Reset (escape)     │
 *   └──────────────────────┴───────────────────────────────────────┘
 *
 * Iter-2 bug #12 escape hatch (Reset Local Copy & Reload) stays as a
 * danger-zone button at the bottom of the queue sidebar, separated by
 * a divider so it can't be misclicked while resolving normal conflicts.
 */
export const ConflictModal = () => (
    <div
        x-data="conflictModal"
        x-show="open"
        x-cloak
        style="display:none"
        class="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4"
        {...{ 'x-on:click.self': 'open = false' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-modal-title"
    >
        <div class="bg-white dark:bg-slate-800 rounded-lg shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
            {/* Top banner — peer of the modal title, shows the count
                + a "Reconnected" rationale so the user understands why
                they're seeing this. */}
            <header class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-4">
                <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white flex-shrink-0" aria-hidden="true">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </span>
                <div class="flex-1 min-w-0">
                    <h2 id="conflict-modal-title" class="text-base font-bold text-slate-900 dark:text-slate-100">
                        <span x-text="conflicts.length"></span>
                        conflict<span x-show="conflicts.length !== 1">s</span> need your input
                    </h2>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        These fields were edited on more than one device while offline. Pick the version that should win for each.
                    </p>
                </div>
                <button
                    type="button"
                    x-on:click="open = false"
                    class="px-3 py-1.5 rounded-md text-xs font-bold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >Resolve later</button>
            </header>

            <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[260px_1fr]">
                {/* Queue list — shows every pending conflict so the
                    inspector can jump around instead of being railroaded
                    prev/next. Active row gets an indigo left rail. */}
                <aside class="border-r border-slate-100 dark:border-slate-700 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/40 flex flex-col">
                    <div class="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
                        <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Queue</span>
                        <span class="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                            <span x-text="index + 1"></span> / <span x-text="conflicts.length"></span>
                        </span>
                    </div>
                    <ul class="flex-1 divide-y divide-slate-100 dark:divide-slate-700">
                        <template x-for="(c, i) in conflicts" x-bind:key="c.id">
                            <li>
                                <button
                                    type="button"
                                    x-on:click="index = i"
                                    x-bind:class="i === index
                                        ? 'bg-indigo-50 dark:bg-indigo-900/30 border-l-[2px] border-indigo-500'
                                        : 'border-l-[2px] border-transparent hover:bg-white dark:hover:bg-slate-700/50'"
                                    class="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors"
                                >
                                    <span
                                        x-bind:class="i === index ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200'"
                                        class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-mono font-bold flex-shrink-0 mt-0.5"
                                        x-text="i + 1"
                                    ></span>
                                    <div class="flex-1 min-w-0">
                                        <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500" x-text="c.field"></div>
                                        <div
                                            class="text-[12px] mt-0.5 truncate"
                                            x-bind:class="i === index ? 'text-indigo-700 dark:text-indigo-300 font-bold' : 'text-slate-900 dark:text-slate-100 font-semibold'"
                                            x-text="c.itemId"
                                        ></div>
                                    </div>
                                </button>
                            </li>
                        </template>
                    </ul>
                    {/* Iter-2 bug #12 — escape hatch lives at the bottom of
                        the queue, behind a divider, so it can't be hit by
                        accident while resolving normal conflicts. */}
                    <div class="border-t border-slate-200 dark:border-slate-700 p-3">
                        <button
                            type="button"
                            data-testid="conflict-reset-local"
                            x-on:click="resetLocal()"
                            x-bind:disabled="resetting"
                            class="w-full px-3 py-2 rounded-md text-[11px] font-bold uppercase tracking-[0.14em] border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50 transition-colors"
                        >
                            <span x-show="!resetting">Reset local copy &amp; reload</span>
                            <span x-show="resetting" style="display:none">Resetting…</span>
                        </button>
                        <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 leading-snug">
                            Use only if you're stuck. Discards every offline edit on this device.
                        </p>
                    </div>
                </aside>

                {/* Compare pane — title + 3-col diff + actions */}
                <section class="flex flex-col overflow-hidden">
                    <header class="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
                        <div class="flex items-center gap-3 mb-1">
                            <span class="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500" x-text="`Conflict ${index + 1} of ${conflicts.length}`"></span>
                            <span class="ih-pill ih-pill--monitor" x-text="current?.field === 'rating' ? 'Rating disagreement' : 'Note divergence'"></span>
                        </div>
                        <h3 class="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100" x-text="current?.itemId || ''"></h3>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            field <span class="font-mono font-semibold" x-text="current?.field || '—'"></span>
                        </p>
                    </header>
                    <div class="flex-1 overflow-y-auto p-6">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 mb-1.5">Base · last synced</div>
                                <pre class="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-3 text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed" x-text="current?.base"></pre>
                            </div>
                            <div>
                                <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400 mb-1.5">Yours · while offline</div>
                                <pre class="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-md p-3 text-[12px] text-indigo-900 dark:text-indigo-100 whitespace-pre-wrap leading-relaxed" x-text="current?.ours"></pre>
                            </div>
                            <div>
                                <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400 mb-1.5">Theirs · server</div>
                                <pre class="bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-md p-3 text-[12px] text-rose-900 dark:text-rose-100 whitespace-pre-wrap leading-relaxed" x-text="current?.theirs"></pre>
                            </div>
                        </div>
                    </div>
                    <footer class="border-t border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center gap-2 flex-wrap">
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 flex-1 leading-snug max-w-[260px]">
                            Pick a winner per field. Edit merged opens a free-form editor when both sides are partially correct.
                        </p>
                        <button
                            type="button"
                            x-on:click="resolve('edit')"
                            class="px-3 py-2 rounded-md text-[12px] font-bold border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5"
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                            Edit merged
                        </button>
                        <button
                            type="button"
                            x-on:click="resolve('theirs')"
                            class="px-3 py-2 rounded-md text-[12px] font-bold border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                        >Take theirs</button>
                        <button
                            type="button"
                            x-on:click="resolve('ours')"
                            class="px-4 py-2 rounded-md text-[12px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                        >Keep mine</button>
                    </footer>
                </section>
            </div>
        </div>
    </div>
);
