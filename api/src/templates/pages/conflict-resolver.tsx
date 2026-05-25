/**
 * Gap 13 — Full-screen conflict resolver (DESIGN_HANDOFF §28).
 *
 * Full-screen takeover surface for resolving all pending conflicts on an
 * inspection. Uses BareLayout (hideSidebar=true). For each conflict the
 * user sees a two-column diff (Yours vs Theirs) and picks one of three
 * resolutions: keep mine, keep theirs, or merge manually.
 *
 * Alpine factory: `conflictResolver` (lives in live-conflict-modal.js).
 */
import { BareLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props {
    branding?: BrandingConfig;
    inspectionId: string;
}

export const ConflictResolverPage = ({ branding, inspectionId }: Props): JSX.Element => (
    <BareLayout title="Resolve Conflicts" branding={branding}>
        <div
            class="min-h-screen bg-slate-50"
            x-data={`conflictResolver('${inspectionId}')`}
        >
            {/* Header */}
            <header class="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
                <div class="flex items-center gap-3">
                    <a
                        href={`/inspections/${inspectionId}/edit`}
                        class="ih-btn ih-btn--ghost ih-btn--sm"
                        aria-label="Back to editor"
                    >
                        &larr; Back
                    </a>
                    <h1 class="ih-h2">
                        <span x-text="conflicts.length"></span> conflict<span x-show="conflicts.length !== 1">s</span> to resolve
                    </h1>
                </div>
                <div class="flex items-center gap-4">
                    <span class="ih-meta">
                        Resolved <span x-text="resolved"></span> of <span x-text="conflicts.length"></span>
                    </span>
                    <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                        <input type="checkbox" x-model="autoAdvance" class="ih-checkbox" />
                        Auto-advance
                    </label>
                    <a
                        href={`/inspections/${inspectionId}/edit`}
                        class="ih-btn ih-btn--primary ih-btn--sm"
                        x-show="resolved === conflicts.length && conflicts.length > 0"
                        x-cloak
                    >
                        Done
                    </a>
                </div>
            </header>

            {/* Empty state */}
            <div x-show="conflicts.length === 0" class="flex flex-col items-center justify-center py-24 text-center">
                <div class="text-4xl mb-3">&#x2714;&#xFE0F;</div>
                <p class="ih-h3 text-slate-700">No conflicts</p>
                <p class="ih-meta mt-1">All findings are up to date.</p>
                <a href={`/inspections/${inspectionId}/edit`} class="ih-btn ih-btn--primary mt-6">Back to editor</a>
            </div>

            {/* Conflict cards */}
            <div class="max-w-5xl mx-auto px-4 py-6 space-y-6">
                <template x-for="(c, idx) in conflicts" x-bind:key="c.itemId + '-' + c.field">
                    <div class="ih-card bg-white overflow-hidden" x-bind:id="'conflict-' + idx">
                        {/* Card header */}
                        <div class="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                            <div>
                                <span class="ih-eyebrow" x-text="c.sectionTitle || 'Section'"></span>
                                <span class="mx-1 text-slate-400">/</span>
                                <span class="font-medium text-sm text-slate-800" x-text="c.itemLabel || c.itemId"></span>
                            </div>
                            <span
                                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                                x-bind:class="c.resolved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'"
                                x-text="c.resolved ? 'Resolved' : 'Pending'"
                            ></span>
                        </div>

                        {/* Two-column diff */}
                        <div class="grid md:grid-cols-2 gap-0">
                            {/* Yours */}
                            <div class="p-4 border-r border-slate-200 bg-amber-50/50">
                                <div class="ih-eyebrow text-amber-800 mb-2">Yours</div>
                                <div x-show="c.yours?.rating != null" class="mb-1">
                                    <span class="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-amber-200 text-amber-900" x-text="c.yours?.rating"></span>
                                </div>
                                <p class="text-sm text-slate-700 whitespace-pre-wrap line-clamp-3" x-text="String(c.yours?.value ?? '')"></p>
                            </div>
                            {/* Theirs */}
                            <div class="p-4 bg-sky-50/50">
                                <div class="ih-eyebrow text-sky-800 mb-2">Theirs</div>
                                <div x-show="c.theirs?.rating != null" class="mb-1">
                                    <span class="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-sky-200 text-sky-900" x-text="c.theirs?.rating"></span>
                                </div>
                                <p class="text-sm text-slate-700 whitespace-pre-wrap line-clamp-3" x-text="String(c.theirs?.value ?? '')"></p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div class="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
                            <button type="button" class="ih-btn ih-btn--ghost ih-btn--sm"
                                x-on:click="pick(idx, 'keep-theirs')"
                                x-bind:disabled="c.resolved">Use theirs</button>
                            <button type="button" class="ih-btn ih-btn--secondary ih-btn--sm"
                                x-on:click="pick(idx, 'merge')"
                                x-bind:disabled="c.resolved">Merge manually</button>
                            <button type="button" class="ih-btn ih-btn--primary ih-btn--sm"
                                x-on:click="pick(idx, 'keep-mine')"
                                x-bind:disabled="c.resolved">Use mine</button>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </BareLayout>
);
