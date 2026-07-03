/**
 * Design System 0520 subsystem E phase 4 — IdentitySwitcher (M20).
 *
 * Allows a user to be the "primary" identity for one or more workspace
 * seats elsewhere (a property manager who's also an inspector at a
 * sibling tenant; an office staffer who admins multiple branches).
 * The switcher reads `user_identity_links` and on switch issues a
 * fresh ES256 JWT for the target user via the existing keyring.
 *
 * Three surfaces:
 *   list(primary)              — rows powering the dropdown.
 *   switchTo(primary, linked)  — verify link → sign JWT → return token.
 *   link({ primary, email })   — admin-only seed for the link table.
 *
 * The `link` method snapshots role + tenantId + display name at link-
 * time so the dropdown can render without per-row joins.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNull } from 'drizzle-orm';
import { userIdentityLinks } from '../lib/db/schema/identity-links';
import { users } from '../lib/db/schema';
import { signJwt } from '../lib/jwt-keyring';
import type { JwtKeyring } from '../lib/jwt-keyring';

export interface IdentityLinkRow {
    id:                 string;
    primaryUserId:      string;
    linkedUserId:       string;
    linkedTenantId:     string;
    linkedRole:         string;
    linkedDisplayName:  string;
    createdAt:          string;
}

export type SwitchResult =
    | { kind: 'ok'; newToken: string; redirectUrl: string }
    | { kind: 'forbidden' }
    | { kind: 'not_found' };

export class IdentityService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async list(primaryUserId: string): Promise<IdentityLinkRow[]> {
        return await this.getDrizzle().select().from(userIdentityLinks)
            .where(eq(userIdentityLinks.primaryUserId, primaryUserId))
            .all();
    }

    async switchTo(
        primaryUserId: string,
        linkedUserId:  string,
        ctx: { keyring: JwtKeyring },
    ): Promise<SwitchResult> {
        const db = this.getDrizzle();
        const link = await db.select().from(userIdentityLinks)
            .where(and(
                eq(userIdentityLinks.primaryUserId, primaryUserId),
                eq(userIdentityLinks.linkedUserId,  linkedUserId),
            ))
            .get();
        if (!link) return { kind: 'forbidden' };

        // Excludes soft-deleted (removed member) rows — switching mints a
        // fresh JWT without a password check, so it must honor the same
        // active-user gate as login.
        const linkedUser = await db.select().from(users)
            .where(and(eq(users.id, linkedUserId), isNull(users.deletedAt))).get();
        if (!linkedUser) return { kind: 'not_found' };

        const newToken = await signJwt({
            sub:                linkedUser.id,
            email:              linkedUser.email,
            'custom:tenantId':  linkedUser.tenantId,
            'custom:userRole':  linkedUser.role,
            role:               linkedUser.role,
        }, ctx.keyring);

        return { kind: 'ok', newToken, redirectUrl: '/inspections' };
    }

    async link({ primaryUserId, targetEmail }: { primaryUserId: string; targetEmail: string }): Promise<{ id: string }> {
        const db = this.getDrizzle();
        const target = await db.select().from(users).where(eq(users.email, targetEmail)).get();
        if (!target) throw new Error('target user not found');

        const id = crypto.randomUUID();
        await db.insert(userIdentityLinks).values({
            id,
            primaryUserId,
            linkedUserId:      target.id,
            linkedTenantId:    target.tenantId ?? '',
            linkedRole:        target.role,
            linkedDisplayName: target.name ?? target.email,
            createdAt:         new Date().toISOString(),
        });
        return { id };
    }
}
