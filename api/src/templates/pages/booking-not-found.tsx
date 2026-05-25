import { BareLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props {
    branding?: BrandingConfig | undefined;
    slug?: string | undefined;
}

/**
 * Booking #7 Sprint A — `/book/<slug>` resolver miss.
 *
 * Rendered with HTTP 404 when the slug does not match any user in the
 * resolved tenant. Calm-authority tone matching the public booking page.
 */
export const BookingNotFoundPage = ({ branding, slug }: Props): JSX.Element => (
    <BareLayout title="Inspector not found" branding={branding}>
        <div class="min-h-screen flex items-center justify-center px-4 bg-surface-50">
            <div class="max-w-md text-center space-y-4">
                <h1 class="text-2xl font-bold text-ink-900">Inspector not found</h1>
                <p class="text-sm text-ink-600">
                    {slug
                        ? `We couldn't find an inspector with the link "${slug}".`
                        : 'This booking link is no longer valid.'}
                </p>
                <p class="text-sm text-ink-500">
                    Please double-check the link your inspector shared, or contact them for a fresh one.
                </p>
            </div>
        </div>
    </BareLayout>
);
