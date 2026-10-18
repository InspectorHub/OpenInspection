/**
 * What `POST /api/inspections` needs around the service call: the request's
 * contacts resolved into ids, the create's audit row, and the free-tier quota
 * notice. Shared by the create itself and by the replay that completes one
 * (`./create-replay`), which must repeat the first two and the last exactly.
 */

import type { Context } from 'hono';
import { auditFromContextAwaited } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { MeteringService } from '../../services/metering.service';
import { PlanQuotaGuard, readTenantTier } from '../../features/plan-quota/guard';
import { templates } from '../../lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { Errors } from '../../lib/errors';
import { noticeFor } from '../../features/plan-quota/notice';
import { loadTenantEmailConfig, assembleTenantEmailService } from '../../lib/email/build-email-service';
import type { CreateInspectionData } from '../../services/inspection/shared';
import type { HonoConfig } from '../../types/hono';
import { isFieldRole } from '../../lib/auth/roles';
import { assertFieldRoleMembers } from '../../lib/inspection/field-role-members';
import { getDrizzle } from '../../lib/route-helpers';
import { ANONYMOUS_CLIENT } from '../../services/inspection/create-pipeline';
import { requireVisibleContact, resolveInspectionScope } from '../../lib/inspection/visibility';

/**
 * Free-tier usage quotas (2026-07), Task 8 — after a successful inspection
 * create/clone/wizard call, check whether the tenant's lifetime inspection
 * counter just crossed the 4/5 or 5/5 notice threshold and, if so, fire a
 * best-effort email. Gated on `hasUsageQuota` (SaaS only — standalone has no
 * DB reads added here beyond the one profile-flag check) and on the tenant's
 * plan tier ('free' only). The email itself is unmetered (see
 * `sendQuotaThresholdNotice` — no `meterTenantId` is passed to
 * `assembleTenantEmailService`) so it can never itself consume or be blocked
 * by the tenant's free-tier email quota.
 */
async function maybeSendQuotaThresholdNotice(c: Context<HonoConfig>, tenantId: string): Promise<void> {
    if (!c.var.profile.hasUsageQuota) return;
    const tier = await readTenantTier(c.env.DB, tenantId);
    if (tier !== 'free') return;

    const count = await new MeteringService(c.env.DB).lifetimeTotal(tenantId, 'inspections');
    const n = noticeFor(count);
    if (!n) return;

    const cfg = await loadTenantEmailConfig(c.env, tenantId);
    const email = assembleTenantEmailService(c.env, cfg);
    await email.sendQuotaThresholdNotice(n, {
        db: c.env.DB,
        kv: c.env.TENANT_CACHE,
        tenantId,
        billingPortalUrl: c.var.profile.billingPortalUrl,
    });
}

/**
 * Fire-and-forget wrapper: runs `maybeSendQuotaThresholdNotice` through
 * `c.executionCtx.waitUntil` so it adds zero latency to the response, and
 * never lets a failure (email provider down, KV unavailable, ...) surface as
 * an unhandled rejection. `c.executionCtx` throws when no execution context
 * is present (some unit-test harnesses) — degrade to a no-op there, mirroring
 * the guard in server/api/sms.ts.
 */
export function fireQuotaThresholdNotice(c: Context<HonoConfig>, tenantId: string): void {
    const run = maybeSendQuotaThresholdNotice(c, tenantId).catch((err) => {
        logger.error('quota threshold notice failed', { tenantId }, err instanceof Error ? err : new Error(String(err)));
    });
    try { c.executionCtx.waitUntil(run); } catch { /* no execution context available (unit tests) */ }
}

/** The `inspectorId` a new job gets: the one named, else the creator when they hold a field role, else none. */
function inspectorFor(c: Context<HonoConfig>, named: string | null | undefined): { inspectorId?: string } {
    const inspectorId = named || (isFieldRole(c.get('userRole')) ? c.get('user').sub : undefined);
    return inspectorId ? { inspectorId } : {};
}

/**
 * Everything a create can refuse for without writing anything: the template must be this company's, and a company on
 * a capped plan must have room. It runs before `resolveCreateInput` upserts the contacts the request names, so a
 * refused create leaves no contact behind and fills nothing forward on a matched one. The service repeats the checks
 * it needs at the insert (the quota claim is atomic there); this is the read-only look ahead of it.
 */
export async function assertCanCreate(c: Context<HonoConfig>, body: { templateId?: string | undefined }): Promise<void> {
    const tenantId = c.get('tenantId');
    if (body.templateId) {
        const tpl = await getDrizzle(c).select({ id: templates.id }).from(templates)
            .where(and(eq(templates.id, body.templateId), eq(templates.tenantId, tenantId))).get();
        // Unknown and another company's template answer alike.
        if (!tpl) throw Errors.BadRequest('Unknown template for this workspace');
    }
    if (c.var.profile.hasUsageQuota) {
        await new PlanQuotaGuard(c.env.DB, { enforced: true, billingPortalUrl: c.var.profile.billingPortalUrl }).assertInspectionRoom(tenantId);
    }
}

