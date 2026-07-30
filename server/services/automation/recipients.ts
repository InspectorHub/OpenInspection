import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import type { inspections } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { PeopleService } from '../people.service';
import { capabilitiesForProfile } from '../../lib/people/capabilities';
import { STAFF_ROLE_KEY } from './shared';
import type { AutomationChannel, RecipientKind } from './shared';

export interface ResolvedRecipient {
    contactId: string;
    roleKey: string;
    email?: string;
    phone?: string;
}

/**
 * Spec 2 Task 1 — role-driven recipient resolution: returns EVERY matching
 * recipient (not just the single client address `resolveAddress` targets),
 * so a later task can send one message per recipient. Pure resolver: never
 * throws, never writes `automation_logs` (that stays the flush loop's job
 * — see `trigger()` above, untouched by this method). An addr-less person
 * is logged and skipped, not treated as an error.
 *
 * 'all' = every `receivesReport` person on the inspection's people list —
 * currently client/agent/other all set `receivesReport: true`
 * (`lib/people/capabilities.ts`), so 'all' is effectively "everyone".
 *
 * 'inspector' has no `inspection_people` row — the inspector is a `users`
 * row, not a contact — so it's resolved the same way `resolveAddress`'s
 * inspector branch does (lead falls back to assigned), not via
 * PeopleService. `contactId` on the returned recipient is therefore
 * best-effort: the inspector's user id, not a real `contacts` row id.
 */
export async function resolveRuleRecipients(
    rawDb: D1Database,
    rule: { recipientKind: RecipientKind; recipientRoleProfileId: string | null },
    inspection: typeof inspections.$inferSelect,
    channel: AutomationChannel,
): Promise<ResolvedRecipient[]> {
    if (rule.recipientKind === 'staff') {
        // B2 — the workspace's ADMIN staff: the set `createForAllAdmins`
        // names, which is the audience every hard-coded internal alert
        // B3 migrates already had. Owners and managers only: an
        // inspector is staff of the company but not an admin, and the
        // `inspector` kind already addresses the one assigned to THIS
        // inspection, which is a different question.
        //
        // Scoped to the inspection's tenant, not to `role` alone — role
        // is not unique across workspaces, and the owner of another
        // company matching a role name is precisely the leak this
        // filter exists to prevent.
        //
        // Soft-deleted users are excluded: a closed account is not a
        // recipient. (`createForAllAdmins` does not filter them, which
        // is a separate defect on the path B3 retires.)
        const { users } = await import('../../lib/db/schema');
        const { ROLE } = await import('../../lib/auth/roles');
        const db = drizzle(rawDb);
        let admins: Array<{ id: string; email: string | null; phone: string | null }>;
        try {
            admins = await db.select({ id: users.id, email: users.email, phone: users.phone })
                .from(users)
                .where(and(
                    eq(users.tenantId, inspection.tenantId),
                    inArray(users.role, [ROLE.OWNER, ROLE.MANAGER]),
                    isNull(users.deletedAt),
                ));
        } catch (err) {
            // Same never-throws contract as the branches below.
            logger.error('resolveRecipients: staff lookup failed; skipping this rule\'s recipients', {
                inspectionId: inspection.id, tenantId: inspection.tenantId, channel,
            }, err instanceof Error ? err : undefined);
            return [];
        }
        const { normalizeE164 } = await import('../../lib/sms/phone');
        const out: Array<{ contactId: string; roleKey: string; email?: string; phone?: string }> = [];
        for (const a of admins) {
            const addr = channel === 'sms' ? normalizeE164(a.phone) : a.email;
            if (!addr) continue;
            out.push({
                // `contactId` carries the USER id here, exactly as the
                // inspector branch does; `isStaffRecipient(roleKey)` is
                // what tells the header writer which side of the XOR
                // that id belongs on.
                contactId: a.id,
                roleKey: STAFF_ROLE_KEY,
                ...(channel === 'sms' ? { phone: addr } : { email: addr }),
            });
        }
        return out;
    }

    if (rule.recipientKind === 'inspector') {
        const inspectorId = inspection.leadInspectorId ?? inspection.inspectorId ?? null;
        if (!inspectorId) return [];
        const { users } = await import('../../lib/db/schema');
        const db = drizzle(rawDb);
        // Try/catch (not `.get().catch()`) — the latter only behaves as a
        // Promise against the real async D1 driver, not the synchronous
        // better-sqlite3 test driver (same posture as resolveAddress's
        // contactForRole above).
        let u: { email: string | null; phone: string | null } | null;
        try {
            u = (await db.select({ email: users.email, phone: users.phone }).from(users)
                .where(eq(users.id, inspectorId)).get()) ?? null;
        } catch {
            u = null;
        }
        // sms addresses must be normalized to E.164 here — this is the ONLY
        // path that produces automation_logs.recipient for sms (unlike
        // resolveAddress, which normalizes internally); sms.ts sends
        // log.recipient as-is with no send-time re-normalization.
        const { normalizeE164 } = await import('../../lib/sms/phone');
        const addr = channel === 'email' ? (u?.email ?? null) : normalizeE164(u?.phone ?? null);
        if (!addr) return [];
        return [{
            contactId: inspectorId ?? '',
            roleKey: 'inspector',
            ...(channel === 'email' ? { email: addr } : { phone: addr }),
        }];
    }

    // Honor the "never throws" contract (see the doc comment above): the
    // inspector branch already guards its query, but a bare listPeople()
    // here would propagate a transient D1 error out of the per-rule loop
    // in trigger(), aborting the ENTIRE fan-out for every rule/recipient
    // with no retry (publish marks status='completed' first). Fail to an
    // empty recipient set for this rule/channel instead — same posture as
    // resolveAddress/contactForRole.
    let people: Awaited<ReturnType<PeopleService['listPeople']>>;
    try {
        people = await new PeopleService({ DB: rawDb }).listPeople(inspection.tenantId, inspection.id);
    } catch (err) {
        logger.error('resolveRecipients: listPeople failed; skipping this rule\'s recipients', {
            inspectionId: inspection.id, tenantId: inspection.tenantId, channel,
        }, err instanceof Error ? err : undefined);
        return [];
    }
    const targets = rule.recipientKind === 'role'
        ? people.filter(p => p.roleProfileId === rule.recipientRoleProfileId)
        : people.filter(p => capabilitiesForProfile(p.kind, p.capabilityOverrides).receivesReport);

    const { normalizeE164 } = await import('../../lib/sms/phone');
    const out: Array<{ contactId: string; roleKey: string; email?: string; phone?: string }> = [];
    for (const p of targets) {
        const addr = channel === 'email' ? p.email : normalizeE164(p.phone);
        if (!addr) {
            logger.info('resolveRecipients: skipping addr-less person', {
                inspectionId: inspection.id, contactId: p.contactId, roleKey: p.roleKey, channel,
            });
            continue;
        }
        out.push({
            contactId: p.contactId, roleKey: p.roleKey,
            ...(channel === 'email' ? { email: addr } : { phone: addr }),
        });
    }
    return out;
}
