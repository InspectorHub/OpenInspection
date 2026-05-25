/**
 * Design System 0520 — M10 SpeedMode (Gap 11 enhancement)
 *
 * Full-screen single-item rating overlay triggered by `Z`. Optimised for
 * single-handed phone use (crawlspace / roof). 100-px-wide hit targets
 * exceed WCAG 44x44 minimum.
 *
 * Alpine state lives in the `inspectionEditor` factory
 * (public/js/inspection-edit.js): speedMode, speedQueue, speedCurrent,
 * speedSectionPicker, plus derived getters.
 *
 * Hotkeys (active only when speedMode === true):
 *   1..5          rate + auto-advance
 *   Tab / Arrow   navigate prev/next
 *   Enter         open full editor
 *   Z / Esc       exit
 */

interface RatingButton {
    key: string;
    label: string;
    value: string;
    tone: string;
}

const RATINGS: RatingButton[] = [
    { key: '1', label: 'Sat',  value: 'sat',     tone: 'bg-emerald-600 hover:bg-emerald-500' },
    { key: '2', label: 'Mon',  value: 'monitor',  tone: 'bg-amber-500 hover:bg-amber-400' },
    { key: '3', label: 'Def',  value: 'defect',   tone: 'bg-rose-600 hover:bg-rose-500' },
    { key: '4', label: 'N/I',  value: 'ni',       tone: 'bg-slate-600 hover:bg-slate-500' },
    { key: '5', label: 'N/P',  value: 'np',       tone: 'bg-slate-600 hover:bg-slate-500' },
];

const chevL = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>';
const chevR = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
const chevDown = '<svg class="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';

export function SpeedMode(): JSX.Element {
    return (
        <div
            x-show="speedMode"
            x-cloak
            style="display: none"
            class="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex flex-col text-white"
            role="dialog"
            aria-modal="true"
            aria-label="Speed-rate inspection items"
        >
            {/* ── Section picker bar (32px) ── */}
            <div class="relative h-8 flex items-center justify-center bg-white/5 border-b border-white/10 select-none">
                <button
                    type="button"
                    class="flex items-center gap-1 text-sm font-medium text-slate-200 hover:text-white px-3 h-full"
                    x-on:click="speedSectionPicker = !speedSectionPicker"
                    aria-label="Open section picker"
                >
                    <span x-text="speedSectionName"></span>
                    <span dangerouslySetInnerHTML={{ __html: chevDown }} />
                </button>
                {/* Dropdown */}
                <div
                    x-show="speedSectionPicker"
                    {...{ 'x-on:click.outside': 'speedSectionPicker = false', 'x-transition.opacity': '' }}
                    class="absolute top-8 inset-x-4 max-h-60 overflow-y-auto rounded-lg bg-slate-800 border border-white/10 shadow-xl z-10"
                >
                    <template x-for="(sec, si) in (template?.sections || [])" {...{ 'x-bind:key': 'si' }}>
                        <button
                            type="button"
                            class="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors"
                            x-text="sec.title || sec.name"
                            x-on:click="speedJumpSection(si); speedSectionPicker = false"
                        ></button>
                    </template>
                </div>
            </div>

            {/* ── Header row ── */}
            <div class="flex items-center justify-between px-4 py-2">
                <button
                    type="button"
                    class="ih-btn ih-btn--ghost text-white text-lg leading-none"
                    x-on:click="toggleSpeedMode()"
                    aria-label="Exit speed mode"
                >&times;</button>
                <div class="text-xs tabular-nums text-slate-400">
                    <span x-text="speedCurrent + 1"></span> / <span x-text="speedQueue.length"></span>
                </div>
                <button
                    type="button"
                    class="ih-btn ih-btn--ghost text-white text-xs"
                    x-on:click="speedOpenEditor()"
                >Edit</button>
            </div>

            {/* ── Centre: item + ratings ── */}
            <div class="flex-1 flex flex-col items-center justify-center px-6 min-h-0">
                {/* Item label */}
                <h2 class="text-xl sm:text-2xl font-bold text-center mb-2 max-w-2xl leading-snug" x-text="speedItemTitle"></h2>

                {/* Note preview */}
                <p
                    class="text-sm text-slate-400 text-center mb-8 max-w-md truncate"
                    x-show="speedItemNote"
                    x-text="speedItemNote"
                ></p>

                {/* Navigation + rating row */}
                <div class="flex items-center gap-2 mb-6">
                    <button
                        type="button"
                        class="w-10 h-20 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                        x-on:click="speedPrev()"
                        x-bind:disabled="speedCurrent === 0"
                        aria-label="Previous item"
                        dangerouslySetInnerHTML={{ __html: chevL }}
                    />
                    {RATINGS.map(b => (
                        <button
                            type="button"
                            class={`w-[68px] sm:w-[80px] h-20 rounded-lg ${b.tone} font-bold flex flex-col items-center justify-center transition-transform active:scale-95`}
                            x-on:click={`speedRate('${b.value}')`}
                            aria-label={`Rate ${b.label}`}
                            key={b.key}
                        >
                            <span class="text-lg mb-0.5">{b.label}</span>
                            <span class="ih-kbd text-[10px] text-slate-700 bg-white/90">{b.key}</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        class="w-10 h-20 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                        x-on:click="speedSkip()"
                        aria-label="Next item"
                        dangerouslySetInnerHTML={{ __html: chevR }}
                    />
                </div>
            </div>

            {/* ── Footer ── */}
            <div class="px-6 py-3 border-t border-white/10 text-slate-400 text-xs tabular-nums text-center">
                <span x-text="speedRatedCount"></span> / <span x-text="speedTotalCount"></span> rated &middot;
                <span x-text="speedPercentText"></span> complete
            </div>
        </div>
    );
}
