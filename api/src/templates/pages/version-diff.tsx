/**
 * Design System 0520 subsystem D phase 8 — version diff viewer.
 *
 * Two-pane layout: version list (left) + diff body (right). The diff
 * body is fed by `GET /api/inspections/:id/versions/:n/diff?from=:m`
 * which the ReportVersionService computes via the pure version-diff
 * helper committed in Phase 7. Items changed are rendered as a list
 * of from → to entries with line-through old / green new styling.
 */
import { MainLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

export const VersionDiffPage = (
    { inspectionId, toVersion, branding }: {
        inspectionId: string;
        toVersion:    number;
        branding?:    BrandingConfig | undefined;
    },
): JSX.Element => (
    <MainLayout title={`Inspection v${toVersion} diff`} {...(branding ? { branding } : {})}>
        <div x-data={`versionDiff('${inspectionId}', ${toVersion})`}
             {...{ 'x-init': 'init()' }}
             class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 max-w-6xl mx-auto p-6">

            {/* Version list */}
            <aside class="rounded-md border border-slate-200 bg-white p-4 space-y-1 max-h-[calc(100vh-160px)] overflow-y-auto">
                <h3 class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Versions</h3>
                <template {...{ 'x-for': 'v in versions', ':key': 'v.versionNumber' }}>
                    <button class="w-full text-left p-3 rounded border"
                            {...{ ':class': "v.versionNumber === fromVersion ? 'border-indigo-500 bg-indigo-50' : 'border-transparent hover:bg-slate-50'", '@click': 'setFrom(v.versionNumber)' }}>
                        <div class="font-medium">v<span x-text="v.versionNumber" /></div>
                        <div class="text-xs text-slate-500"
                             x-text="v.publishedAt ? new Date(v.publishedAt * 1000).toLocaleString() : ''" />
                        <div class="text-xs text-slate-600 mt-1" x-show="v.summary" x-text="v.summary" />
                    </button>
                </template>
                <p class="text-xs text-slate-400" x-show="versions.length === 0">No published versions yet.</p>
            </aside>

            {/* Diff body */}
            <main class="rounded-md border border-slate-200 bg-white p-6">
                <header class="mb-4 flex items-center justify-between gap-4 flex-wrap">
                    <h1 class="text-xl font-bold">
                        v<span x-text="fromVersion" /> → v<span x-text="toVersion" />
                    </h1>
                    <a href="javascript:history.back()" class="text-xs text-slate-500 hover:text-indigo-600">← Back</a>
                </header>

                <section class="mb-6">
                    <h2 class="text-base font-bold mb-3">Items changed</h2>
                    <ul class="space-y-2">
                        <template {...{ 'x-for': 'c in (diff.items || [])', ':key': 'c.itemId + c.field' }}>
                            <li class="p-3 rounded border border-slate-200">
                                <div class="text-sm font-medium font-mono" x-text="c.itemId" />
                                <div class="text-xs text-slate-500">
                                    <span x-text="c.field" /> · <span x-text="c.kind" />
                                </div>
                                <div x-show="c.kind === 'changed'" class="mt-1 text-sm">
                                    <span class="line-through text-rose-700" x-text="String(c.from ?? '')" />
                                    <span class="mx-1">→</span>
                                    <span class="text-emerald-700" x-text="String(c.to ?? '')" />
                                </div>
                                <div x-show="c.kind === 'added'" class="mt-1 text-sm">
                                    <span class="text-emerald-700">+ <span x-text="String(c.to ?? '')" /></span>
                                </div>
                                <div x-show="c.kind === 'removed'" class="mt-1 text-sm">
                                    <span class="text-rose-700">− <span x-text="String(c.from ?? '')" /></span>
                                </div>
                            </li>
                        </template>
                        <li x-show="(diff.items || []).length === 0"
                            class="text-sm text-slate-400">No item changes.</li>
                    </ul>
                </section>

                <section x-show="(diff.units?.added?.length || 0) + (diff.units?.removed?.length || 0) > 0">
                    <h2 class="text-base font-bold mb-3">Units</h2>
                    <ul class="space-y-1 text-sm">
                        <template {...{ 'x-for': 'u in (diff.units?.added || [])', ':key': 'u.id' }}>
                            <li class="text-emerald-700">+ <span x-text="u.name" /> (<span x-text="u.kind" />)</li>
                        </template>
                        <template {...{ 'x-for': 'u in (diff.units?.removed || [])', ':key': 'u.id' }}>
                            <li class="text-rose-700">− <span x-text="u.name" /> (<span x-text="u.kind" />)</li>
                        </template>
                    </ul>
                </section>
            </main>
        </div>
        <script src="/js/version-diff.js"></script>
    </MainLayout>
);
