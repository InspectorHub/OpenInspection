/**
 * Sprint 1 Sub-spec D Task 7 (D-6) — Agent dashboard hero strip.
 *
 * One moment of visual delight in an otherwise utilitarian agent portal: a
 * dark slate gradient band that summarises the most recent referred
 * inspection and surfaces the "Share with your buyer" call-to-action.
 *
 * The component is dual-purpose:
 *  - When called server-side with concrete props it renders static content.
 *  - When called with `alpine: true` the strings hook into the Alpine state
 *    owned by `agent-dashboard.js` (top referral), so the hero updates as
 *    the dashboard loads its referral list. Either way the share button
 *    delegates to `shareToBuyer()` defined in the page JS.
 *
 * Aesthetic: refined editorial dark band. Uses bg-gradient + a subtle
 * indigo radial highlight (NOT an atmospheric blob, NOT animated). Matches
 * the design system's "refined minimalism for shop-floor professionals"
 * direction.
 */

export interface AgentDashboardHeroProps {
    propertyAddress?: string;
    scheduledAt?:     string;
    inspectorName?:   string;
    clientName?:      string;
    status?:          string;
    /** When true, replaces concrete strings with Alpine x-text bindings. */
    alpine?:          boolean;
}

export const AgentDashboardHero = (props: AgentDashboardHeroProps = {}): JSX.Element => {
    const useAlpine     = props.alpine === true;
    const propertyAddress = props.propertyAddress ?? 'Your referrals at a glance';
    const scheduledAt   = props.scheduledAt    ?? '';
    const inspectorName = props.inspectorName  ?? '';
    const clientName    = props.clientName     ?? '';

    return (
        <section class="relative rounded-xl overflow-hidden bg-slate-900 text-white">
            {/* Flat slate-900 slab with a subtle off-center indigo accent.
                The design system allows exactly one gradient (the brand
                --ih-primary-gradient on CTAs); replaced the previous
                slate-800→slate-950 backdrop with a flat fill + accent
                radial highlight at the same opacity so the editorial
                feel survives without violating the gradient rule. */}
            <div class="absolute inset-0" style="background-image: radial-gradient(circle at 30% 40%, rgba(99,102,241,0.18) 0%, transparent 55%);" aria-hidden="true"></div>

            <div class="relative px-6 py-8 md:px-10 md:py-10">
                <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                    <div class="space-y-2 min-w-0 flex-1">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-300">Inspection Report</p>
                        {useAlpine
                            ? <h1 class="text-[22px] md:text-[28px] font-bold tracking-tight text-white leading-tight" x-text="hero.propertyAddress || 'Your referrals at a glance'"></h1>
                            : <h1 class="text-[22px] md:text-[28px] font-bold tracking-tight text-white leading-tight">{propertyAddress}</h1>}
                        {useAlpine
                            ? <p class="text-[13px] text-slate-300 font-medium" x-text="hero.subline"></p>
                            : (scheduledAt || clientName)
                                ? <p class="text-[13px] text-slate-300 font-medium">{scheduledAt}{scheduledAt && clientName ? ' · for ' : ''}{clientName}</p>
                                : <p class="text-[13px] text-slate-300 font-medium">Share inspection reports with the buyer in one click.</p>}
                        <div class="flex items-center gap-2 mt-3 flex-wrap">
                            {useAlpine
                                ? <span x-show="hero.inspectorName" class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[11px] font-bold uppercase tracking-wider">
                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true"></span>
                                    Inspector: <span x-text="hero.inspectorName"></span>
                                  </span>
                                : (inspectorName ? <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[11px] font-bold uppercase tracking-wider">
                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true"></span>
                                    Inspector: {inspectorName}
                                  </span> : null)}
                        </div>
                    </div>

                    <div class="flex flex-col sm:flex-row md:flex-col gap-2 flex-shrink-0">
                        <button
                            type="button"
                            x-on:click="shareToBuyer()"
                            class="h-10 px-5 rounded-md bg-amber-400 text-amber-950 text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-amber-300 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-white/30 shadow-lg"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
                            Share with your buyer
                        </button>
                        <a href="#full-report" class="h-10 px-5 rounded-md bg-white/10 border border-white/20 text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30">
                            View full report
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
};
