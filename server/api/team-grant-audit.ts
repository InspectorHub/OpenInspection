import type { Context } from 'hono';
import { isCeilingRefusal } from '../lib/auth/grant-ceiling';
import { auditFromContext } from '../lib/audit';
import { capabilitiesFor } from '../lib/middleware/require-capability';
import { assertSeatForRoleChange } from '../features/seat-quota/role-change-guard';
import type { UpdateMemberSchema } from '../lib/validations/admin.schema';
import type { HonoConfig } from '../types/hono';
import type { z } from '@hono/zod-openapi';

/**
 * Runs a team write and, when the grant ceiling refuses it, records the refusal
 * before the error goes on to the caller. A refused attempt to hand out more than
 * you hold is exactly the event an owner would want to find later, and it leaves
 * no other trace: nothing was written.
 *
 * Metadata is the refusal code and the role asked for. The capability names are
 * not copied in; the code says which rule fired and the request is the rest.
 */
export async function auditRefusedGrant<T>(
    c: Context<HonoConfig>,
    action: 'invite' | 'update',
    requestedRole: string | null,
    run: () => Promise<T>,
): Promise<T> {
    try {
        return await run();
    } catch (err) {
        if (isCeilingRefusal(err)) {
            auditFromContext(c, 'user.grant_refused', 'user', {
                metadata: { reason: err.code, role: requestedRole ?? 'unchanged', during: action },
            });
        }
        throw err;
    }
}

/**
 * Applies a member edit for PATCH /api/team/members/:id and records it.
 *
 * Order matters: the grant ceiling (inside `updateMember`) runs first, and the
 * seat check rides `beforeWrite`, which only runs once the ceiling has passed.
 * A caller who may not make the change is therefore refused as such and never
 * learns how many seats the company has left.
 *
 * An edit that leaves effective access exactly as it was writes nothing and
 * records nothing. When something did change, the record names the capabilities
 * that moved, never their values.
 */
export async function updateMemberAudited(
    c: Context<HonoConfig>,
    memberId: string,
    body: z.infer<typeof UpdateMemberSchema>,
): Promise<void> {
    const tenantId = c.get('tenantId');
    const requesterCapabilities = await capabilitiesFor(c);
    const result = await auditRefusedGrant(c, 'update', body.role ?? null, () => c.var.services.team.updateMember({
        tenantId, userId: memberId, requesterId: c.get('user')?.sub as string, requesterRole: c.get('userRole'), requesterCapabilities,
        ...(body.role ? { role: body.role } : {}),
        ...(body.permissionOverrides !== undefined ? { permissionOverrides: body.permissionOverrides } : {}),
        beforeWrite: async () => {
            if (!body.role) return;
            await assertSeatForRoleChange({
                tenantId, userId: memberId, nextRole: body.role, db: c.env.DB,
                seatQuota: { enforce: c.var.profile.hasSeatQuota, billingPortalUrl: c.var.profile.billingPortalUrl },
            });
        },
    }));
    if (result.changed) {
        auditFromContext(c, 'user.update', 'user', {
            entityId: memberId,
            metadata: { role: result.role, capabilitiesChanged: result.capabilitiesChanged },
        });
    }
}
