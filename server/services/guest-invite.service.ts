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
import { guestInvites, users, tenants } from '../lib/db/schema';
import { hashPassword } from '../lib/password';
import { mintToken, hashToken, deadTokenSentinel, resolveTokenRow } from '../lib/token-hash';
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
    /**
     * Whether to enforce the seat cap.  Set to `profile.hasSeatQuota` (true in
     * SaaS, false in standalone).  When false the quota check is skipped
     * entirely so self-hosted deployments are genuinely unlimited.
     */
    enforceSeatQuota: boolean;
    /** Optional terms-acceptance blob (env-gated: set only when TERMS_URL/PRIVACY_URL configured). */
    termsAccepted?: { at: string; ip?: string; country?: string; termsUrl?: string; privacyUrl?: string };
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

    /**
     * C-10 ③-B — preview metadata for the /guest-join accept page. guest_invites
     * carries no email/inspection, so the page shows the WORKSPACE + ROLE the
     * invite grants. Returns null for unknown / expired / already-claimed tokens
     * so the page renders its "link unavailable" state.
     */
    /**
     * Track I-a — resolve a presented invite token to its row. Hash-first
     * (token_hash), with a permanent legacy plaintext fallback that lazily
     * upgrades the row in place (writes token_hash, clears the plaintext to a
     * per-row sentinel). Tier-1: hash only — guest invites are short-lived and
     * single-use, so no token_enc reconstruction is needed.
     */
    private async resolveInvite(token: string): Promise<typeof guestInvites.$inferSelect | null> {
        const db = this.getDrizzle();
        return resolveTokenRow<typeof guestInvites.$inferSelect>({
            presented: token,
            byHash: async (hash) =>
                (await db.select().from(guestInvites).where(eq(guestInvites.tokenHash, hash)).get()) ?? null,
            byPlaintext: async (t) =>
                (await db.select().from(guestInvites).where(eq(guestInvites.token, t)).get()) ?? null,
            upgrade: async (legacy, hash) => {
                await db.update(guestInvites)
                    .set({ tokenHash: hash, token: deadTokenSentinel(legacy.id) })
                    .where(eq(guestInvites.id, legacy.id));
            },
        });
    }

    /**
     * Public, no-JWT pre-lookup for the /guest/claim route: resolve a presented
     * token to its tenant + seat cap WITHOUT the expired/claimed gating that
     * getInviteInfo applies (the route needs the tenant even for an expired
     * invite so claim() can return the precise error kind). Hash-first with the
     * same permanent legacy plaintext fallback + lazy upgrade. Returns null only
     * when the token matches no row.
     */
    async resolveTenantForToken(token: string): Promise<{ tenantId: string; maxUsers: number } | null> {
        const invite = await this.resolveInvite(token);
        if (!invite) return null;
        const db = this.getDrizzle();
        const tenant = await db.select({ maxUsers: tenants.maxUsers }).from(tenants)
            .where(eq(tenants.id, invite.tenantId)).get();
        if (!tenant) return null;
        return { tenantId: invite.tenantId, maxUsers: tenant.maxUsers };
    }

    async getInviteInfo(token: string): Promise<{ workspaceName: string; role: string; expiresAt: number } | null> {
        const db = this.getDrizzle();
        const invite = await this.resolveInvite(token);
        if (!invite) return null;
        if (invite.claimedByUserId) return null;
        if (invite.expiresAt < Math.floor(Date.now() / 1000)) return null;
        const tenant = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, invite.tenantId)).get();
        return { workspaceName: tenant?.name ?? '', role: invite.role, expiresAt: invite.expiresAt };
    }

    async mint(tenantId: string, input: MintInput): Promise<{
        id:        string;
        token:     string;
        url:       string;
        expiresAt: number;
    }> {
        const db        = this.getDrizzle();
        const id        = crypto.randomUUID();
        const token     = mintToken();
        const duration  = input.durationSeconds ?? DEFAULT_DURATION_SECONDS;
        const expiresAt = Math.floor(Date.now() / 1000) + duration;

        await db.insert(guestInvites).values({
            id,
            tenantId,
            // Never distributed — satisfies NOT NULL + UNIQUE on the legacy column.
            token:           deadTokenSentinel(id),
            tokenHash:       await hashToken(token),
            role:            input.role,
            durationSeconds: duration,
            expiresAt,
            createdBy:       input.createdBy,
            createdAt:       new Date().toISOString(),
        });

        // Workers runtime has no `location` global; this is a defensive
        // origin lookup carried over from a browser-context predecessor.
        // Use a typed cast rather than declare a global so we don't pollute
        // shared types just for one optional read.
        const loc = (globalThis as { location?: { origin?: string } }).location;
        const url = `${loc?.origin ?? ''}/guest-join?token=${token}`;
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
        const invite = await this.resolveInvite(token);
        if (!invite) return { kind: 'not_found' };
        if (invite.claimedByUserId) return { kind: 'claimed' };
        if (invite.expiresAt < Math.floor(Date.now() / 1000)) return { kind: 'expired' };

        // Quota check — only enforced when ctx.enforceSeatQuota is true (SaaS).
        // Standalone deployments set enforceSeatQuota=false so self-hosted users
        // are genuinely unlimited and never silently capped at max_users.
        if (ctx.enforceSeatQuota) {
            // Defer to the shared computeSeatsUsed helper so permanent members
            // + active guests are counted the same way here, in the seat-guard
            // middleware, and on the billing summary.
            const tenantUsers = await db.select({ id: users.id, expiresAt: users.expiresAt })
                .from(users)
                .where(eq(users.tenantId, invite.tenantId))
                .all();
            const used = computeSeatsUsed(tenantUsers, Math.floor(Date.now() / 1000));
            if (used >= ctx.maxUsers) {
                return { kind: 'over_quota' };
            }
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
            termsAccepted: ctx.termsAccepted ?? null,
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
        // Token material is projected OUT (post hash-at-rest sweep the
        // plaintext column holds a dead sentinel and tokenHash must never
        // reach a caller that might route it to a client).
        return await db.select({
            id:              guestInvites.id,
            tenantId:        guestInvites.tenantId,
            role:            guestInvites.role,
            durationSeconds: guestInvites.durationSeconds,
            expiresAt:       guestInvites.expiresAt,
            claimedByUserId: guestInvites.claimedByUserId,
            claimedAt:       guestInvites.claimedAt,
            createdBy:       guestInvites.createdBy,
            createdAt:       guestInvites.createdAt,
        }).from(guestInvites).where(eq(guestInvites.tenantId, tenantId)).all();
    }
}
