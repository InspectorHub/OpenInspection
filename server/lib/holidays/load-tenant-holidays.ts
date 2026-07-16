import { and, eq, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { tenantConfigs, tenantCustomHolidays } from '../db/schema';
import {
    getHolidayInternalEffect,
    getHolidayPublicEffect,
} from './apply-holiday-policy';
import { resolveCompanyClosedDates, resolveCompanyClosedDatesInRange } from './resolve-closed-dates';
import type {
    HolidayEffect,
    HolidayInternalPolicy,
    HolidayPublicPolicy,
    HolidayRegion,
    TenantHolidayConfig,
} from './types';
import { parseHolidayRegion } from './resolve-closed-dates';

export async function loadTenantHolidayConfig(
    database: D1Database,
    tenantId: string,
): Promise<TenantHolidayConfig> {
    const db = drizzle(database);
    const row = await db
        .select({
            holidayRegion: tenantConfigs.holidayRegion,
            holidayPublicPolicy: tenantConfigs.holidayPublicPolicy,
            holidayInternalPolicy: tenantConfigs.holidayInternalPolicy,
        })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();

    return {
        holidayRegion: parseHolidayRegion(row?.holidayRegion ?? null),
        holidayPublicPolicy: (row?.holidayPublicPolicy as HolidayPublicPolicy | undefined) ?? 'open',
        holidayInternalPolicy: (row?.holidayInternalPolicy as HolidayInternalPolicy | undefined) ?? 'advisory',
    };
}

export async function loadCustomHolidaysForYear(
    database: D1Database,
    tenantId: string,
    year: number,
): Promise<Array<{ date: string; name: string }>> {
    const db = drizzle(database);
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    return db
        .select({
            date: tenantCustomHolidays.date,
            name: tenantCustomHolidays.name,
        })
        .from(tenantCustomHolidays)
        .where(and(
            eq(tenantCustomHolidays.tenantId, tenantId),
            gte(tenantCustomHolidays.date, start),
            lte(tenantCustomHolidays.date, end),
        ))
        .all();
}

export async function loadCustomHolidaysInRange(
    database: D1Database,
    tenantId: string,
    startDate: string,
    endDate: string,
): Promise<Array<{ date: string; name: string }>> {
    const db = drizzle(database);
    return db
        .select({
            date: tenantCustomHolidays.date,
            name: tenantCustomHolidays.name,
        })
        .from(tenantCustomHolidays)
        .where(and(
            eq(tenantCustomHolidays.tenantId, tenantId),
            gte(tenantCustomHolidays.date, startDate),
            lte(tenantCustomHolidays.date, endDate),
        ))
        .all();
}

export async function resolvePublicHolidayEffect(
    database: D1Database,
    tenantId: string,
    civilDate: string,
): Promise<{ effect: HolidayEffect; name: string | null; config: TenantHolidayConfig }> {
    const config = await loadTenantHolidayConfig(database, tenantId);
    if (!config.holidayRegion) {
        return { effect: 'none', name: null, config };
    }
    const year = Number(civilDate.slice(0, 4));
    const custom = await loadCustomHolidaysForYear(database, tenantId, year);
    const catalog = resolveCompanyClosedDates({
        region: config.holidayRegion,
        customRows: custom,
        year,
    });
    const effect = getHolidayPublicEffect(config, civilDate, catalog);
    return { effect, name: catalog.get(civilDate) ?? null, config };
}

export async function resolveInternalHolidayEffect(
    database: D1Database,
    tenantId: string,
    civilDate: string,
): Promise<{ effect: HolidayEffect; name: string | null; config: TenantHolidayConfig }> {
    const config = await loadTenantHolidayConfig(database, tenantId);
    if (!config.holidayRegion) {
        return { effect: 'none', name: null, config };
    }
    const year = Number(civilDate.slice(0, 4));
    const custom = await loadCustomHolidaysForYear(database, tenantId, year);
    const catalog = resolveCompanyClosedDates({
        region: config.holidayRegion as HolidayRegion,
        customRows: custom,
        year,
    });
    const effect = getHolidayInternalEffect(config, civilDate, catalog);
    return { effect, name: catalog.get(civilDate) ?? null, config };
}

export { resolveCompanyClosedDatesInRange };
