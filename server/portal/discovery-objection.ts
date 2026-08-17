/**
 * The objection to being discoverable across tenants, and the proof it requires.
 *
 * `GET /api/integration/tenants/by-email` answers, for one address, which
 * inspection companies hold a live report grant for that person. It stays —
 * it is how a homebuyer who lost the email reaches their own report — but a
 * person has to be able to leave it.
 *
 * ── Why filing needs a grant token, and not just an address ──────────────────
 * The lookup is reachable from an anonymous form. An objection endpoint that
 * accepted a bare address would therefore be a DENIAL-OF-ACCESS TOOL aimed at
 * somebody else: type a stranger's address, and they can no longer find their
 * own report. So the caller must present an unrevoked
 * `inspection_access_tokens` secret whose recipient IS that address.
 *
 * That standard opens no new hole, which is the test it has to pass: the token
 * was mailed to the address and already releases the report itself, so the
 * objection path hands its user no capability they did not hold. The set of
 * people this endpoint can reveal anything about is exactly the set who were
 * sent grant mail.
 *
 * EXPIRY is accepted; REVOCATION is not. An expired link says only that it is
 * old, and holders of old links are precisely the population that wants this;
 * a revoked one is the tenant saying the secret is no longer trusted.
 * Withdrawal needs the same proof as filing, or it becomes a way to put someone
 * back into a lookup they left.
 *
 * A suppressed lookup returns a byte-identical response to an unknown address,
 * so consulting the table cannot out an objector, and no log line carries the
 * address or its hash.
 *
 * ── Split out of integration.routes.ts ──────────────────────────────────────
 * That file crossed its size ceiling, and this is the seam it already used for
 * `destruction-records.ts` and `ai-provisioning.ts`: a handler family with its
 * own reasoning lives beside the router rather than inside it.
 */
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { discoveryObjections, inspectionAccessTokens } from '../lib/db/schema';
import { hashToken } from '../lib/token-hash';
import { logger } from '../lib/logger';
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

/**
 * Body for POST/DELETE /discovery-objections.
 *
 * `grantToken` is not optional and there is no variant of this schema without
 * it: the address alone is a REQUEST, not an authorisation, and accepting one
 * would turn the objection into a way to deny somebody else the report lookup
 * they depend on.
 */
const DiscoveryObjectionSchema = z.object({
    email: z.string().min(3).includes('@'),
    grantToken: z.string().min(16),
});

/**
 * The lookup key for a discovery objection: SHA-256 hex of the normalised
 * address. Normalisation is trim + lower-case, and it is applied on BOTH sides
 * (when the objection is filed, and when the lookup consults it) — otherwise
 * `Quiet@Example.com` walks round an objection filed as `quiet@example.com`.
 *
 * `hashToken` is the repository's one SHA-256-to-hex helper. It is named for the
 * capability tokens it was written for, and is reused here rather than
 * hand-rolling a second digest: the hash is not a secret (see the table comment
 * in schema/tenant/core.ts — it is data minimisation, not a security control),
 * so what matters is that exactly one implementation decides what the key is.
 */
async function discoveryObjectionKey(email: string): Promise<string> {
    return hashToken(email.trim().toLowerCase());
}

/**
 * Has this address objected to being discovered? Consulted by the by-email
 * lookup before it scans anything.
 */
export async function hasDiscoveryObjection(d: DrizzleD1Database, email: string): Promise<boolean> {
    const rows = await d
        .select({ id: discoveryObjections.id })
        .from(discoveryObjections)
        .where(and(
            eq(discoveryObjections.emailHash, await discoveryObjectionKey(email)),
            isNull(discoveryObjections.withdrawnAt),
        ))
        .limit(1);
    return rows.length > 0;
}

