/**
 * Design System 0520 subsystem C phase 3 — Apprentice review queue page.
 *
 * Lead / mentor's queue of apprentice-submitted ratings + notes awaiting
 * approval before they appear in the published report. Mirrors the
 * design's ApprenticeReview.jsx (UI kit) — two-pane layout:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Banner: "N apprentice ratings awaiting review"  [Back]         │
 *   ├──────────────────────┬─────────────────────────────────────────┤
 *   │ Queue list (320 px)  │ Review pane                             │
 *   │  · apprentice avatar │  · header (apprentice · address)        │
 *   │  · section · item    │  · proposed value                       │
 *   │  · rating chip + ago │  · note                                 │
 *   │  · decision pill     │  · Reject / Edit / Approve action bar   │
 *   └──────────────────────┴─────────────────────────────────────────┘
 *
 * Backend endpoints:
 *   GET  /api/team/apprentice-reviews            — list pending (enriched)
 *   POST /api/team/apprentice-reviews/:id/decide — body { action, decisionValue? }
 *
 * The page lives behind htmlAuthGuard(['owner', 'admin', 'inspector']) so
 * mentors can reach it from the dashboard or the Publish modal pre-flight
 * "Review now →" CTA.
 */
import { MainLayout } from '../layouts/main-layout';
import { PageHeader } from '../components/page-header';
import type { BrandingConfig } from '../../types/auth';

interface Props {
    branding?: BrandingConfig | undefined;
}

