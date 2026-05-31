import type { FC } from 'hono/jsx';
import type { SeatUsage } from './usage';

interface SeatBannerProps {
    usage: SeatUsage;
    billingPortalUrl: string | null;
}

/**
 * Tenant-facing seat-quota status banner.
 *
 * Renders nothing on profiles that lack seat enforcement (signalled by
 * `usage.max === null`) and stays quiet while the tenant has headroom
 * (`remaining > 1`). At `remaining === 1` it shows an amber soft-warning
 * with an "Add seats" link; at `remaining === 0` it shows a red hard-block
 * with an "Upgrade plan" CTA. The link target is the deployment profile's
 * `billingPortalUrl` (portal-side seat-upgrade flow); when null the CTA is
 * suppressed and the banner still informs the user.
 *
 * This component is purely a UX signal — actual enforcement lives in the
 * `requireSeatAvailable` middleware.
 */
export const SeatBanner: FC<SeatBannerProps> = ({ usage, billingPortalUrl }) => {
    if (usage.max === null) return null;
    if (usage.remaining > 1) return null;

    if (usage.remaining === 0) {
        return (
            <div class="bg-red-50 border-l-4 border-red-400 p-4 mb-4" role="alert">
                <div class="flex items-start">
                    <div class="ml-3 flex-1">
                        <p class="text-sm text-red-700 font-medium">
                            Seat limit reached — {usage.used} of {usage.max} seats in use.
                        </p>
                        <p class="text-sm text-red-700 mt-1">
                            New invitations are blocked until you upgrade your plan.
                        </p>
                    </div>
                    {billingPortalUrl ? (
                        <a
                            href={billingPortalUrl}
                            class="ml-3 inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded text-white bg-red-600 hover:bg-red-700"
                        >
                            Upgrade plan
                        </a>
                    ) : null}
                </div>
            </div>
        );
    }

    // remaining === 1 → soft warning
    return (
        <div class="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4" role="status">
            <div class="flex items-start">
                <div class="ml-3 flex-1">
                    <p class="text-sm text-amber-700">
                        1 seat remaining — {usage.used} of {usage.max} seats in use.
                    </p>
                </div>
                {billingPortalUrl ? (
                    <a
                        href={billingPortalUrl}
                        class="ml-3 inline-flex items-center text-sm font-medium text-amber-700 underline hover:text-amber-900"
                    >
                        Add seats
                    </a>
                ) : null}
            </div>
        </div>
    );
};
