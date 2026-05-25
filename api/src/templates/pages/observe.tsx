/**
 * Design System 0520 subsystem D phase 5 task 5.1 — observer viewer.
 *
 * Read-only embed of the public report viewer with a sticky amber
 * "Live view" banner and 30-second auto-refresh. Mounted on
 * `/observe/inspections/:id` behind `observerCookieGuard`.
 *
 * Implementation uses an `<iframe>` pointing at `/reports/:id` with
 * `?observer=1` so the report viewer can hide Edit / Publish buttons
 * (the viewer respects this flag in a follow-up; until then the
 * embedded view is harmless — there are no mutating buttons exposed
 * through the public viewer surface).
 */
import { BareLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

export const ObservePage = (
    { inspectionId, branding }: { inspectionId: string; branding?: BrandingConfig | undefined },
): JSX.Element => (
    <BareLayout title="Live inspection view" {...(branding ? { branding } : {})}>
        <div class="fixed top-0 inset-x-0 z-40 bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900 text-center">
            <span>👁 Live view — read-only · refreshes every 30 seconds</span>
        </div>
        <div class="pt-12" x-data={`observe('${inspectionId}')`} {...{ 'x-init': 'init()' }}>
            <iframe {...{ ':src': 'src' }}
                    title="Inspection report"
                    class="w-full"
                    style="height: calc(100vh - 48px); border: 0" />
        </div>
        <script src="/js/observe.js"></script>
    </BareLayout>
);

export const ObserverExpiredPage = (
    { branding }: { branding?: BrandingConfig | undefined } = {},
): JSX.Element => (
    <BareLayout title="Observer link expired" {...(branding ? { branding } : {})}>
        <div class="min-h-screen flex items-center justify-center p-6 bg-slate-50">
            <div class="max-w-md text-center space-y-3 p-6 bg-white rounded-md shadow border border-slate-200">
                <div class="text-4xl">⏳</div>
                <h1 class="text-2xl font-bold">Observer link expired</h1>
                <p class="text-sm text-slate-500">
                    This live-view link is no longer valid. Ask the inspector to send a new one.
                </p>
            </div>
        </div>
    </BareLayout>
);
