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

interface CheckRowProps {
    /** Alpine expression that evaluates to the boolean "passed" state. */
    passed:  string;
    label:   string;
    /** Optional detail rendered when the check fails (Alpine expression
     *  that evaluates to a string — e.g. "checks.unratedCount + ' unrated'"). */
    detail?: string;
    /** Either a button (Alpine $dispatch) or a link (anchor href). */
    action:  { kind: 'dispatch'; event: string; label: string }
           | { kind: 'link';     href:  string; label: string };
}

function CheckRow({ passed, label, detail, action }: CheckRowProps): JSX.Element {
    const failed = `!${passed}`;
    return (
        <li class="flex items-center gap-2">
            <span class="font-bold w-4 text-center"
                {...{ 'x-text': `${passed} ? '✓' : '✗'`, ':class': `${passed} ? 'text-emerald-600' : 'text-rose-600'` }} />
            <span>{label}
                {detail && (
                    <span x-show={failed} class="text-slate-400">
                        (<span x-text={detail} />)
                    </span>
                )}
            </span>
            {action.kind === 'dispatch' ? (
                <button class="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50"
                    x-show={failed}
                    {...{ '@click': `$dispatch('${action.event}')` }}>{action.label}</button>
            ) : (
                <a class="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50 flex items-center"
                    x-show={failed}
                    href={action.href}>{action.label}</a>
            )}
        </li>
    );
}

export const PreflightChecks: FC = () => (
    <div
        x-data="preflightChecks()"
        {...{ 'x-init': 'init()' }}
        class="border-t border-slate-200 px-6 py-4"
    >
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Pre-flight checks</h3>
        <ul class="space-y-2 text-sm">
            <CheckRow passed="checks.allRated" label="All items rated"
                detail="checks.unratedCount + ' unrated'"
                action={{ kind: 'dispatch', event: 'scroll-to-first-unrated', label: 'Review →' }} />
            <CheckRow passed="checks.apprenticeReviewed" label="Apprentice items reviewed"
                detail="checks.apprenticePending + ' pending'"
                action={{ kind: 'link', href: '/apprentice-review', label: 'Review now →' }} />
            <CheckRow passed="checks.propertyFactsComplete" label="Property facts complete"
                detail="checks.missingFacts.join(', ')"
                action={{ kind: 'dispatch', event: 'scroll-to-property-facts', label: 'Fill →' }} />
            <CheckRow passed="checks.coverPhotoSet" label="Cover photo set"
                action={{ kind: 'dispatch', event: 'open-cover-photo-picker', label: 'Set →' }} />
            <CheckRow passed="checks.agreementSigned" label="Buyer agreement signed"
                action={{ kind: 'dispatch', event: 'open-agreement-flow', label: 'Send →' }} />
        </ul>

        <p class="text-xs text-slate-400 mt-3" x-show="loading">Loading…</p>
        <p class="text-xs text-rose-600 mt-3" x-show="error" x-text="error" />
    </div>
);
