import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { holdsSeat } from '../../lib/middleware/seat-guard';
import type { SeatQuotaContext } from './join-guard';
import { getSeatUsage } from './usage';

/**
 * Throws `Errors.SeatLimitReached` (HTTP 402) when a role change would take a
 * seat that is not free.
 *
 * A member moved from a role that holds no seat (staff) to one that does holds
 * one from that moment, so the move is checked the way an invitation is. A move
 * that changes nothing about seat holding, an unenforced deployment, and a
 * member who cannot be found (the update reports that itself) are all no-ops,
 * and none of them reads usage.
 */
export async function assertSeatForRoleChange(args: {
    tenantId: string;
    userId: string;
    nextRole: string;
    db: D1Database;
    seatQuota: SeatQuotaContext;
}): Promise<void> {
    const { tenantId, userId, nextRole, db, seatQuota } = args;
    if (!seatQuota.enforce || !holdsSeat(nextRole)) return;

    const member = await drizzle(db).select({ role: users.role }).from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
        .get();
    if (!member || holdsSeat(member.role)) return;

    const usage = await getSeatUsage(tenantId, db);
    if (usage.remaining <= 0) {
        throw Errors.SeatLimitReached({
            used: usage.used,
            max: usage.max ?? 0,
            billingPortalUrl: seatQuota.billingPortalUrl,
        });
    }
}
