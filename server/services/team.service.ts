import { drizzle } from 'drizzle-orm/d1';
import { users, tenantInvites, tenants } from '../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { UserRole } from '../types/auth';
import { Errors } from '../lib/errors';
import type { UserSyncOutbox } from '../lib/integration/user-sync';

export class TeamService {
    /**
     * @param outbox Optional core->portal user-sync sink (SaaS-only; wired in
     *   di.ts when the portal binding is present, undefined in standalone). Used
     *   to emit `user.deleted` when a member is removed so the portal identity's
     *   membership for this workspace is dropped. Guarded by `if (this.outbox)`,
     *   so standalone never touches portal code.
     */
    constructor(private db: D1Database, private outbox?: UserSyncOutbox) {}

    private getDB() {
        return drizzle(this.db);
    }

    async getMembers(tenantId: string) {
        const db = this.getDB();
        const [activeUsers, pendingInvites, tenantRecord] = await Promise.all([
            db.select({
                id: users.id,
                email: users.email,
                role: users.role,
                createdAt: users.createdAt
            }).from(users).where(eq(users.tenantId, tenantId)),
            db.select().from(tenantInvites)
                .where(and(eq(tenantInvites.tenantId, tenantId), eq(tenantInvites.status, 'pending'))),
            db.select({ maxUsers: tenants.maxUsers })
                .from(tenants).where(eq(tenants.id, tenantId)).limit(1),
        ]);

        const maxUsers = tenantRecord[0]?.maxUsers ?? 3;
        return { activeUsers, pendingInvites, maxUsers };
    }

    async createInvite(params: {
        tenantId: string;
        email: string;
        role: UserRole;
        /** Required when `role === 'apprentice'`. Must be a user in the
         *  same tenant. Replayed onto users.mentor_id at accept time. */
        mentorId?: string;
        /** Used when `role === 'specialist'`. Stored as JSON; replayed
         *  onto users.assigned_section_ids at accept time. Defaults to
         *  an empty array for non-specialist roles. */
        assignedSectionIds?: string[];
    }) {
        const db = this.getDB();

        // Subsystem C P5 — apprentice MUST have a mentor in the same
        // tenant; the queue routing in InspectionService.patchItem
        // refuses to enqueue without it.
        if (params.role === 'apprentice') {
            if (!params.mentorId) throw Errors.BadRequest('Mentor required for apprentice invites');
            const mentor = await db.select({ id: users.id }).from(users)
                .where(and(eq(users.id, params.mentorId), eq(users.tenantId, params.tenantId)))
                .limit(1);
            if (mentor.length === 0) throw Errors.BadRequest('Mentor must be a member of the same team');
        }

        // Seat-quota enforcement now lives in features/seat-quota/middleware
        // (mounted on POST /api/team/invite). The service only needs to
        // verify the invitee is not already a workspace member.
        const existing = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.tenantId, params.tenantId), eq(users.email, params.email))).limit(1);

        if (existing.length > 0) throw Errors.Conflict('User is already a member');

        // Create Invite (7-day expiry)
        const inviteToken = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(tenantInvites).values({
            id: inviteToken,
            tenantId: params.tenantId,
            email: params.email,
            role: params.role,
            status: 'pending',
            expiresAt,
            ...(params.mentorId ? { mentorId: params.mentorId } : {}),
            assignedSectionIds: JSON.stringify(params.assignedSectionIds ?? []),
        });

        return { token: inviteToken, expiresAt };
    }

    async removeMember(tenantId: string, userId: string, requesterId: string) {
        if (userId === requesterId) {
            throw Errors.BadRequest('Cannot remove yourself');
        }
        const db = this.getDB();
        const user = await db.select({ id: users.id, email: users.email, role: users.role }).from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
            .get();
        if (!user) throw Errors.NotFound('Member not found');

        await db.delete(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

        // Mirror the removal to portal so the matching identity loses its
        // membership for this workspace. Email is captured from the row read
        // above (before the delete). SaaS-only — no-op when outbox is undefined.
        if (this.outbox) {
            await this.outbox.append({
                type: 'user.deleted',
                payload: { tenantId, email: user.email },
            });
        }
        return user;
    }

}
