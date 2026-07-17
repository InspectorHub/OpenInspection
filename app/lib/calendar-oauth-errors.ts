/**
 * User-facing copy for Google Calendar OAuth failures.
 * Raw provider codes (e.g. access_denied) must not reach the UI.
 */
import { m } from "~/paraglide/messages";

export interface CalendarOAuthToast {
    message: string;
    variant: 'neutral' | 'error' | 'warning';
}

// Built at call time (never frozen at import) so each message resolves the
// active locale through the paraglide message functions.
function friendly(): Record<string, CalendarOAuthToast> {
    return {
        access_denied: {
            message: m.helper_caloauth_cancelled(),
            variant: 'neutral',
        },
        interaction_required: {
            message: m.helper_caloauth_interaction_required(),
            variant: 'warning',
        },
        login_required: {
            message: m.helper_caloauth_login_required(),
            variant: 'warning',
        },
        consent_required: {
            message: m.helper_caloauth_consent_required(),
            variant: 'warning',
        },
    };
}

export function calendarOAuthErrorToast(raw: string): CalendarOAuthToast {
    const key = raw.trim().toLowerCase();
    const known = friendly()[key];
    if (known) return known;

    if (key.includes('expired') || key.includes('invalid')) {
        return {
            message: m.helper_caloauth_session_expired(),
            variant: 'warning',
        };
    }
    if (key.includes('not configured')) {
        return {
            message: m.helper_caloauth_not_configured(),
            variant: 'error',
        };
    }
    if (key.includes('refresh token')) {
        return {
            message: m.helper_caloauth_no_refresh_token(),
            variant: 'error',
        };
    }
    if (key.includes('exchange') || key.includes('token')) {
        return {
            message: m.helper_caloauth_exchange_failed(),
            variant: 'error',
        };
    }

    return {
        message: m.helper_caloauth_generic(),
        variant: 'error',
    };
}