/**
 * The create service's input, from the request body: the structured `client`
 * and the agent are upserted into Contacts and their ids passed through.
 * Both upserts are idempotent, which is what lets a replay that completes an
 * interrupted create run this again.
 */
export async function resolveCreateInput(
    c: Context<HonoConfig>,
    body: CreateInspectionData,
): Promise<CreateInspectionData & { inspectorId?: string | undefined; clientContactId?: string; creatorOnRosterId?: string | undefined }> {
    const tenantId = c.get('tenantId');
    const contactService = c.var.services.contact;
    // A named inspector must work in the field and belong to this company; nothing after this looks at the id again.
    await assertFieldRoleMembers(getDrizzle(c), tenantId, [body.inspectorId]);
    // A contact the caller cannot see answers like one that does not exist, and is never linked: linking it to the
    // inspection being created would make it visible to them.
    for (const contactId of [body.referredByAgentId, body.sellingAgentId, body.agentContactId]) {
        if (contactId) await requireVisibleContact(getDrizzle(c), await resolveInspectionScope(c), tenantId, contactId);
    }

    // A caller who sees only their assignments may not reuse a contact outside that set by naming its address:
    // every address in the request is checked before anything is written, so the create is refused whole.
    const scope = await resolveInspectionScope(c);
    const flatClient = !body.client && body.clientName && body.clientName !== ANONYMOUS_CLIENT;
    await contactService.assertEmailsNotHidden(tenantId, [body.client?.email, body.newAgent?.email, flatClient ? body.clientEmail : undefined], scope);

    // IA-1: Resolve client contact before creating the inspection.
    let clientContactId: string | undefined;
    let clientFields: Pick<CreateInspectionData, 'clientName' | 'clientEmail' | 'clientPhone'> | undefined;
    if (body.client) {
        const { id } = await contactService.upsertClientContact(tenantId, {
            name:  body.client.name,
            email: body.client.email,
            phone: body.client.phone,
            type:  'client',
        }, scope);
        clientContactId = id;
        // Double-write denormalized columns so legacy read paths keep working.
        // Unconditional: the structured client object is the authoritative
        // source — the flat clientName carries a zod default ('Private
        // Client') that would otherwise always win and mask the real name.
        clientFields = { clientName: body.client.name, clientEmail: body.client.email ?? null, clientPhone: body.client.phone ?? null };
    } else if (flatClient && scope.kind === 'assigned') {
        // The create pipeline would match a flat client to an existing contact by name when there is no address, which
        // for this caller could be one they cannot see. Resolve it here through the scoped upsert instead, so only
        // contacts in their set can be reused.
        const { id } = await contactService.upsertClientContact(tenantId, {
            name: body.clientName, email: body.clientEmail ?? undefined, phone: body.clientPhone ?? undefined, type: 'client',
        }, scope);
        clientContactId = id;
    }

    // IA-1: Resolve agent — newAgent creates/finds a contacts row; agentContactId uses an existing one.
    let resolvedAgentId: string | null | undefined = body.referredByAgentId;
    if (body.newAgent) {
        const { id } = await contactService.upsertClientContact(tenantId, {
            name:  body.newAgent.name,
            email: body.newAgent.email,
            type:  'agent',
        }, scope);
        resolvedAgentId = id;
    } else if (body.agentContactId) {
        resolvedAgentId = body.agentContactId;
    }

    // A creator who can see only their own assignments stays on the roster of what they create: naming someone
    // else as the inspector would leave them off it, and the inspection would answer "not found" on the very next
    // request. They join as a helper, so the inspector they named stays the lead (the wizard does the same).
    const lead = inspectorFor(c, body.inspectorId).inspectorId;
    const creatorOnRosterId = scope.kind === 'assigned' && lead && lead !== scope.userId && isFieldRole(c.get('userRole'))
        ? scope.userId : undefined;

    return {
        ...body,
        ...clientFields,
        ...(creatorOnRosterId ? { creatorOnRosterId } : {}),
        // The creator leads the job only when they can inspect; an office user
        // (staff) who books one leaves it unassigned for someone to be scheduled.
        ...inspectorFor(c, body.inspectorId),
        referredByAgentId: resolvedAgentId ?? null,
        // IA-1: pass the resolved contact ids through; createInspection stores them.
        ...(clientContactId ? { clientContactId } : {}),
    };
}

/**
 * The `inspection.create` audit row, written AHEAD of the primary report so that
 * "the report exists" also means "the audit row exists". Its id is derived from
 * the inspection, so the create and a replay completing it (even at the same
 * moment) leave one row between them.
 */
export async function recordCreateAudit(c: Context<HonoConfig>, inspectionId: string, propertyAddress: string): Promise<void> {
    await auditFromContextAwaited(c, 'inspection.create', 'inspection', {
        id: `inspection.create:${inspectionId}`,
        entityId: inspectionId,
        metadata: { propertyAddress },
    });
}
