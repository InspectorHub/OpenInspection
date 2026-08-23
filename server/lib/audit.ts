import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { auditLogs, users } from './db/schema/tenant';
import { logger } from './logger';
import type { HonoConfig } from '../types/hono';
import type { AuditFamily } from './audit-families';

/**
 * The action vocabulary moved to `./audit-actions.ts` — see the note there. It
 * is re-exported here so that `import type { AuditAction } from './audit'`,
 * which is what every caller writes, keeps resolving.
 */
export type { AuditAction } from './audit-actions';
import type { AuditAction } from './audit-actions';

/**
 * WHICH KIND of actor produced an audit row.
 *
 * Three values, not a boolean. A boolean asks "was it us" and has nowhere to put
 * the third case, which is already the truth of a large share of these rows: a
 * cron pass, a queue consumer, an applier acting on a command — nobody at all.
 * Filing that under "not us" makes `false` mean two things, and leaves the reader
 * who has to tell them apart no column to ask.
 *
 *  - `tenant_user`    — somebody in the workspace, acting for themselves.
 *  - `platform_staff` — somebody at the deployment operator, acting on the
 *                       workspace's behalf. `platformActorId` names which one.
 *  - `system`         — no person: scheduled work, a consumer, a backfill.
 *
 * `writeAuditLogWithSlug` deliberately does not take this: it exists to stamp an
 * INSPECTOR's slug on an inspector's own event, so its rows are `tenant_user` by
 * construction and take the column default.
 */
type AuditActorKind = 'tenant_user' | 'platform_staff' | 'system';

interface AuditParams {
    db: D1Database;
    tenantId: string;
    userId?: string | undefined;
    /** Defaults to `tenant_user`. A caller with no person behind it says `system`. */
    actorKind?: AuditActorKind | undefined;
    /** Portal's `platform_admins.id`. Only meaningful with `platform_staff`. */
    platformActorId?: string | undefined;
    action: AuditAction;
    entityType: AuditFamily;
    entityId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    ipAddress?: string | undefined;
    // Only `waitUntil` is used; typed structurally so Hono's `c.executionCtx`
    // (whose ExecutionContext type lags @cloudflare/workers-types — newer
    // versions add members like `tracing`) assigns without a version-skew error.
    executionCtx?: Pick<ExecutionContext, 'waitUntil'> | undefined;
}

/**
 * Metadata redaction — applied at BOTH insert sites in this file (#276).
 *
 * `metadata` is free-form JSON a caller composes, and callers do put subject
 * identifiers in it: a recipient email on a report delivery, a phone on an SMS
 * send, a property address on an inspection update. The same call was made on
 * the portal's identical column (`audit_logs.details`): carrying such a column
 * through an erasure is an incomplete DSAR. This is the write-time half of the
 * answer; the erasure half is the `audit_logs.metadata` anonymize rule in
 * `compliance/erasure-manifest.ts`, and it is the half that is complete.
 *
 * The primary filter is on the VALUE, not the key: a string that IS an email
 * address, a phone number or an IP is removed wherever it appears and whatever
 * it is called. That is what holds when someone adds a field — a list of key
 * names lets the next one through by construction.
 *
 * The short key list below covers what has no detectable value shape. A street
 * address or a person's name is not recognisable as a string, so only the key
 * can flag it, and dropping metadata wholesale is not available: these rows
 * exist for what it says (the previous token hash on a portal_access rotation,
 * the before/after capability sets on a role change). So the list is
 * deliberately narrow, knowingly incomplete, and NOT the reason the column is
 * safe to keep — the manifest rule is.
 *
 * It is deliberately not portal's list either. Portal matches `name`, `token`
 * and a bare `ip`, which here would redact the tag / template / rating-system
 * names that ARE the audit value of half these events, the rotation forensics
 * in `previousTokenHash`, and every key containing the letters "ip"
 * (`zipPrefixes`, `description`).
 */
