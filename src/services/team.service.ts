import { drizzle } from 'drizzle-orm/d1';
import { users, tenantInvites, tenants } from '../lib/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { UserRole } from '../types/auth';
import { Errors } from '../lib/errors';

export class TeamService {
    constructor(private db: D1Database, private env?: { RESEND_API_KEY?: string; SENDER_EMAIL?: string; APP_NAME?: string; APP_MODE?: string }) {}

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
    }) {
        const db = this.getDB();

        // 1. Quota Check (skipped in standalone/self-hosted mode — no seat limits)
        if (this.env?.APP_MODE !== 'standalone') {
            const tenantRecord = await db.select({ maxUsers: tenants.maxUsers })
                .from(tenants).where(eq(tenants.id, params.tenantId)).limit(1);
            const maxUsers = tenantRecord[0]?.maxUsers ?? 3;

            const currentUsersCount = await db.select({ value: count() }).from(users).where(eq(users.tenantId, params.tenantId));
            const pendingCount = await db.select({ value: count() }).from(tenantInvites)
                .where(and(eq(tenantInvites.tenantId, params.tenantId), eq(tenantInvites.status, 'pending')));

            const total = (currentUsersCount[0]?.value ?? 0) + (pendingCount[0]?.value ?? 0);
            if (total >= maxUsers) {
                throw Errors.Forbidden(`Seat limit reached (${maxUsers}). Request more seats from your workspace dashboard.`);
            }
        }

        // 2. Check if already a member
        const existing = await db.select().from(users)
            .where(and(eq(users.tenantId, params.tenantId), eq(users.email, params.email))).limit(1);
        if (existing.length > 0) throw Errors.Conflict('User is already a member');

        // 3. Create Invite (7-day expiry)
        const inviteToken = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(tenantInvites).values({
            id: inviteToken,
            tenantId: params.tenantId,
            email: params.email,
            role: params.role,
            status: 'pending',
            expiresAt,
        });

        return { token: inviteToken, expiresAt };
    }

    async removeMember(tenantId: string, userId: string, requesterId: string) {
        if (userId === requesterId) {
            throw Errors.BadRequest('Cannot remove yourself');
        }
        const db = this.getDB();
        const user = await db.select().from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
            .get();
        if (!user) throw Errors.NotFound('Member not found');

        await db.delete(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
        return user;
    }

    async sendInviteEmail(to: string, inviteLink: string) {
        const { RESEND_API_KEY, SENDER_EMAIL, APP_NAME = 'OpenInspection' } = this.env ?? {};
        if (!RESEND_API_KEY) return;

        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
                from: SENDER_EMAIL || 'noreply@example.com',
                to: [to],
                subject: `Workspace Invitation - ${APP_NAME}`,
                html: `<p>You've been invited to join a workspace on ${APP_NAME}! Accept here: <a href="${inviteLink}">${inviteLink}</a></p><p>This link expires in 7 days.</p>`,
            }),
        });
    }
}
