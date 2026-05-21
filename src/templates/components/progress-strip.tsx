/**
 * Design System 0520 subsystem B phase 6 task 6.2 — ProgressStrip.
 *
 * Inline strip at the top of inspection-edit showing:
 *   - SVG donut completion ring + percent label
 *   - "12 of 47 rated" pill + "ETA 8 min" projection
 *   - Per-section heat-map bar (one bar per section, filled to %)
 *
 * State lives in window.progressStrip() Alpine factory; recomputes via
 * the pure helpers on a 1s setInterval (cheap — ~150 items, no DB hit).
 * Future PR can switch to event-driven recompute by adding an
 * `items-updated` dispatcher in inspection-edit.js.
 */

export function ProgressStrip(): JSX.Element {
    return (
        <div
            x-data="progressStrip()"
            x-show="completion.total > 0"
            x-cloak
            class="flex items-center gap-4 px-4 py-2 bg-slate-50 border-b border-slate-200"
        >
            {/* Donut */}
            <svg class="w-12 h-12 shrink-0" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="16" fill="none" stroke="var(--ih-slate-200, #e2e8f0)" stroke-width="3" />
                <circle
                    cx="18" cy="18" r="16"
                    fill="none"
                    stroke="var(--ih-primary, #6366f1)"
                    stroke-width="3"
                    stroke-linecap="round"
                    x-bind:stroke-dasharray={"`${completion.percent}, 100`"}
                    transform="rotate(-90 18 18)"
                />
                <text x="18" y="22" text-anchor="middle" font-size="9" font-weight="600" x-text={"`${completion.percent}%`"} />
            </svg>

            {/* Counts + ETA */}
            <div class="ih-meta whitespace-nowrap">
                <span x-text={"`${completion.rated} of ${completion.total} rated`"} />
                <span x-show="etaMin > 0" x-text={"` · ETA ${etaMin} min`"} />
            </div>

            {/* Heat-map row — flat fill via two divs (no linear-gradient;
                the design system reserves linear-gradient for the single
                --ih-primary-gradient brand CTA). The outer is the unrated
                track, the inner is the rated portion sized as a % width. */}
            <div class="flex-1 flex gap-1 overflow-hidden">
                <template x-for="sec in heatMap" x-bind:key="sec.sectionId">
                    <div
                        class="flex-1 h-2 rounded overflow-hidden relative"
                        style="background: var(--ih-slate-200, #e2e8f0);"
                        x-bind:title={"`${sec.sectionId}: ${sec.percent}% (${sec.rated}/${sec.total})`"}
                    >
                        <div
                            class="absolute inset-y-0 left-0"
                            style="background: var(--ih-status-ok, #10b981);"
                            x-bind:style={"`width: ${sec.percent}%`"}
                        ></div>
                    </div>
                </template>
            </div>
        </div>
    );
}