const REDACTED = '[redacted]';
/** Anchored so a business-object name (`templateName`, `libraryName`) is kept. */
const IDENTITY_KEY = /address|(?:client|contact|recipient|signer|customer)_?name$/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PHONE_RE = /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]?\d{4}(?![\w-])|(?<![\w-])\d{3}[\s.-]\d{4}(?![\w-])/g;
/** UUIDs and hex digests identify a record, never a person — and a digit run
 *  inside one can look like a phone number. Left exactly as written. */
const OPAQUE_ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$|^[0-9a-fA-F]{32,}$/;

function redactValue(value: unknown): unknown {
    if (typeof value === 'string') {
        if (OPAQUE_ID.test(value)) return value;
        return value.replace(EMAIL_RE, REDACTED).replace(IPV4_RE, REDACTED).replace(PHONE_RE, REDACTED);
    }
    if (Array.isArray(value)) return value.map(redactValue);
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            out[key] = IDENTITY_KEY.test(key) ? REDACTED : redactValue(nested);
        }
        return out;
    }
    return value;
}

function redactAuditMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | null {
    return metadata ? (redactValue(metadata) as Record<string, unknown>) : null;
}

/**
 * Write an audit log entry. Uses waitUntil when executionCtx is provided
 * so it never blocks the response path.
 *
 * Exported for the two kinds of caller `auditFromContext` cannot serve: a route
 * that runs BEFORE the tenant is on the context (the join handler — the JWT
 * middleware skips `/join`, so `c.get('tenantId')` is undefined there and the
 * insert would fail a NOT NULL constraint into the swallowed error path), and a
 * React Router action, which has no Hono context at all.
 */
/**
 * The insert itself, AWAITABLE and with nothing swallowed.
 *
 * For the caller whose whole reason to exist is that the row landed. The
 * ordinary contract below is the opposite — recording that something happened
 * must never fail a request that did happen — and that is right for almost
 * everything. It is wrong for a route like the staff source download, where a
 * response served with no audit row is exactly the state the route was built to
 * make impossible. Such a caller awaits this and lets it throw.
 */
export async function writeAuditRow(params: Omit<AuditParams, 'executionCtx'>): Promise<void> {
    await drizzle(params.db).insert(auditLogs).values({
        id: crypto.randomUUID(),
        tenantId: params.tenantId,
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        metadata: redactAuditMetadata(params.metadata),
        ipAddress: params.ipAddress ?? null,
        createdAt: new Date(),
        actorKind: params.actorKind ?? 'tenant_user',
        // Only a platform actor gets an id here. A caller that passes one
        // alongside any other kind is describing something this column cannot
        // express, and the row would read as a support action.
        platformActorId: params.actorKind === 'platform_staff' ? (params.platformActorId ?? null) : null,
    });
}

export function writeAuditLog(params: AuditParams): void {
    const { executionCtx, ...rest } = params;
    // Fire-and-forget by contract: recording that something happened must never
    // turn a request that DID happen into a 500. The async rejection path was
    // already swallowed; the query construction itself is wrapped too.
    let write: Promise<void>;
    try {
        write = writeAuditRow(rest)
            .catch((e) => logger.error('[audit] write failed', {}, e instanceof Error ? e : undefined));
    } catch (e) {
        logger.error('[audit] write failed', {}, e instanceof Error ? e : undefined);
        return;
    }

    if (executionCtx) {
        try { executionCtx.waitUntil(write); } catch { /* swallow if ctx unavailable */ }
    }
}

/**
 * Context-aware wrapper around writeAuditLog that extracts common fields
 * (tenantId, userId, ipAddress, executionCtx) from the Hono context.
 */
