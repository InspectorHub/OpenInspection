import {
    CALENDAR_OAUTH_MESSAGE,
    type CalendarOAuthPopupPayload,
} from '../../server/lib/calendar/oauth-popup-landing';

export { CALENDAR_OAUTH_MESSAGE };

export const CALENDAR_OAUTH_POPUP_NAME = 'oi-google-calendar-oauth';

const POPUP_FEATURES = 'popup=yes,width=520,height=720';

export function openCalendarOAuthPopup(connectUrl: string): Window | null {
    if (typeof window === 'undefined') return null;
    return window.open(connectUrl, CALENDAR_OAUTH_POPUP_NAME, POPUP_FEATURES);
}

function isCalendarOAuthPayload(data: unknown): data is CalendarOAuthPopupPayload {
    if (!data || typeof data !== 'object') return false;
    const type = (data as { type?: unknown }).type;
    return type === CALENDAR_OAUTH_MESSAGE.CONNECTED || type === CALENDAR_OAUTH_MESSAGE.ERROR;
}

export interface CalendarOAuthPopupListeners {
    onConnected: () => void;
    onError: (message: string) => void;
}

/**
 * Listen for postMessage from the OAuth popup callback landing page.
 * Caller must attach while the popup flow is in flight.
 */
export function listenCalendarOAuthPopup(listeners: CalendarOAuthPopupListeners): () => void {
    const handler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (!isCalendarOAuthPayload(event.data)) return;

        if (event.data.type === CALENDAR_OAUTH_MESSAGE.CONNECTED) {
            listeners.onConnected();
            return;
        }
        listeners.onError(event.data.error || 'Google Calendar connection failed.');
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
}
