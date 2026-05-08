import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

/**
 * Sprint 1 Sub-spec C-2 — Calm, branded 404 page that replaces the
 * monospace `c.text('Agreement not found...')` fallback. Designed for
 * customers who hit an expired link — the slate canvas + slate icon
 * communicates "not your fault, here's what you can do" rather than
 * alarming red. Single optional CTA when contextually meaningful.
 *
 * Design tokens (see docs/superpowers/plans/2026-05-08-sprint1-design-system-reference.md):
 * - canonical 22px section heading
 * - 14px body slate-500
 * - .ih-btn--primary indigo CTA
 * - no atmospheric blob, no glass-panel, no font-black
 *
 * The `from` prop selects context-specific copy; pass `agreement-sign`,
 * `report-share`, or omit for the generic "page not found" variant.
 */
type ContextKey = 'agreement-sign' | 'report-share' | 'workspace';

interface NotFoundContext {
    title: string;
    body:  string;
    cta?:  { label: string; href: string };
}

interface NotFoundPageProps {
    branding?:    BrandingConfig | undefined;
    /** Context key — drives copy + CTA. Unknown values fall back to generic. */
    from?:        string | undefined;
    /** Backwards-compat: legacy callers passed a free-form title. */
    title?:       string | undefined;
    /** Backwards-compat: legacy callers passed a free-form message. */
    message?:     string | undefined;
    /** Setup wizard CTA — preserved from R0 not-found.tsx. */
    showSetupCTA?: boolean | undefined;
}

const CONTEXT_MESSAGES: Record<ContextKey, NotFoundContext> = {
    'agreement-sign': {
        title: 'Agreement link expired or invalid',
        body:  "Your inspector's agreement link may have expired. Please contact them for a fresh link.",
    },
    'report-share': {
        title: 'Report link expired or invalid',
        body:  'This report link is no longer valid. Reports are accessible for 30 days from delivery.',
    },
    'workspace': {
        title: 'Workspace not found',
        body:  'This workspace address does not match any active OpenInspection tenant.',
        cta:   { label: 'Go to login', href: '/login' },
    },
};

const DEFAULT_CONTEXT: NotFoundContext = {
    title: 'Page not found',
    body:  "The page you're looking for doesn't exist or has been moved.",
    cta:   { label: 'Go home', href: '/' },
};

function resolveContext(props: NotFoundPageProps): NotFoundContext {
    if (props.title || props.message) {
        return {
            title: props.title || DEFAULT_CONTEXT.title,
            body:  props.message || DEFAULT_CONTEXT.body,
        };
    }
    const key = props.from as ContextKey | undefined;
    if (key && key in CONTEXT_MESSAGES) {
        const found = CONTEXT_MESSAGES[key];
        return found;
    }
    return DEFAULT_CONTEXT;
}

export const NotFoundPage = (props: NotFoundPageProps = {}): JSX.Element => {
    const { branding, showSetupCTA } = props;
    const siteName = branding?.siteName || 'OpenInspection';
    const ctx = resolveContext(props);

    // showSetupCTA wins over the contextual CTA — this branch is only used
    // by the very first install before any tenant exists.
    const cta = showSetupCTA
        ? { label: 'Initialize workspace', href: '/setup' }
        : ctx.cta;

    return (
        <BareLayout title={`${siteName} | ${ctx.title}`} branding={branding}>
            <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
                <div class="max-w-md w-full text-center space-y-6">
                    {branding?.logoUrl && (
                        <img src={branding.logoUrl} alt={siteName} class="h-10 mx-auto opacity-80" />
                    )}
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 text-slate-400 mx-auto">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                        </svg>
                    </div>
                    <div class="space-y-2">
                        <h1 class="text-[22px] font-bold tracking-tight text-slate-900">{ctx.title}</h1>
                        <p class="text-[14px] text-slate-500 leading-relaxed">{ctx.body}</p>
                    </div>
                    {cta && (
                        <a
                            href={cta.href}
                            class="inline-flex items-center justify-center h-10 px-5 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors"
                        >
                            {cta.label}
                        </a>
                    )}
                </div>
            </div>
        </BareLayout>
    );
};
