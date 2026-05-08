/**
 * Sprint 2 S2-5 — `/inspections/:id/photos` sub-page.
 *
 * Read-only gallery of every photo attached to the inspection, grouped by
 * the item that captured them. The data is loaded client-side by the same
 * `inspectionEditor` Alpine factory that powers /report — we reuse the
 * persisted localStorage state when available, otherwise fall back to a
 * fresh GET on the inspection's results endpoint.
 */

import { MainLayout } from '../../layouts/main-layout';
import { InspectionShell } from '../../components/inspection-shell';
import type { BrandingConfig } from '../../../types/auth';

export interface InspectionPhotosPageProps {
    inspectionId:    string;
    propertyAddress: string;
    branding?:       BrandingConfig | undefined;
    requestId?:      string | undefined;
    siblings?:       Array<{ id: string; templateName: string; status: string }> | undefined;
}

export const InspectionPhotosPage = ({
    inspectionId,
    propertyAddress,
    branding,
    requestId,
    siblings,
}: InspectionPhotosPageProps): JSX.Element => {
    return (
        <MainLayout
            title="Photos"
            {...(branding ? { branding } : {})}
            extraHead={(
                <style dangerouslySetInnerHTML={{ __html: `
                    .hide-scrollbar::-webkit-scrollbar { display: none; }
                    .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
                ` }} />
            )}
        >
            <InspectionShell
                inspectionId={inspectionId}
                propertyAddress={propertyAddress}
                current="photos"
                {...(requestId ? { requestId } : {})}
                {...(siblings  ? { siblings  } : {})}
            >
                <div
                    x-data={`inspectionPhotosPage('${inspectionId}')`}
                    x-init="load()"
                    class="space-y-6"
                >
                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">All photos</h2>
                            <p class="text-[12px] text-slate-500" x-text="totalPhotos + (totalPhotos === 1 ? ' photo' : ' photos') + ' across ' + sections.length + (sections.length === 1 ? ' section' : ' sections')"></p>
                        </div>
                        <a
                            x-bind:href={`'/inspections/${inspectionId}/report'`}
                            class="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-indigo-600 text-white text-[12px] font-bold hover:bg-indigo-700 transition-colors"
                        >
                            Add photos in editor
                        </a>
                    </div>

                    <div x-show="loading" class="text-center py-12 text-slate-400 text-[13px]">Loading photos…</div>

                    <div x-show="!loading && totalPhotos === 0" style="display:none" class="text-center py-12 px-6 rounded-lg bg-slate-50 border border-slate-200">
                        <svg class="w-10 h-10 mx-auto text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <p class="text-[13px] text-slate-500">No photos uploaded yet.</p>
                    </div>

                    <template x-for="sec in sections" {...{ 'x-bind:key': 'sec.id' }}>
                        <section x-show="sec.photoCount > 0" style="display:none" class="space-y-3">
                            <header class="flex items-baseline justify-between border-b border-slate-200 pb-2">
                                <h3 class="text-[14px] font-bold text-slate-900" x-text="sec.title"></h3>
                                <span class="text-[11px] text-slate-400 font-mono" x-text="sec.photoCount + ' photos'"></span>
                            </header>
                            <template x-for="item in sec.items" {...{ 'x-bind:key': 'item.id' }}>
                                <div x-show="item.photos.length > 0" style="display:none" class="space-y-2">
                                    <h4 class="text-[12px] font-semibold text-slate-700" x-text="item.label"></h4>
                                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                        <template x-for="photo in item.photos" {...{ 'x-bind:key': 'photo.url' }}>
                                            <a
                                                x-bind:href="photo.url"
                                                target="_blank"
                                                rel="noopener"
                                                class="block aspect-square rounded-md overflow-hidden bg-slate-100 ring-1 ring-slate-200 hover:ring-indigo-300 transition-all"
                                            >
                                                <img
                                                    x-bind:src="photo.url"
                                                    x-bind:alt="item.label"
                                                    class="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            </a>
                                        </template>
                                    </div>
                                </div>
                            </template>
                        </section>
                    </template>
                </div>
            </InspectionShell>
            <script src="/js/auth.js"></script>
            <script src="/js/inspection-photos.js"></script>
        </MainLayout>
    );
};