export const ApprenticeReviewPage = ({ branding }: Props = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Apprentice review`} branding={branding}>
            <div class="space-y-4 animate-fade-in" x-data="apprenticeReview()" x-init="init()">
                <PageHeader
                    eyebrow="TEAM · APPRENTICE REVIEW"
                    eyebrowColor="slate"
                    title="Apprentice review"
                    breadcrumb={[{ label: 'Team', href: '/settings/team' }, { label: 'Apprentice review' }]}
                    meta={<span x-text="metaText"></span>}
                />

                {/* Loading skeleton */}
                <div x-show="loading" aria-busy="true" class="space-y-2 py-6">
                    <span class="sr-only">Loading…</span>
                    <div class="ih-skeleton ih-skeleton--text" style="width: 50%;"></div>
                    <div class="ih-skeleton ih-skeleton--text" style="width: 75%;"></div>
                    <div class="ih-skeleton ih-skeleton--text" style="width: 60%;"></div>
                </div>

                {/* Top status banner — peer of the page header so the inspector
                    sees pending state immediately without scrolling. */}
                <div
                    x-show="!loading"
                    x-cloak
                    class="flex items-center gap-3 px-4 py-3 rounded-md border"
                    x-bind:class="pendingCount === 0
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                        : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800'"
                >
                    <span
                        class="inline-flex items-center justify-center w-7 h-7 rounded-full text-white flex-shrink-0"
                        x-bind:class="pendingCount === 0 ? 'bg-emerald-500' : 'bg-indigo-500'"
                    >
                        <template x-if="pendingCount === 0">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                        </template>
                        <template x-if="pendingCount > 0">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 9v3.75M11.996 16.125h.007v.008h-.007v-.008z" /></svg>
                        </template>
                    </span>
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-bold text-slate-900 dark:text-slate-100" x-text="bannerHeadline"></div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Items flow through here before they appear in the published report.
                        </div>
                    </div>
                </div>

                {/* Empty state */}
                <div x-show="!loading && allItems.length === 0" x-cloak class="ih-empty-state">
                    <svg class="ih-empty-state__icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <h3 class="ih-empty-state__title">Nothing to review</h3>
                    <p class="ih-empty-state__subline">Apprentice ratings appear here when they're submitted. You'll get a desktop notification when something lands.</p>
                </div>

                {/* Two-pane layout — queue list on the left, active item detail
                    on the right. Stacks vertically on mobile. */}
                <div x-show="!loading && allItems.length > 0" x-cloak class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[480px]">
                    {/* Left: queue list */}
                    <aside class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden flex flex-col">
                        <div class="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
                            <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Queue</span>
                            <span class="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                                <span x-text="doneCount"></span> / <span x-text="allItems.length"></span>
                            </span>
                        </div>
                        <ul class="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                            <template x-for="q in allItems" x-bind:key="q.id">
                                <li>
                                    <button
                                        type="button"
                                        x-on:click="setActive(q.id)"
                                        x-bind:class="q.id === activeId
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30 border-l-[2px] border-indigo-500'
                                            : 'border-l-[2px] border-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50'"
                                        class="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors"
                                    >
                                        <span
                                            class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold flex-shrink-0"
                                            x-text="initials(q.apprenticeName)"
                                        ></span>
                                        <div class="flex-1 min-w-0">
                                            <div class="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500" x-text="q.field === 'rating' ? 'Rating' : (q.field === 'notes' ? 'Notes' : 'Value')"></div>
                                            <div
                                                x-bind:class="q.id === activeId ? 'text-indigo-700 dark:text-indigo-300 font-bold' : 'text-slate-900 dark:text-slate-100 font-semibold'"
                                                class="text-[13px] mt-0.5 leading-tight"
                                                x-text="q.itemId"
                                            ></div>
                                            <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                                                <span x-show="q.field === 'rating'" class="ih-pill" x-bind:class="ratingPill(q.proposedValue)" x-text="ratingShort(q.proposedValue)"></span>
                                                <span class="truncate" x-text="shortAddress(q.inspectionAddress)"></span>
                                                <span>·</span>
                                                <span x-text="relTime(q.submittedAt)"></span>
                                            </div>
                                            <div x-show="q.decision" class="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold"
                                                 x-bind:class="q.decision === 'approved'
                                                     ? 'text-emerald-600 dark:text-emerald-400'
                                                     : q.decision === 'rejected'
                                                         ? 'text-rose-600 dark:text-rose-400'
                                                         : 'text-indigo-600 dark:text-indigo-400'">
                                                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                                                <span x-text="q.decision === 'approved' ? 'Approved' : q.decision === 'rejected' ? 'Rejected' : 'Edited'"></span>
                                            </div>
                                        </div>
                                    </button>
                                </li>
                            </template>
                        </ul>
                    </aside>

                    {/* Right: review pane for active item */}
                    <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden flex flex-col" x-show="active" x-cloak>
                        <header class="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
                            <div class="flex items-center gap-2 flex-wrap text-xs text-slate-600 dark:text-slate-300 mb-2">
                                <span
                                    class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold flex-shrink-0"
                                    x-text="initials(active.apprenticeName)"
                                ></span>
                                <span class="font-semibold" x-text="active.apprenticeName"></span>
                                <span class="text-slate-400">submitted <span x-text="relTime(active.submittedAt)"></span></span>
                                <span class="flex-1"></span>
                                <a x-bind:href="'/inspections/' + active.inspectionId + '/report'"
                                   class="ih-pill bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:underline"
                                   x-text="shortAddress(active.inspectionAddress)"
                                   title="Open inspection editor in a new tab"
                                   target="_blank" rel="noopener"></a>
                            </div>
                            <h1 class="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100" x-text="active.itemId"></h1>
                            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Field: <span class="font-semibold" x-text="active.field"></span>
                            </div>
                        </header>

                        <div class="flex-1 overflow-y-auto p-6 space-y-4">
                            {/* Proposed value preview */}
                            <div class="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-4">
                                <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 mb-2">Apprentice proposed</div>
                                <template x-if="active.field === 'rating'">
                                    <div class="flex items-center gap-2">
                                        <span class="ih-pill" x-bind:class="ratingPill(active.proposedValue)" x-text="ratingShort(active.proposedValue)"></span>
                                        <span class="text-sm text-slate-600 dark:text-slate-300" x-text="ratingLabel(active.proposedValue)"></span>
                                    </div>
                                </template>
                                <template x-if="active.field !== 'rating' && !editing">
                                    <pre class="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 leading-relaxed" x-text="renderValue(active.proposedValue)"></pre>
                                </template>
                                <template x-if="active.field !== 'rating' && editing">
                                    <textarea
                                        x-model="editedValue"
                                        class="w-full min-h-[120px] px-3 py-2 border-2 border-indigo-500 rounded-md text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700 outline-none resize-y"
                                        placeholder="Edit the apprentice's value before approving…"
                                    ></textarea>
                                </template>
                            </div>

                            {/* Decision already recorded */}
                            <div x-show="active.decision" x-cloak
                                 class="px-4 py-3 rounded-md text-sm border"
                                 x-bind:class="active.decision === 'approved'
                                     ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                     : active.decision === 'rejected'
                                         ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                                         : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'">
                                Decision recorded: <span class="font-bold" x-text="active.decision"></span>. Item moved into the canonical inspection state.
                            </div>
                        </div>

                        {/* Action bar */}
                        <div x-show="!active.decision" x-cloak class="border-t border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center gap-3 flex-wrap">
                            <p class="text-[11px] text-slate-500 dark:text-slate-400 flex-1 leading-snug max-w-[300px]">
                                Approve to publish as-is · Edit to refine before publishing · Reject sends back to the apprentice.
                            </p>
                            <button
                                type="button"
                                x-on:click="decide('rejected')"
                                x-bind:disabled="deciding"
                                class="px-3 py-2 rounded-md text-[12px] font-bold border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50 transition-colors"
                            >Reject &amp; comment</button>
                            <button
                                type="button"
                                x-show="active.field !== 'rating'"
                                x-on:click="startEdit()"
                                x-bind:disabled="deciding"
                                class="px-3 py-2 rounded-md text-[12px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                            >
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                                <span x-text="editing ? 'Save &amp; approve' : 'Edit &amp; approve'"></span>
                            </button>
                            <button
                                type="button"
                                x-on:click="decide('approved')"
                                x-bind:disabled="deciding || editing"
                                class="px-4 py-2 rounded-md text-[12px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                            >
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                                Approve
                            </button>
                        </div>
                    </section>
                </div>
            </div>
            <script src="/js/apprentice-review.js"></script>
        </MainLayout>
    );
};
