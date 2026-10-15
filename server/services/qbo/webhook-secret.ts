/**
 * Finding the verifier token for a QuickBooks webhook that names no company.
 *
 * `POST /webhooks/quickbooks` is unauthenticated and its URL carries no tenant,
 * so on a deployment without a single fixed company the only tenant hint is the
 * realm id inside the body -- which nothing has verified yet. That hint is used
 * for exactly one thing: choosing WHICH STORED SECRET TO TRY. A candidate's
 * token is then checked against the signature, so a caller who merely claims a
 * realm gets nothing unless they hold that company's own token, and company B's
 * token can never verify a payload as company A's.
 *
 * Precedence mirrors the rest of the integration secrets: a verifier token in
 * the Worker env wins, and this lookup runs only when none resolved.
 */
import { drizzle } from 'drizzle-orm/d1';
import { inArray } from 'drizzle-orm';
import { qboConnections } from '../../lib/db/schema/qbo';
import { resolveQboCredentialsForTenant } from './resolve-credentials';
import { QBOService } from '../qbo.service';
import { logger } from '../../lib/logger';

/** Bounds on what an unauthenticated body can make us look up. */
const MAX_REALMS = 20;
const MAX_TENANTS = 5;

type CandidateEnv = Parameters<typeof resolveQboCredentialsForTenant>[0] & { JWT_SECRET: string };

interface WebhookCandidate {
    tenantId: string;
    service: QBOService;
}

/** Distinct realm ids the (unverified) body claims, capped; empty when it is not parseable. */
function claimedRealmIds(rawBody: string): string[] {
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { return []; }
    const events = Array.isArray(parsed) ? parsed : [parsed];
    const ids = new Set<string>();
    for (const e of events) {
        const id = (e as { intuitaccountid?: unknown } | null)?.intuitaccountid;
        if (typeof id === 'string' && id) ids.add(id);
        if (ids.size >= MAX_REALMS) break;
    }
    return [...ids];
}

/**
 * One service per company that holds a connection for a claimed realm AND has a
 * stored verifier token. A realm claimed by more than one company is skipped:
 * refusing to guess beats verifying against the wrong books.
 */
export async function webhookCandidates(env: CandidateEnv, rawBody: string): Promise<WebhookCandidate[]> {
    const realms = claimedRealmIds(rawBody);
    if (realms.length === 0) return [];

    const db = drizzle(env.DB);
    const rows = await db.select({ tenantId: qboConnections.tenantId, realmId: qboConnections.realmId })
        .from(qboConnections).where(inArray(qboConnections.realmId, realms)).all();

    const byRealm = new Map<string, string[]>();
    for (const r of rows) byRealm.set(r.realmId, [...(byRealm.get(r.realmId) ?? []), r.tenantId]);
    const unique = [...new Set([...byRealm.values()].filter((t) => t.length === 1).map((t) => t[0]!))];
    if (unique.length > MAX_TENANTS) {
        // Intuit does not retry a 200, so a dropped candidate is dropped for good.
        logger.warn('QBO webhook: more candidate companies than the cap — extra ones not tried', {
            candidates: unique.length, cap: MAX_TENANTS,
        });
    }
    const tenantIds = unique.slice(0, MAX_TENANTS);

    const out: WebhookCandidate[] = [];
    for (const tenantId of tenantIds) {
        const { credentials } = await resolveQboCredentialsForTenant(env, tenantId);
        if (!credentials?.webhookSecret) continue;
        out.push({
            tenantId,
            service: new QBOService(
                env.DB, credentials.clientId, credentials.clientSecret,
                credentials.webhookSecret, env.JWT_SECRET, credentials.qboEnv,
            ),
        });
    }
    if (out.length === 0) logger.info('QBO webhook: no stored verifier token for the claimed realms');
    return out;
}
