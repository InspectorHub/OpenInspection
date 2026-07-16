import type {
    HolidayEffect,
    HolidayInternalPolicy,
    HolidayPublicPolicy,
    TenantHolidayConfig,
} from './types';

/**
 * Public `/book` effect for a civil date given catalog membership.
 * Region null / date not in catalog → none. Policy `open` ignores catalog.
 */
export function getHolidayPublicEffect(
    config: Pick<TenantHolidayConfig, 'holidayRegion' | 'holidayPublicPolicy'>,
    civilDate: string,
    catalog: Map<string, string>,
): HolidayEffect {
    if (!config.holidayRegion) return 'none';
    if (!catalog.has(civilDate)) return 'none';
    if (config.holidayPublicPolicy === 'open') return 'none';
    return config.holidayPublicPolicy;
}

/**
 * Internal wizard / reschedule effect for a civil date.
 * No `open` option — advisory | block only.
 */
export function getHolidayInternalEffect(
    config: Pick<TenantHolidayConfig, 'holidayRegion' | 'holidayInternalPolicy'>,
    civilDate: string,
    catalog: Map<string, string>,
): HolidayEffect {
    if (!config.holidayRegion) return 'none';
    if (!catalog.has(civilDate)) return 'none';
    return config.holidayInternalPolicy;
}

export function defaultPoliciesOnFirstEnable(): {
    holidayPublicPolicy: HolidayPublicPolicy;
    holidayInternalPolicy: HolidayInternalPolicy;
} {
    return {
        holidayPublicPolicy: 'block',
        holidayInternalPolicy: 'advisory',
    };
}