export function auditFromContext(
    c: Context<HonoConfig>,
    action: AuditAction,
    entityType: AuditFamily,
    options?: { entityId?: string; metadata?: Record<string, unknown> }
): void {
    const user = c.get('user');
    // A support session reaches these routes signed in AS one of the workspace's
    // own administrators, so `user.sub` is a real tenant user and stays where it
    // is — it is the account the action ran under and that remains true. What was
    // missing is the second fact: that somebody else was driving. `platformActor`
    // is set only by the seam guard, from a value covered by the M2M signature.
    const platformActor = c.get('platformActor');
    // `c.executionCtx` THROWS when the context was created without one (any
    // non-Workers invocation path). Recording an audit event must never be the
    // thing that fails a request that otherwise succeeded, so read it defensively
    // — writeAuditLog already treats it as optional and just awaits inline.
    let executionCtx: Pick<ExecutionContext, 'waitUntil'> | undefined;
    try { executionCtx = c.executionCtx; } catch { executionCtx = undefined; }
    writeAuditLog({
        db: c.env.DB,
        tenantId: c.get('tenantId') as string,
        userId: user?.sub,
        actorKind: platformActor ? 'platform_staff' : 'tenant_user',
        platformActorId: platformActor?.platformAdminId,
        action,
        entityType,
        entityId: options?.entityId,
        metadata: options?.metadata,
        ipAddress: c.req.header('CF-Connecting-IP'),
        executionCtx,
    });
}

/**
 * Sprint B-3 — actions that ought to carry inspector_slug for cross-inspection
 * grouping in audit dashboards. Other events (logins, settings tweaks, library
 * edits) intentionally leave the column NULL so the index stays signal-rich.
 *
 * ⚠️ The list was written to be forward-compatible — "when emitters for these
 * events appear, call writeAuditLogWithSlug" — and closing `AuditAction` turned
 * that into a contradiction. FIVE of the six names below are not members of the
 * union (`user.slug.set`, `inspection.created`, `inspection.published`,
 * `invoice.sent`, `invoice.paid`), so no caller can pass them any more, and the
 * sixth (`agreement.sent`) is declared `in-esign-log` — its record is the
 * hash-chained row, not an `audit_logs` one. The consequence is that
 * `inspector_slug` cannot be populated by anything writable today. It is a
 * `Set<string>` rather than `Set<AuditAction>` deliberately, so this file states
 * the gap instead of hiding it behind a cast; pinned by
 * `tests/unit/tenancy/audit-inspector-slug.spec.ts`.
 */
export const INSPECTOR_SLUG_AUDIT_ALLOWLIST = new Set<string>([
    'user.slug.set',
    'inspection.created',
    'inspection.published',
    'agreement.sent',
    'invoice.sent',
    'invoice.paid',
]);

export interface AuditWithSlugParams {
    tenantId: string;
    actorUserId?: string;
    action: AuditAction;
    entityType: AuditFamily;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
}

/**
 * Sprint B-3 — wraps writeAuditLog so callers don't have to remember to look
 * up users.slug themselves. Joins on actorUserId and writes the slug into the
 * inspector_slug column iff the action is in INSPECTOR_SLUG_AUDIT_ALLOWLIST.
 * For all other actions inspector_slug stays NULL.
 *
 * Synchronous wrt the audit insert itself (awaits the slug lookup), but the
 * insert promise still surfaces as a no-await background write — same shape
 * as writeAuditLog so callers can fire-and-forget.
 */
export async function writeAuditLogWithSlug(db: D1Database, params: AuditWithSlugParams): Promise<void> {
    let inspectorSlug: string | null = null;
    if (params.actorUserId && INSPECTOR_SLUG_AUDIT_ALLOWLIST.has(params.action)) {
        try {
            const row = await drizzle(db).select({ slug: users.slug }).from(users).where(eq(users.id, params.actorUserId)).get();
            inspectorSlug = row?.slug ?? null;
        } catch (e) {
            logger.error('[audit] slug lookup failed', { actorUserId: params.actorUserId }, e instanceof Error ? e : undefined);
        }
    }
    try {
        await drizzle(db).insert(auditLogs).values({
            id: crypto.randomUUID(),
            tenantId: params.tenantId,
            userId: params.actorUserId ?? null,
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId ?? null,
            metadata: redactAuditMetadata(params.metadata),
            ipAddress: params.ipAddress ?? null,
            inspectorSlug,
            createdAt: new Date(),
        });
    } catch (e) {
        logger.error('[audit] write failed', {}, e instanceof Error ? e : undefined);
    }
}
