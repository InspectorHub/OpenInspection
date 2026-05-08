/**
 * Inline Text Popover — Sprint 1 Sub-spec A Task 1.
 *
 * Replaces window.prompt() in three call sites:
 *   - inspection-edit.js rewriteCannedComment (AI rewrite instruction)
 *   - photo-annotator.js (annotation text)
 *   - conflict-modal.js (edit merged notes)
 *
 * Mounted globally from main-layout.tsx. Opens via window.OIPrompt.open({
 *   title, placeholder, initial, scope, onApply
 * }). Per-scope history persisted in localStorage (last 3 entries).
 *
 * Design system: canonical popover motion (200ms enter / 150ms exit),
 * neutral slate backdrop, rounded-lg surface, indigo focus ring,
 * role=dialog with aria-modal=true, prefers-reduced-motion fallback,
 * <kbd> chips reinforce keyboard-first differentiation.
 */
export const InlineTextPopover = (): JSX.Element => (
    <div
        x-data="oiPrompt"
        x-show="open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oi-prompt-title"
        class="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style="display:none"
        {...{
            'x-cloak': '',
            'x-on:keydown.escape.window': 'if (open) { close(); $event.stopPropagation(); }',
        }}
    >
        {/* Backdrop — neutral slate, not color-tinted */}
        <div
            class="absolute inset-0 bg-slate-900/30"
            style="backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);"
            x-on:click="close()"
            x-transition:enter="ease-out duration-200"
            x-transition:enter-start="opacity-0"
            x-transition:enter-end="opacity-100"
            x-transition:leave="ease-in duration-150"
            x-transition:leave-start="opacity-100"
            x-transition:leave-end="opacity-0"
        ></div>

        {/* Surface — canonical popover motion: opacity + translateY + scale */}
        <div
            class="relative w-full max-w-md rounded-lg bg-white border border-slate-200"
            style="box-shadow: 0 12px 32px rgba(15,23,42,0.12);"
            x-transition:enter="ease-out duration-200"
            x-transition:enter-start="opacity-0 translate-y-2 scale-[0.97]"
            x-transition:enter-end="opacity-100 translate-y-0 scale-100"
            x-transition:leave="ease-in duration-150"
            x-transition:leave-start="opacity-100 translate-y-0 scale-100"
            x-transition:leave-end="opacity-0 translate-y-1 scale-[0.98]"
        >
            <div class="px-5 py-4 border-b border-slate-100">
                <h3 id="oi-prompt-title" class="text-[15px] font-semibold text-slate-900 tracking-tight" x-text="title"></h3>
            </div>
            <div class="p-5 space-y-3">
                {/*
                  Competitor parity C3 — quick-pick instruction templates.
                  Render as outlined pills above the textarea so the
                  inspector can click "shorten" / "less alarming" without
                  typing. Empty templates array hides the row entirely.
                */}
                <div x-show="templates.length > 0" class="flex flex-wrap items-center gap-1.5" data-test="oi-prompt-templates">
                    <template x-for="t in templates" {...{ 'x-bind:key': 't' }}>
                        <button
                            type="button"
                            x-on:click="pickTemplate(t)"
                            class="inline-flex items-center h-6 px-2.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-bold hover:bg-indigo-100 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            x-text="t"
                        ></button>
                    </template>
                </div>
                <textarea
                    x-ref="ta"
                    x-model="value"
                    x-bind:placeholder="placeholder"
                    rows={3}
                    aria-label="Edit text"
                    class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[13px] font-medium resize-none transition-colors"
                    {...{
                        'x-on:keydown.cmd.enter.prevent': 'apply()',
                        'x-on:keydown.ctrl.enter.prevent': 'apply()',
                    }}
                ></textarea>
                <div x-show="history.length > 0" class="space-y-1">
                    <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Recent</div>
                    <template x-for="h in history" {...{ 'x-bind:key': 'h' }}>
                        <button
                            type="button"
                            x-on:click="value = h"
                            class="block w-full text-left px-2 py-1.5 rounded-md text-xs text-slate-600 hover:bg-slate-50 truncate transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            x-text="h"
                        ></button>
                    </template>
                </div>
                <p class="text-[11px] text-slate-400 font-medium">
                    <kbd class="inline-flex items-center px-1 rounded bg-slate-100 text-slate-600 text-[10px]">{'⌘ ↵'}</kbd> apply &middot; <kbd class="inline-flex items-center px-1 rounded bg-slate-100 text-slate-600 text-[10px]">Esc</kbd> cancel
                </p>
            </div>
            <div class="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 rounded-b-lg">
                <button
                    type="button"
                    x-on:click="close()"
                    class="h-8 px-4 rounded-md text-[13px] font-bold text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                >Cancel</button>
                <button
                    type="button"
                    x-on:click="apply()"
                    x-bind:disabled="!value.trim()"
                    class="h-8 px-4 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                >Apply</button>
            </div>
        </div>

        {/* Reduced-motion fallback */}
        <style dangerouslySetInnerHTML={{ __html: `
            @media (prefers-reduced-motion: reduce) {
                [x-data="oiPrompt"] [x-transition\\:enter],
                [x-data="oiPrompt"] [x-transition\\:leave] { transition: none !important; transform: none !important; }
            }
        ` }}></style>
    </div>
);