/**
 * Proof that whoever is filing (or withdrawing) an objection controls the
 * address it is about.
 *
 * THE PROBLEM THIS SOLVES. An objection path over an unauthenticated existence
 * oracle is itself an oracle. "Stop looking me up" that anybody may call for
 * anybody's address is a way to take away a stranger's route to their own
 * report, and a 200/403 split on a bare address would additionally answer the
 * very question the objection exists to stop answering.
 *
 * THE STANDARD. The caller must present an unrevoked `inspection_access_tokens`
 * secret whose recipient IS that address. That token was mailed to the address,
 * and it already releases the report itself — so this path hands its user no
 * capability they did not already hold, and someone who cannot produce it learns
 * nothing from being refused (they had to know the token to get past this, and
 * knowing the token means they were told the address).
 *
 * EXPIRY IS ACCEPTED, REVOCATION IS NOT. Expiry is link hygiene: it says the URL
 * is old, not that the holder is untrusted, and the people most likely to want
 * this are exactly those whose links have aged out. Revocation is the tenant
 * saying "this secret is no longer trusted" — honouring it here would let a
 * withdrawn token act on the person it was withdrawn from.
 *
 * WHAT THIS CANNOT DO, recorded rather than papered over: a person who never
 * kept any grant email has no way to prove control, and this repository has no
 * authenticated end-user surface to give them one. They remain discoverable and
 * must ask a human. Closing it needs a verified-email challenge (or a portal
 * account) that does not exist yet — not a weaker check here.
 */
async function provesAddressControl(d: DrizzleD1Database, email: string, grantToken: string): Promise<boolean> {
    const presented = await hashToken(grantToken);
    const rows = await d
        .select({ recipientEmail: inspectionAccessTokens.recipientEmail })
        .from(inspectionAccessTokens)
        .where(and(
            eq(inspectionAccessTokens.tokenHash, presented),
            isNull(inspectionAccessTokens.revokedAt),
        ));
    const wanted = email.trim().toLowerCase();
    return rows.some((r) => (r.recipientEmail ?? '').trim().toLowerCase() === wanted);
}

/**
 * POST /api/integration/discovery-objections   — file one
 * DELETE /api/integration/discovery-objections — withdraw it
 *
 * Body: `{ email, grantToken }`. Both verbs require the same proof of control
 * (`provesAddressControl`) — a withdrawal that needed less than the filing would
 * be a way to put somebody back into the lookup they left.
 *
 * The objection removes the address from the CROSS-TENANT lookup only. It does
 * not touch any grant, so the person's own access — their report links, and each
 * company's own per-tenant recipient lookup — is unaffected. An objection that
 * cost somebody their report would not be an objection.
 *
 * 204 on success, 403 when the proof does not hold, 400 on a malformed body.
 * There is no state-revealing response: filing an objection that already exists
 * and filing a fresh one are the same 204.
 */
export async function fileDiscoveryObjectionHandler(c: Context<HonoConfig>) {
    const parsed = DiscoveryObjectionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    try {
        const d = drizzle(c.env.DB);
        if (!await provesAddressControl(d, parsed.data.email, parsed.data.grantToken)) {
            return c.json({ success: false, error: { message: 'Proof of address control required' } }, 403);
        }
        const key = await discoveryObjectionKey(parsed.data.email);
        await d.insert(discoveryObjections).values({
            id: crypto.randomUUID(),
            emailHash: key,
            provedBy: 'inspection_access_token',
            createdAt: new Date(),
            withdrawnAt: null,
        }).onConflictDoUpdate({
            // Re-filing after a withdrawal revives the same row: `created_at`
            // keeps saying when this person first objected.
            target: discoveryObjections.emailHash,
            set: { withdrawnAt: null },
        });
        // No address, and no hash, in the log line: an objection log that
        // identified the objector would rebuild the list the table avoids
        // holding.
        logger.info('discovery objection filed', {});
        return c.body(null, 204);
    } catch (error: unknown) {
        logger.error('discovery objection write failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}

export async function withdrawDiscoveryObjectionHandler(c: Context<HonoConfig>) {
    const parsed = DiscoveryObjectionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    try {
        const d = drizzle(c.env.DB);
        if (!await provesAddressControl(d, parsed.data.email, parsed.data.grantToken)) {
            return c.json({ success: false, error: { message: 'Proof of address control required' } }, 403);
        }
        const key = await discoveryObjectionKey(parsed.data.email);
        await d.update(discoveryObjections)
            .set({ withdrawnAt: new Date() })
            .where(and(eq(discoveryObjections.emailHash, key), isNull(discoveryObjections.withdrawnAt)));
        logger.info('discovery objection withdrawn', {});
        return c.body(null, 204);
    } catch (error: unknown) {
        logger.error('discovery objection withdrawal failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}
