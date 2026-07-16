export type HolidayRegion = 'US' | `US-${string}`;

export type HolidayPublicPolicy = 'open' | 'block' | 'advisory';

export type HolidayInternalPolicy = 'advisory' | 'block';

export type HolidayEffect = 'none' | 'block' | 'advisory';

export interface TenantHolidayConfig {
    holidayRegion: HolidayRegion | null;
    holidayPublicPolicy: HolidayPublicPolicy;
    holidayInternalPolicy: HolidayInternalPolicy;
}

export interface TenantCustomHoliday {
    id: string;
    tenantId: string;
    date: string;
    name: string;
}

export interface HolidayEntry {
    date: string;
    name: string;
}
