/**
 * User-facing copy for Google Calendar OAuth failures.
 * Raw provider codes (e.g. access_denied) must not reach the UI.
 */

export interface CalendarOAuthToast {
    message: string;
    variant: 'neutral' | 'error' | 'warning';
}

const FRIENDLY: Record<string, CalendarOAuthToast> = {
    access_denied: {
        message: 'Google Calendar connection was cancelled.',
        variant: 'neutral',
    },
    interaction_required: {
        message: 'Google sign-in needs another step. Please try connecting again.',
        variant: 'warning',
    },
    login_required: {
        message: 'Google sign-in session expired. Please try connecting again.',
        variant: 'warning',
    },
    consent_required: {
        message: 'Google needs permission confirmation. Please try connecting again.',
        variant: 'warning',
    },
};

export function calendarOAuthErrorToast(raw: string): CalendarOAuthToast {
    const key = raw.trim().toLowerCase();
    const known = FRIENDLY[key];
    if (known) return known;

    if (key.includes('expired') || key.includes('invalid')) {
        return {
            message: 'The connection session expired. Please try again.',
            variant: 'warning',
        };
    }
    if (key.includes('not configured')) {
        return {
            message: 'Google Calendar is not configured for this workspace. Contact your administrator.',
            variant: 'error',
        };
    }
    if (key.includes('refresh token')) {
        return {
            message: 'Google did not grant ongoing access. Try connecting again and approve all permissions.',
            variant: 'error',
        };
    }
    if (key.includes('exchange') || key.includes('token')) {
        return {
            message: 'Could not complete Google Calendar authorization. Please try again.',
            variant: 'error',
        };
    }

    return {
        message: 'Could not connect Google Calendar. Please try again.',
        variant: 'error',
    };
}
