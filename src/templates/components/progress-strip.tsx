/**
 * Design System 0520 subsystem B phase 6 — ProgressStrip.
 *
 * Top-of-page telemetry strip on the inspection editor. Mirrors the
 * inspector-app design kit's ProgressStrip:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ [◔ 67%]  32 of 47 rated · ETA 8 min     [DEF 3] [MON 5] [SAT 22]   │
 *   │                                          [UNRATED 13]   [Agreement │
 *   │                                          signed] [Payment paid]    │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Every colour, surface and border reads from `--ih-*` tokens so the
 * strip flips for dark mode and per-tenant brand colour automatically.
 *
 * Data wires:
 *   - completion / etaMin / tally — from progress-strip-helpers
 *   - workflow.agreement / .payment — derived from the editor's
 *       inspection row by the Alpine factory
 */

export function ProgressStrip(): JSX.Element {
    return (
        <div
            x-data="progressStrip()"
            class="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b"
            style="background: var(--ih-bg-card); border-color: var(--ih-slate-200, #e2e8f0);"
            aria-label="Inspection progress"
        >
            {/* Donut — completion percent. SVG circle with stroke-dasharray
                animates as items get rated. Inner text label is the percent. */}
            <div class="relative w-10 h-10 shrink-0">
                <svg class="w-10 h-10" viewBox="0 0 36 36" aria-hidden="true">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--ih-slate-200, #e2e8f0)" stroke-width="3" />
                    <circle
                        cx="18" cy="18" r="15"
                        fill="none"
                        stroke="var(--ih-primary, #6366f1)"
                        stroke-width="3"
                        stroke-linecap="round"
                        x-bind:stroke-dasharray={"`${(completion.percent * 0.942).toFixed(1)}, 100`"}
                        transform="rotate(-90 18 18)"
                    />
                </svg>
                <span
                    class="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums"
                    style="color: var(--ih-fg-1); font-family: var(--ih-font-mono, ui-monospace, monospace);"
                    x-text={"`${completion.percent}`"}
                ></span>
            </div>

            {/* Counts + ETA */}
            <div class="min-w-0 leading-tight">
                <div class="text-[13px] font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    <span x-text="completion.rated"></span>
                    <span class="text-slate-400 dark:text-slate-500 font-normal"> / <span x-text="completion.total"></span></span>
                    <span class="text-slate-500 dark:text-slate-400 font-medium ml-2">items rated</span>
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5" x-show="etaMin > 0">
                    ETA <span class="tabular-nums font-semibold text-slate-700 dark:text-slate-300" x-text="`~${etaMin} min`"></span>
                </div>
            </div>

            {/* Tally chips — defect / monitor / sat / unrated. Use the
                semantic --ih-status-* token pairs so dark mode flips for
                free (the bg/fg tokens cross-fade on attribute switch). */}
            <div class="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Rating breakdown">
                <span
                    x-show="tally.def > 0"
                    class="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums"
                    style="background: var(--ih-status-bad-bg); color: var(--ih-status-bad-fg);"
                >
                    <span x-text="tally.def"></span>
                    <span class="font-semibold opacity-80">def</span>
                </span>
                <span
                    x-show="tally.mon > 0"
                    class="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums"
                    style="background: var(--ih-status-watch-bg); color: var(--ih-status-watch-fg);"
                >
                    <span x-text="tally.mon"></span>
                    <span class="font-semibold opacity-80">mon</span>
                </span>
                <span
                    x-show="tally.sat > 0"
                    class="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums"
                    style="background: var(--ih-status-ok-bg); color: var(--ih-status-ok-fg);"
                >
                    <span x-text="tally.sat"></span>
                    <span class="font-semibold opacity-80">sat</span>
                </span>
                <span
                    x-show="tally.unrated > 0"
                    class="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                >
                    <span x-text="tally.unrated"></span>
                    <span class="font-semibold opacity-80">unrated</span>
                </span>
            </div>

            {/* Spacer pushes workflow chips to the right edge */}
            <span class="flex-1"></span>

            {/* Workflow chips — Agreement + Payment. Source-of-truth is
                the inspection row; the factory's _agreementState /
                _paymentState reducers translate row flags to a
                consistent (state, label, tone) shape so the template
                can keep a single render path for the four tones. */}
            <div class="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Inspection workflow">
                <WorkflowChip kind="agreement" />
                <WorkflowChip kind="payment" />
            </div>
        </div>
    );
}

/**
 * Single workflow chip — tone-driven background + dot. Reads from
 * `workflow.agreement` or `workflow.payment` based on the `kind` prop.
 * Same shape for both keeps the strip's right edge visually rhythmic.
 */
function WorkflowChip({ kind }: { kind: 'agreement' | 'payment' }): JSX.Element {
    const labelExpr = kind === 'agreement' ? "'Agreement'" : "'Payment'";
    const stateExpr = `workflow.${kind}`;
    return (
        <span
            class="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] font-bold"
            x-bind:class={
                `${stateExpr}.tone === 'ok' ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : ` +
                `${stateExpr}.tone === 'watch' ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : ` +
                `${stateExpr}.tone === 'bad' ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' : ` +
                `'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400'`
            }
        >
            <span
                class="w-1.5 h-1.5 rounded-full"
                x-bind:class={
                    `${stateExpr}.tone === 'ok' ? 'bg-emerald-500' : ` +
                    `${stateExpr}.tone === 'watch' ? 'bg-amber-500' : ` +
                    `${stateExpr}.tone === 'bad' ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'`
                }
            ></span>
            <span class="opacity-75 font-semibold" x-text={labelExpr}></span>
            <span x-text={`${stateExpr}.label`}></span>
        </span>
    );
}
