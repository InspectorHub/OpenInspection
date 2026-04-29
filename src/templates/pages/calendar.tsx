import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const CalendarPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Calendar`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                {/* Header */}
                <div>
                    <span class="inline-flex items-center rounded-lg bg-violet-600/10 px-3 py-1 text-[10px] font-black text-violet-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-violet-600/20 mb-4">Calendar</span>
                    <h1 class="text-5xl font-black tracking-tight text-slate-900">Calendar</h1>
                    <p class="text-lg text-slate-500 font-semibold mt-2">View scheduled inspections by month, week, or day.</p>
                </div>
                {/* FullCalendar mount point */}
                <div class="glass-panel rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50 p-4">
                    <div id="calendar"></div>
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
