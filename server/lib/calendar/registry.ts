import type { CalendarProvider, CalendarProviderId } from './provider';
import { googleCalendarProvider } from './google';
import { appleCalendarProvider } from './caldav/apple';

const REGISTRY: Partial<Record<CalendarProviderId, CalendarProvider>> = {
    google: googleCalendarProvider,
    apple: appleCalendarProvider,
};

/**
 * The implementation for one provider id. The id is REQUIRED: a default of
 * `'google'` is the same bug as a literal at the call site, only harder to
 * grep for, and every caller now has a connection row that names its own.
 */
export function getCalendarProvider(provider: CalendarProviderId): CalendarProvider {
    const impl = REGISTRY[provider];
    if (!impl) throw new Error(`Calendar provider not implemented: ${provider}`);
    return impl;
}
