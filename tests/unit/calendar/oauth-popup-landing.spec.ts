import { describe, it, expect } from 'vitest';
import {
    CALENDAR_OAUTH_MESSAGE,
    calendarOAuthFallbackUrl,
    renderCalendarOAuthPopupLanding,
} from '../../../server/lib/calendar/oauth-popup-landing';

describe('oauth-popup-landing', () => {
    it('renders postMessage + close for connected payload', () => {
        const html = renderCalendarOAuthPopupLanding({
            type: CALENDAR_OAUTH_MESSAGE.CONNECTED,
        });
        expect(html).toContain(CALENDAR_OAUTH_MESSAGE.CONNECTED);
        expect(html).toContain('window.opener.postMessage');
        expect(html).toContain('window.close()');
        expect(html).toContain('/settings/communication?calendar=connected');
    });

    it('renders error payload with encoded fallback URL', () => {
        const html = renderCalendarOAuthPopupLanding({
            type: CALENDAR_OAUTH_MESSAGE.ERROR,
            error: 'access_denied',
        });
        expect(html).toContain(CALENDAR_OAUTH_MESSAGE.ERROR);
        expect(html).toContain('access_denied');
        expect(html).toContain(encodeURIComponent('access_denied'));
    });

    it('calendarOAuthFallbackUrl maps connected and error', () => {
        expect(calendarOAuthFallbackUrl({ type: CALENDAR_OAUTH_MESSAGE.CONNECTED }))
            .toBe('/settings/communication?calendar=connected');
        expect(calendarOAuthFallbackUrl({
            type: CALENDAR_OAUTH_MESSAGE.ERROR,
            error: 'denied',
        })).toBe('/settings/communication?calendar_error=denied');
    });
});
