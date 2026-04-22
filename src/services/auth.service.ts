import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users, tenantInvites } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { hashPassword, verifyPassword } from '../lib/password';
import { logger } from '../lib/logger';

/** Dummy PBKDF2 hash used to equalize verify() timing when the email lookup misses. */
const DUMMY_HASH = 'pbkdf2:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Service to handle all authentication-related business logic.
 * Decouples database operations from the HTTP routing layer.
 */
export class AuthService {
    constructor(private db: D1Database, private kv?: KVNamespace) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /** Write a session-invalidation marker for a user. Safe to call during DB mutations. */
    private async writeInvalidation(userId: string) {
        if (!this.kv) return;
        const ts = Math.floor(Date.now() / 1000).toString();
        try {
            await this.kv.put(`pwchanged:${userId}`, ts, { expirationTtl: 90000 });
        } catch (err) {
            logger.warn('Failed to write session-invalidation key; outstanding tokens may remain valid until exp', {
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Hashes a password using PBKDF2-SHA256. Thin wrapper retained so callers
     * that reach in via the service (e.g. the setup route) keep working.
     */
    async hashPassword(password: string): Promise<string> {
        return hashPassword(password);
    }

    /**
     * Validates a user's credentials. Lazily upgrades legacy SHA-256 hashes to PBKDF2.
     * Runs PBKDF2 even when the email is unknown to hide user-existence via timing.
     */
    async validateCredentials(email: string, password: string) {
        const db = this.getDrizzle();
        const user = await db.select().from(users).where(eq(users.email, email)).get();

        if (!user) {
            // Perform a throwaway verification against a fixed hash so the response time
            // does not leak whether the email exists.
            await verifyPassword(password, DUMMY_HASH);
            throw Errors.Unauthorized('Invalid email or password');
        }

        const [valid, needsRehash] = await verifyPassword(password, user.passwordHash);
        if (!valid) {
            throw Errors.Unauthorized('Invalid email or password');
        }

        if (needsRehash) {
            const upgraded = await hashPassword(password);
            await db.update(users).set({ passwordHash: upgraded }).where(eq(users.id, user.id));
        }

        return user;
    }

    /**
     * Updates a user's password.
     */
    async updatePassword(userId: string, currentPassword: string, newPassword: string) {
        const db = this.getDrizzle();
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        if (!user) throw Errors.NotFound('User not found');

        const [valid] = await verifyPassword(currentPassword, user.passwordHash);
        if (!valid) {
            throw Errors.Unauthorized('Current password is incorrect');
        }

        const newHash = await hashPassword(newPassword);
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
        await this.writeInvalidation(userId);
    }

    /**
     * Joins a team using an invitation token.
     */
    async joinTeam(token: string, password: string) {
        const db = this.getDrizzle();
        const invite = await db.select().from(tenantInvites).where(eq(tenantInvites.id, token)).get();

        if (!invite) throw Errors.NotFound('Invalid or expired invitation');
        if (invite.status !== 'pending') throw Errors.BadRequest('Invitation has already been used');
        if (invite.expiresAt < new Date()) throw Errors.BadRequest('Invitation has expired');

        const existing = await db.select().from(users).where(eq(users.email, invite.email)).get();
        if (existing) throw Errors.Conflict('An account with this email already exists');

        const passwordHash = await hashPassword(password);
        const userId = crypto.randomUUID();

        await db.insert(users).values({
            id: userId,
            tenantId: invite.tenantId,
            email: invite.email,
            passwordHash,
            role: invite.role,
            createdAt: new Date(),
        });

        await db.update(tenantInvites).set({ status: 'accepted' }).where(eq(tenantInvites.id, token));

        return { id: userId, email: invite.email, tenantId: invite.tenantId, role: invite.role };
    }

    /**
     * Creates a password reset token and stores it in KV.
     * Value format: "{userId}:{issuedAtUnixSec}" so we can detect tokens that predate
     * a password change and reject them even though they haven't expired yet.
     */
    async createPasswordResetToken(email: string): Promise<string | null> {
        const db = this.getDrizzle();
        const user = await db.select().from(users).where(eq(users.email, email)).get();
        if (!user || !this.kv) return null;

        const resetToken = crypto.randomUUID();
        const kvKey = `pw_reset:${resetToken}`;
        const issuedAt = Math.floor(Date.now() / 1000);
        await this.kv.put(kvKey, `${user.id}:${issuedAt}`, { expirationTtl: 3600 });
        return resetToken;
    }

    /**
     * Resets a user's password using a valid token.
     */
    async resetPassword(token: string, newPassword: string) {
        if (!this.kv) throw Errors.BadRequest('Password reset not available');

        const kvKey = `pw_reset:${token}`;
        const raw = await this.kv.get(kvKey);
        if (!raw) throw Errors.BadRequest('Invalid or expired reset token');

        // Support both legacy ("userId") and new ("userId:issuedAt") formats.
        const sepIdx = raw.indexOf(':');
        const userId = sepIdx === -1 ? raw : raw.slice(0, sepIdx);
        const issuedAt = sepIdx === -1 ? 0 : parseInt(raw.slice(sepIdx + 1), 10) || 0;

        // Reject reset tokens issued before the user's last password change.
        const invalidatedAt = await this.kv.get(`pwchanged:${userId}`);
        if (invalidatedAt && issuedAt <= parseInt(invalidatedAt, 10)) {
            await this.kv.delete(kvKey);
            throw Errors.BadRequest('Invalid or expired reset token');
        }

        const db = this.getDrizzle();
        const newHash = await hashPassword(newPassword);
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
        await this.kv.delete(kvKey);
        await this.writeInvalidation(userId);
    }

    /**
     * Invalidate all outstanding JWTs for a user. Call this from any future endpoint
     * that changes a user's role, disables them, deletes them, or on explicit logout.
     */
    async invalidateUserSessions(userId: string) {
        await this.writeInvalidation(userId);
    }
}
