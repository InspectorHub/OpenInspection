import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    CALENDAR_OAUTH_MESSAGE,
    listenCalendarOAuthPopup,
    openCalendarOAuthPopup,
    CALENDAR_OAUTH_POPUP_NAME,
} from './calendar-oauth-popup';

describe('calendar-oauth-popup', () => {
    beforeEach(() => {
        vi.stubGlobal('open', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('openCalendarOAuthPopup uses a named popup window', () => {
        const openMock = vi.mocked(window.open);
        openMock.mockReturnValue({} as Window);
        openCalendarOAuthPopup('/api/calendar/connect?capability=events_read_write&provider=google');
        expect(openMock).toHaveBeenCalledWith(
            '/api/calendar/connect?capability=events_read_write&provider=google',
            CALENDAR_OAUTH_POPUP_NAME,
            expect.stringContaining('popup=yes'),
        );
    });

    it('listenCalendarOAuthPopup invokes onConnected for same-origin connected message', () => {
        const onConnected = vi.fn();
        const onError = vi.fn();
        const cleanup = listenCalendarOAuthPopup({ onConnected, onError });

        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: { type: CALENDAR_OAUTH_MESSAGE.CONNECTED },
        }));

        expect(onConnected).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        cleanup();
    });

    it('listenCalendarOAuthPopup ignores foreign origins', () => {
        const onConnected = vi.fn();
        const cleanup = listenCalendarOAuthPopup({ onConnected, onError: vi.fn() });

        window.dispatchEvent(new MessageEvent('message', {
            origin: 'https://evil.example',
            data: { type: CALENDAR_OAUTH_MESSAGE.CONNECTED },
        }));

        expect(onConnected).not.toHaveBeenCalled();
        cleanup();
    });

    it('listenCalendarOAuthPopup invokes onError for error payload', () => {
        const onError = vi.fn();
        const cleanup = listenCalendarOAuthPopup({ onConnected: vi.fn(), onError });

        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: { type: CALENDAR_OAUTH_MESSAGE.ERROR, error: 'access_denied' },
        }));

        expect(onError).toHaveBeenCalledWith('access_denied');
        cleanup();
    });
});
