import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

/**
 * Iter-2 soft-error pages — Friendly disabled-feature page.
 *
 * Replaces the generic `NotFoundPage` 404 that Track E1 (repair-list) and
 * Sprint 3 S3-2 (customer repair-request) used to return when the per-tenant
 * toggle was off. The customer/admin should be told WHY the page is
 * unavailable, not handed a "Page not found" dead end.
 *
 * Layout matches `not-found.tsx` for visual consistency:
 *  - slate canvas (calm, "not your fault" vibe)
 *  - 22px section heading + 14px slate-500 body
 *  - optional indigo CTA button
 *  - no atmospheric blob, no glass-panel
 *
 * `from` keys:
 *   `repair-list`               — admin/inspector deep-linked when tenant
 *                                 `enable_repair_list = false`. CTA points
 *                                 to the settings anchor that holds the
 *                                 toggle.
 *   `customer-repair-request`   — customer deep-linked when tenant
 *                                 `enable_customer_repair_export = false`.
 *                                 No CTA — customer can't enable it
 *                                 themselves; copy invites them to contact
 *                                 the inspector.
 *   (anything else)             — generic friendly fallback.
 */
type DisabledKey = 'repair-list' | 'customer-repair-request';

interface DisabledContext {
    title: string;
    body:  string;
    cta?:  { label: string; href: string };
}

interface FeatureDisabledPageProps {
    branding?: BrandingConfig | undefined;
    /** Variant key — drives copy + CTA. Unknown values fall back to generic. */
    from?:     string | undefined;
}

const CONTEXT_MESSAGES: Record<DisabledKey, DisabledContext> = {
    'repair-list': {
        title: 'Repair List is disabled',
        body:  'Tenant administrators can enable Repair List in Settings → Workspace → Reports.',
        cta:   { label: 'Go to settings', href: '/settings/workspace/reports#repair-list' },
    },
    'customer-repair-request': {
        title: 'Repair request unavailable',
        body:  "Your inspector hasn't enabled the customer repair-request export. Please contact them to request a printable defect list.",
    },
};

const DEFAULT_CONTEXT: DisabledContext = {
    title: 'Feature unavailable',
    body:  'This feature is not currently enabled for your workspace.',
};

function resolveContext(from?: string): DisabledContext {
    if (from && from in CONTEXT_MESSAGES) {
        return CONTEXT_MESSAGES[from as DisabledKey];
    }
    return DEFAULT_CONTEXT;
}

export const FeatureDisabledPage = (props: FeatureDisabledPageProps = {}): JSX.Element => {
    const { branding, from } = props;
    const siteName = branding?.siteName || 'OpenInspection';
    const ctx = resolveContext(from);

    return (
        <BareLayout title={`${siteName} | ${ctx.title}`} branding={branding}>
            <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
                <div class="max-w-md w-full text-center space-y-6">
                    {branding?.logoUrl && (
                        <img src={branding.logoUrl} alt={siteName} class="h-10 mx-auto opacity-80" />
                    )}
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 text-slate-400 mx-auto">
                        {/* Lock icon — communicates "gated by config", not "broken". */}
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                    <div class="space-y-2">
                        <h1 class="text-[22px] font-bold tracking-tight text-slate-900">{ctx.title}</h1>
                        <p class="text-[14px] text-slate-500 leading-relaxed">{ctx.body}</p>
                    </div>
                    {ctx.cta && (
                        <a
                            href={ctx.cta.href}
                            class="inline-flex items-center justify-center h-10 px-5 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors"
                        >
                            {ctx.cta.label}
                        </a>
                    )}
                </div>
            </div>
        </BareLayout>
    );
};
