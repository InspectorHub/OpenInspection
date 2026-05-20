/**
 * Design System 0520 subsystem E P1.4 — PreflightChecks panel.
 *
 * Renders the 5 publish gates returned by `/api/inspections/:id/preflight`
 * as a check-list with remediation buttons. Mount inside publish-modal;
 * the panel dispatches `preflight-status` on init + every refresh so the
 * Publish button can read `allPassed` from a parent scope and disable
 * itself accordingly.
 *
 * Refresh by dispatching `refresh-preflight` on window — e.g. after a
 * user fills in property facts or signs the agreement.
 */
import type { FC } from 'hono/jsx';

export const PreflightChecks: FC = () => (
    <div
        x-data="preflightChecks()"
        {...{ 'x-init': 'init()' }}
        class="border-t border-slate-200 px-6 py-4"
    >
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Pre-flight checks</h3>
        <ul class="space-y-2 text-sm">
            <li class="flex items-center gap-2">
                <span class="font-bold w-4 text-center"
                    {...{ 'x-text': "checks.allRated ? '✓' : '✗'", ':class': "checks.allRated ? 'text-emerald-600' : 'text-rose-600'" }} />
                <span>All items rated
                    <span x-show="!checks.allRated" class="text-slate-400">
                        (<span x-text="checks.unratedCount" /> unrated)
                    </span>
                </span>
                <button class="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50"
                    x-show="!checks.allRated"
                    {...{ '@click': "$dispatch('scroll-to-first-unrated')" }}>Review →</button>
            </li>

            <li class="flex items-center gap-2">
                <span class="font-bold w-4 text-center"
                    {...{ 'x-text': "checks.apprenticeReviewed ? '✓' : '✗'", ':class': "checks.apprenticeReviewed ? 'text-emerald-600' : 'text-rose-600'" }} />
                <span>Apprentice items reviewed
                    <span x-show="!checks.apprenticeReviewed" class="text-slate-400">
                        (<span x-text="checks.apprenticePending" /> pending)
                    </span>
                </span>
                <a class="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50 flex items-center"
                    x-show="!checks.apprenticeReviewed"
                    href="/apprentice-review">Review now →</a>
            </li>

            <li class="flex items-center gap-2">
                <span class="font-bold w-4 text-center"
                    {...{ 'x-text': "checks.propertyFactsComplete ? '✓' : '✗'", ':class': "checks.propertyFactsComplete ? 'text-emerald-600' : 'text-rose-600'" }} />
                <span>Property facts complete
                    <span x-show="!checks.propertyFactsComplete" class="text-slate-400">
                        (<span x-text="checks.missingFacts.join(', ')" />)
                    </span>
                </span>
                <button class="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50"
                    x-show="!checks.propertyFactsComplete"
                    {...{ '@click': "$dispatch('scroll-to-property-facts')" }}>Fill →</button>
            </li>

            <li class="flex items-center gap-2">
                <span class="font-bold w-4 text-center"
                    {...{ 'x-text': "checks.coverPhotoSet ? '✓' : '✗'", ':class': "checks.coverPhotoSet ? 'text-emerald-600' : 'text-rose-600'" }} />
                <span>Cover photo set</span>
                <button class="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50"
                    x-show="!checks.coverPhotoSet"
                    {...{ '@click': "$dispatch('open-cover-photo-picker')" }}>Set →</button>
            </li>

            <li class="flex items-center gap-2">
                <span class="font-bold w-4 text-center"
                    {...{ 'x-text': "checks.agreementSigned ? '✓' : '✗'", ':class': "checks.agreementSigned ? 'text-emerald-600' : 'text-rose-600'" }} />
                <span>Buyer agreement signed</span>
                <button class="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50"
                    x-show="!checks.agreementSigned"
                    {...{ '@click': "$dispatch('open-agreement-flow')" }}>Send →</button>
            </li>
        </ul>

        <p class="text-xs text-slate-400 mt-3" x-show="loading">Loading…</p>
        <p class="text-xs text-rose-600 mt-3" x-show="error" x-text="error" />
    </div>
);
