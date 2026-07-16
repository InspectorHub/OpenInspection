/**
 * Load tenant booking slot-grid options from tenant_configs.
 * Defaults: fixed / 30 (matches schema defaults and legacy grid behavior).
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';
import type {
    BookingSlotIntervalMin,
    BookingSlotMode,
    BuildSlotGridOptions,
} from './slot-grid';

const SLOT_INTERVALS = new Set<number>([15, 30, 60]);

function normalizeSlotInterval(value: number | null | undefined): BookingSlotIntervalMin {
    return SLOT_INTERVALS.has(value ?? -1) ? (value as BookingSlotIntervalMin) : 30;
}

export async function loadSlotGridOptions(
    d1: D1Database,
    tenantId: string,
): Promise<BuildSlotGridOptions> {
    const db = drizzle(d1);
    const row = await db
        .select({
            bookingSlotMode: tenantConfigs.bookingSlotMode,
            bookingSlotIntervalMin: tenantConfigs.bookingSlotIntervalMin,
        })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();
    const mode: BookingSlotMode = row?.bookingSlotMode === 'open' ? 'open' : 'fixed';
    return {
        mode,
        intervalMin: normalizeSlotInterval(row?.bookingSlotIntervalMin),
    };
}
