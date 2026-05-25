/**
 * Design System 0520 subsystem C phase 6 — GuestInviteService.
 *
 * mint(tenantId, …)  → { token, url, expiresAt }
 * claim(token, identity, ctx) → ok | expired | claimed | not_found |
 *                                 over_quota | invalid
 *
 * Per the simplified seat-quota model: guests count against the same
 * tenants.max_users cap as permanent members — no separate per-guest
 * billing. The service rejects with `over_quota` when the tenant is at
 * cap so the route can surface 402 + upgradeUrl.
 *
 * `maxUsers` is passed in via the ClaimContext rather than read from
 * a portal column — core's tenants table doesn't carry it; the value
 * arrives via the existing portal → core M2M sync (subsystem C P8).
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { guestInvites, users } from '../lib/db/schema';
import { hashPassword } from '../lib/password';
import { generateRandomToken } from '../lib/random-token';
import { computeSeatsUsed } from '../lib/middleware/seat-guard';

const DEFAULT_DURATION_SECONDS = 86_400;
const MIN_PASSWORD_LENGTH      = 8;

export interface MintInput {
    role:            'lead' | 'specialist' | 'apprentice' | 'office';
    durationSeconds?: number;
    createdBy:       string;
}

export interface ClaimIdentity {
    name:     string;
    email:    string;
    password: string;
}

export interface ClaimContext {
    /** Tenant's seat quota — passed in by the route via portal M2M sync. */
    maxUsers: number;
}

export type ClaimResult =
    | { kind: 'ok';         userId: string }
    | { kind: 'expired' }
    | { kind: 'claimed' }
    | { kind: 'not_found' }
    | { kind: 'over_quota'; upgradeUrl?: string }
    | { kind: 'invalid';    reason: string };

export class GuestInviteService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async mint(tenantId: string, input: MintInput): Promise<{
        id:        string;
        token:     string;
        url:       string;
        expiresAt: number;
    }> {
        const db        = this.getDrizzle();
        const id        = crypto.randomUUID();
        const token     = generateRandomToken();
        const duration  = input.durationSeconds ?? DEFAULT_DURATION_SECONDS;
        const expiresAt = Math.floor(Date.now() / 1000) + duration;

        await db.insert(guestInvites).values({
            id,
            tenantId,
            token,
            role:            input.role,
            durationSeconds: duration,
            expiresAt,
            createdBy:       input.createdBy,
            createdAt:       new Date().toISOString(),
        });

        const url = `${globalThis.location?.origin ?? ''}/guest-join?token=${token}`;
        return { id, token, url, expiresAt };
    }

    /**
     * Anonymous token claim. On success creates a `users` row carrying
     * role + expires_at + the claim-time tenantId. Idempotent: a second
     * claim of the same token returns `claimed`.
     */
    async claim(token: string, identity: ClaimIdentity, ctx: ClaimContext): Promise<ClaimResult> {
        if (!identity.password || identity.password.length < MIN_PASSWORD_LENGTH) {
            return { kind: 'invalid', reason: `password must be at least ${MIN_PASSWORD_LENGTH} chars` };
        }

        const db     = this.getDrizzle();
        const invite = await db.select().from(guestInvites).where(eq(guestInvites.token, token)).get();
        if (!invite) return { kind: 'not_found' };
        if (invite.claimedByUserId) return { kind: 'claimed' };
        if (invite.expiresAt < Math.floor(Date.now() / 1000)) return { kind: 'expired' };

        // Quota check — defer to the shared computeSeatsUsed helper so
        // permanent members + active guests are counted the same way
        // here, in the seat-guard middleware, and on the billing summary.
        const tenantUsers = await db.select({ id: users.id, expiresAt: users.expiresAt })
            .from(users)
            .where(eq(users.tenantId, invite.tenantId))
            .all();
        const used = computeSeatsUsed(tenantUsers, Math.floor(Date.now() / 1000));
        if (used >= ctx.maxUsers) {
            return { kind: 'over_quota' };
        }

        // Create user.
        const userId       = crypto.randomUUID();
        const passwordHash = await hashPassword(identity.password);
        await db.insert(users).values({
            id:           userId,
            tenantId:     invite.tenantId,
            email:        identity.email,
            passwordHash,
            name:         identity.name,
            role:         invite.role,
            expiresAt:    invite.expiresAt,
            createdAt:    new Date(),
        });

        // Mark invite as claimed.
        await db.update(guestInvites).set({
            claimedByUserId: userId,
            claimedAt:       Math.floor(Date.now() / 1000),
        }).where(eq(guestInvites.id, invite.id));

        return { kind: 'ok', userId };
    }

    async list(tenantId: string) {
        const db = this.getDrizzle();
        return await db.select().from(guestInvites).where(eq(guestInvites.tenantId, tenantId)).all();
    }
}
