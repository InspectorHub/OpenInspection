import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const CalendarPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Calendar`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                <div x-data="calendarMeta">
                    <PageHeader
                        eyebrow="CALENDAR"
                        eyebrowColor="indigo"
                        title="Calendar"
                        meta={<span x-text="metaText"></span>}
                    />
                </div>
                {/* FullCalendar mount point */}
                <div class="glass-panel rounded-lg overflow-hidden shadow-md p-4">
                    <div id="calendar"></div>
                </div>
            </div>

            {/*
                Sprint 3 · S3-9 — Calendar drag-drop reschedule conflict modal.
                Driven by Alpine `calendarConflict` data on the body, populated by
                the FullCalendar eventDrop handler in /js/calendar.js when the
                drop target is already occupied. Three resolutions:
                  - Replace: bump the existing inspection back to the dragged
                    inspection's old slot.
                  - Swap: exchange the two slots.
                  - Cancel: revert (no API call).
            */}
            <div
                x-data="calendarConflict"
                x-show="open"
                style="display:none"
                class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                {...{ 'x-on:click.self': 'cancel()' }}
                {...{ 'x-on:keydown.escape.window': 'cancel()' }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="calendar-conflict-title"
            >
                <div class="bg-white rounded-md shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" {...{ 'x-on:click.stop': '' }}>
                    <header class="flex items-start justify-between gap-3 mb-4">
                        <div class="min-w-0 flex-1">
                            <h2 id="calendar-conflict-title" class="text-lg font-bold text-slate-900">Time slot taken</h2>
                            <p class="text-sm text-slate-500 mt-0.5">
                                <span x-text="conflictTitle"></span>
                                <span class="text-slate-400"> already occupies </span>
                                <span x-text="targetLabel" class="font-semibold text-slate-700"></span>
                            </p>
                        </div>
                        <button
                            type="button"
                            aria-label="Close dialog"
                            class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 flex-shrink-0"
                            x-on:click="cancel()"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </header>
                    <p class="text-sm text-slate-600 mb-4">Choose how to resolve the overlap:</p>
                    <div class="space-y-2">
                        <button
                            type="button"
                            x-on:click="resolve('replace')"
                            x-bind:disabled="busy"
                            class="w-full text-left px-4 py-3 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                        >
                            <div class="text-sm font-bold text-slate-900">Replace</div>
                            <div class="text-xs text-slate-500 mt-0.5">Move the existing inspection back to the dragged inspection&rsquo;s old slot.</div>
                        </button>
                        <button
                            type="button"
                            x-on:click="resolve('swap')"
                            x-bind:disabled="busy"
                            class="w-full text-left px-4 py-3 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                        >
                            <div class="text-sm font-bold text-slate-900">Swap</div>
                            <div class="text-xs text-slate-500 mt-0.5">Exchange the two inspections&rsquo; slots.</div>
                        </button>
                        <button
                            type="button"
                            x-on:click="cancel()"
                            x-bind:disabled="busy"
                            class="w-full text-left px-4 py-3 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                        >
                            <div class="text-sm font-bold text-slate-900">Pick another slot</div>
                            <div class="text-xs text-slate-500 mt-0.5">Revert this drag and choose a different time.</div>
                        </button>
                    </div>
                </div>
            </div>

            {/* FullCalendar vendor scripts (CSS bundled in JS for global build) */}
            <script src="/vendor/fullcalendar/core.global.min.js"></script>
            <script src="/vendor/fullcalendar/daygrid.global.min.js"></script>
            <script src="/vendor/fullcalendar/timegrid.global.min.js"></script>
            <script src="/vendor/fullcalendar/interaction.global.min.js"></script>
            <script src="/js/auth.js"></script>
            <script src="/js/calendar.js"></script>
        </MainLayout>
    );
};
