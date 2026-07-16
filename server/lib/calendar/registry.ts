import type { CalendarProvider, CalendarProviderId } from './provider';
import { googleCalendarProvider } from './google';

const REGISTRY: Partial<Record<CalendarProviderId, CalendarProvider>> = {
    google: googleCalendarProvider,
};

export function getCalendarProvider(provider: CalendarProviderId = 'google'): CalendarProvider {
    const impl = REGISTRY[provider];
    if (!impl) throw new Error(`Calendar provider not implemented: ${provider}`);
    return impl;
}
