import type { Context } from 'hono';
import { isCeilingRefusal } from '../lib/auth/grant-ceiling';
import { auditFromContext } from '../lib/audit';
import { capabilitiesFor } from '../lib/middleware/require-capability';
import { assertSeatForRoleChange } from '../features/seat-quota/role-change-guard';
import { PermissionTemplateService, type AppliedTemplate } from '../services/team/permission-templates.service';
import { applyTemplateToRequest } from '../services/team/apply-template';
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
    action: 'invite' | 'update' | 'template',
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
    // A template, when named, is copied in first; what it stamps then goes through
    // the same ceiling and seat checks as the same role and switches typed by hand.
    const applied = body.templateId ? await new PermissionTemplateService(c.env.DB).resolveRef(tenantId, body.templateId) : null;
    const stamped = applyTemplateToRequest({ applied, requestedRole: body.role, requestedOverrides: body.permissionOverrides });
    const nextRole = stamped.role;
    const result = await auditRefusedGrant(c, 'update', nextRole ?? null, () => c.var.services.team.updateMember({
        tenantId, userId: memberId, requesterId: c.get('user')?.sub as string, requesterRole: c.get('userRole'), requesterCapabilities,
        ...(nextRole ? { role: nextRole } : {}),
        ...(stamped.overrides !== undefined ? { permissionOverrides: stamped.overrides } : {}),
        beforeWrite: async () => {
            if (!nextRole) return;
            await assertSeatForRoleChange({
                tenantId, userId: memberId, nextRole, db: c.env.DB,
                seatQuota: { enforce: c.var.profile.hasSeatQuota, billingPortalUrl: c.var.profile.billingPortalUrl },
            });
        },
    }));
    if (result.changed) {
        auditFromContext(c, 'user.update', 'user', {
            entityId: memberId,
            metadata: { role: result.role, capabilitiesChanged: result.capabilitiesChanged, ...templateAuditMeta(applied) },
        });
    }
}

/** Which template an invite or edit started from: the key of a built-in one, the id of a company one. Never a person's details. */
export function templateAuditMeta(applied: AppliedTemplate | null): Record<string, string> {
    if (!applied) return {};
    return applied.system ? { templateKey: applied.ref } : { templateId: applied.ref };
}
