/**
 * Rating Systems — placeholder page for the Library subnav slot.
 *
 * Sprint 1 Sub-spec B Task 2 Step 5. Real implementation lands in Sprint 2
 * (TREC 4-level / ITB 9-level / custom rating systems).
 */

import { MainLayout } from '../layouts/main-layout';
import { PageHeader } from '../components/page-header';
import type { BrandingConfig } from '../../types/auth';

export const RatingSystemsStubPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Rating Systems`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                <PageHeader
                    eyebrow="LIBRARY"
                    eyebrowColor="slate"
                    title="Rating Systems"
                    breadcrumb={[{ label: 'Library', href: '/templates' }, { label: 'Rating Systems' }]}
                    meta="Multiple rating systems (TREC 4-level, ITB 9-level, custom) ship in Sprint 2."
                />
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
                    <h2 class="text-[18px] font-semibold tracking-tight text-slate-700">Coming in Sprint 2</h2>
                    <p class="text-[13px] text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                        Until then, your inspections use the default 4-level rating: Satisfactory ·
                        Monitor · Defect · Not Inspected · Not Present.
                    </p>
                </div>
            </div>
        </MainLayout>
    );
};
