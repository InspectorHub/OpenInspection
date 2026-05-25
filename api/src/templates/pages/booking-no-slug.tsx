import { BareLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props {
    branding?: BrandingConfig | undefined;
}

/**
 * Booking #7 Sprint A — soft landing for the slug-less `/book` URL.
 *
 * Replaces the old "first-inspector-wins" booking page so an unknown
 * customer can no longer accidentally book a random inspector. Asks the
 * customer to use the personal link their inspector shared.
 */
export const BookingNoSlugLandingPage = ({ branding }: Props): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <BareLayout title={`Use your inspector’s booking link | ${siteName}`} branding={branding}>
            <div class="min-h-screen flex items-center justify-center px-4 bg-surface-50">
                <div class="max-w-md text-center space-y-4">
                    <h1 class="text-2xl font-bold text-ink-900">Use your inspector’s link</h1>
                    <p class="text-sm text-ink-600">
                        Inspectors share their personal booking link with customers. Ask your inspector for theirs.
                    </p>
                    <p class="text-xs text-ink-400">{siteName}</p>
                </div>
            </div>
        </BareLayout>
    );
};
