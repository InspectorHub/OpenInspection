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
