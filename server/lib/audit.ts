import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { auditLogs, users } from './db/schema/tenant';
import { logger } from './logger';
import type { HonoConfig } from '../types/hono';
import type { AuditFamily } from './audit-families';

export type AuditAction =
    | 'inspection.create'
    | 'inspection.delete'
    | 'inspection.status_change'
    | 'inspection.complete'
    | 'inspection.send_pdf'
    // The order-wide report gate released for one inspection, and put back.
    // Audited because an unlock hands a client a report the tenant's own rules
    // said to hold, and the reason for that is worth keeping.
    | 'inspection.report_unlocked'
    | 'inspection.report_relocked'
    | 'inspection.send_sms'
    | 'inspection.rescheduled'
    | 'inspection.bulk_assign'
    | 'inspection.bulk_status'
    | 'inspection.template_upgraded'
    | 'inspection.results_batch_patched'
    | 'inspection.sync_conflict_resolved'
    | 'inspection.share_agent'
    | 'inspection.property_facts.update'
    | 'inspection.pca_narrative.update'
    // The inspector's report-level narrative on `reports`. Distinct from
    // `pca_narrative` above, which is the commercial PCA block set on
    // `inspections` — two different fields on two different tables.
    | 'inspection.report_narrative.update'
    | 'inspection.media.attach'
    | 'inspection.media.video.finalize'
    | 'inspection.media.video.delete'
    | 'template.create'
    | 'template.update'
    | 'template.delete'
    | 'template.marketplace.updated'
    | 'library.marketplace.updated'
    | 'user.invite'
    | 'user.join'
    | 'user.password_change'
    | 'agreement.create'
    | 'agreement.send'
    | 'agreement.remind'
    | 'agreement.sent'
    | 'agreement.viewed'
    | 'agreement.declined'
    | 'agreement.inspector_signed'
    // The tenant retired its e-signature key and minted a replacement. Nothing
    // already signed changes, but WHICH key covers which stretch of a company's
    // evidence is exactly the question a later reader will have, and only this
    // row answers it.
    | 'signing_key.rotate'
    | 'recommendation.created'
    | 'recommendation.updated'
    | 'recommendation.deleted'
    | 'contractor_type.created'
    | 'contractor_type.updated'
    | 'contractor_type.deleted'
    | 'credential.created'
    | 'credential.updated'
    | 'credential.deleted'
    | 'credential.image_uploaded'
    | 'defect_category.created'
    | 'defect_category.updated'
    | 'defect_category.deleted'
    | 'rating_system.created'
    | 'rating_system.updated'
    | 'rating_system.cloned'
    | 'rating_system.deleted'
    | 'data.export'
    | 'data.import'
    // Import runs. Nine, not one: a run is a sequence of separate decisions by
    // separate people, and a trail that recorded them all as 'data.import'
    // could not answer the question it exists for — who chose this. The last
    // TWO are OURS; the rest are the operator's.
    | 'migration.staged'
    | 'migration.assistance_requested'
    | 'migration.remapped'
    | 'migration.row_repaired'
    | 'migration.applied'
    | 'migration.reverted'
    | 'migration.abandoned'
    | 'migration.delivered'
    | 'migration.declined'
    | 'data.delete'
    | 'audit.view'
    | 'comment.created'
    | 'comment.updated'
    | 'comment.deleted'
    | 'config.integration.update'
    | 'config.secrets.update'
    | 'config.attention_thresholds.update'
    | 'config.dashboard_columns.update'
    | 'config.tenant_config.patch'
    // The ZIP territories that decide who is even OFFERED a booking. Audited
    // because clearing a list silently widens one inspector's reach and
    // narrowing one can make a workspace look closed in a whole postcode.
    | 'config.service_areas.replace'
    | 'tag.created'
    | 'tag.updated'
    | 'tag.deleted'
    | 'tag.linked'
    | 'tag.unlinked'
    | 'inspection.property_facts.autofill'
    | 'inspection.template_snapshot.update'
    | 'inspection.rating_system.switch'
    | 'admin.migrate_finding_keys'
    | 'sms.consent.attest'
    | 'sms.test_send'
    | 'sms.compliance.provision'
    | 'sms.compliance.resubmit'
    | 'mcp.grant.created'
    | 'mcp.grant.revoked'
    // Commercial PCA Phase M — ASTM compliance artifacts (dual sign-off / PSQ / doc-review).
    | 'inspection.compliance.signoff'
    | 'inspection.compliance.signoff_removed'
    | 'inspection.compliance.doc_review_seeded'
    | 'inspection.compliance.doc_review_updated'
    | 'inspection.compliance.psq_updated'
    | 'inspection.compliance.psq_status_changed'
    // Agent unified link (Spec 3, Task 2) — single-use magic-login code issue.
    | 'agent.magic_login.issued'
    // Written by fulfill-booking.ts through the slug writer, which until now
    // typed `action` as string — this entry and that type closed together.
    | 'booking.routing.applied'
    // IA-36 ④ — report-delivery credential lifecycle. Rotation destroys the old
    // secret in place (the (inspection, recipient) unique index leaves no dead
    // row behind), so these events are the ONLY durable answer to "the customer
    // says their old link still opens / stopped opening — what happened?".
    // Metadata carries the previous token's HASH; the plaintext is never logged.
    | 'portal_access.rotated'
    | 'portal_access.revoked'
    // Two-layer role model — a role profile's capability overrides changed.
    // Metadata carries the RESOLVED before/after sets, so "who widened this,
    // and when" is answerable without replaying kind baselines by hand.
    | 'role_profile.capabilities_updated';

interface AuditParams {
    db: D1Database;
    tenantId: string;
    userId?: string | undefined;
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
 * send, a property address on an inspection update. Portal's review ruled on
 * the identical column (`audit_logs.details`) that carrying such a column
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
export function writeAuditLog(params: AuditParams): void {
    const { db, executionCtx, ...rest } = params;
    // Fire-and-forget by contract: recording that something happened must never
    // turn a request that DID happen into a 500. The async rejection path was
    // already swallowed; the query construction itself is wrapped too.
    let write: Promise<void>;
    try {
        write = drizzle(db).insert(auditLogs).values({
            id: crypto.randomUUID(),
            tenantId: rest.tenantId,
            userId: rest.userId ?? null,
            action: rest.action,
            entityType: rest.entityType,
            entityId: rest.entityId ?? null,
            metadata: redactAuditMetadata(rest.metadata),
            ipAddress: rest.ipAddress ?? null,
            createdAt: new Date(),
        }).then(() => {}).catch((e) => logger.error('[audit] write failed', {}, e instanceof Error ? e : undefined));
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
