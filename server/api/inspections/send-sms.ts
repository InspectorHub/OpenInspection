/**
 * Communication A3.4 — manual SMS send.
 *
 * Inserts a `pending` automation_logs row (automation_id IS NULL) per
 * recipient, then hands each to `sendOneSms` — the SAME core the automation
 * flush path uses — so consent / managed-send / quota / review_url cannot be
 * routed around. No free-typed numbers: recipients must already be seated on
 * the inspection with a phone on file.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { SendSmsSchema, SendSmsResponseDataSchema } from '../../lib/validations/send-sms.schema';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { auditFromContext } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { Errors } from '../../lib/errors';
import { getBaseUrl } from '../../lib/url';
import { and, eq } from 'drizzle-orm';
import {
    automationLogs, contacts, inspectionPeople, contactRoleProfiles, tenants,
} from '../../lib/db/schema';
import { resolveRoleSmsTemplate } from '../../lib/people/role-template';
import { sendOneSms } from '../../services/automation/send-one-sms';
import { loadProviderForTenant } from '../../lib/sms/resolve-twilio';
import { PlanQuotaGuard } from '../../features/plan-quota/guard';
import { tenantAiCapsLoader } from '../../features/plan-quota/ai-caps';
import { MeteringService } from '../../services/metering.service';

const DEFAULT_SMS_BODY =
    'Update from {{company_name}} about {{property_address}}. Questions? Call {{company_phone}}. Reply STOP to opt out.';

const sendSmsRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/send-sms',
    tags: ['inspections'],
    summary: 'Send a manual SMS to people on the inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: {
        params: z.object({
            id: z.string().trim().min(1).describe('Inspection id whose seated people receive the SMS.'),
        }),
        body: {
            content: { 'application/json': { schema: SendSmsSchema } },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(SendSmsResponseDataSchema) } },
            description: 'SMS outcomes (see data.sentTo / data.skipped)',
        },
        400: { description: 'Malformed body or a recipient not seated on the inspection' },
        404: { description: 'Inspection not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'createInspectionSendSms',
    description:
        'Manual SMS via the shared sendOneSms core (TCPA consent, managed-send, quota). '
        + 'Recipients must be people already on the inspection who have a phone — no free-typed numbers.',
}, { scopes: ['write'], tier: 'extended' }));

const sendSmsRoutes = createApiRouter()
    .openapi(sendSmsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = getTenantId(c);
        const { recipients } = c.req.valid('json');
        const db = getDrizzle(c);
        const rawDb = c.env.DB;

        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
        const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
        if (!tenant) throw Errors.NotFound('Tenant');

        const primary = await c.var.services.people.getPrimaryClient(tenantId, id);
        const flushInspection = {
            id,
            tenantId,
            propertyAddress: String(inspection.propertyAddress ?? ''),
            date: String(inspection.date ?? ''),
            status: inspection.status,
            reportStatus: inspection.reportStatus,
            paymentStatus: inspection.paymentStatus,
            clientContactId: primary?.contactId ?? null,
            clientName: primary?.name ?? null,
        };

        const deployProfile = c.var.profile;
        const quotaGuard = deployProfile?.hasUsageQuota
            ? new PlanQuotaGuard(rawDb, { enforced: true, billingPortalUrl: deployProfile.billingPortalUrl, aiCaps: tenantAiCapsLoader(rawDb) })
            : undefined;
        const metering = deployProfile?.hasUsageQuota ? new MeteringService(rawDb) : undefined;

        const sms = {
            resolveProvider: (tid: string) => loadProviderForTenant(c.env, tid),
        };

        const appName = c.env.APP_NAME || 'OpenInspection';
        const appHost = getBaseUrl(c);
        const sentTo: string[] = [];
        const skipped: Array<{ recipient: string; reason: string }> = [];

        // Shared sendAt so the Outbox collapses the batch (same as A2 email).
        const batchSendAt = new Date();

        for (const recipient of recipients) {
            const label = recipient.contactId;
            try {
                // Must be seated on this inspection with this role — no freelancers.
                const seated = await db.select({
                    phone: contacts.phone,
                    roleKey: contactRoleProfiles.key,
                }).from(inspectionPeople)
                    .innerJoin(contacts, eq(inspectionPeople.contactId, contacts.id))
                    .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
                    .where(and(
                        eq(inspectionPeople.tenantId, tenantId),
                        eq(inspectionPeople.inspectionId, id),
                        eq(inspectionPeople.contactId, recipient.contactId),
                        eq(contactRoleProfiles.key, recipient.roleKey),
                        eq(contacts.tenantId, tenantId),
                    ))
                    .get();

                if (!seated) {
                    const reason = 'Person is not on this inspection with that role';
                    skipped.push({ recipient: label, reason });
                    continue;
                }
                if (!seated.phone) {
                    const reason = 'No phone on file for this recipient';
                    skipped.push({ recipient: label, reason });
                    continue;
                }

                const roleTpl = await resolveRoleSmsTemplate(db, rawDb, tenantId, recipient.roleKey);
                const bodyTemplate = roleTpl?.body ?? DEFAULT_SMS_BODY;

                const logId = crypto.randomUUID();
                await db.insert(automationLogs).values({
                    id: logId,
                    tenantId,
                    automationId: null,
                    inspectionId: id,
                    recipient: seated.phone,
                    recipientRoleKey: recipient.roleKey,
                    recipientContactId: recipient.contactId,
                    channel: 'sms',
                    sendAt: batchSendAt,
                    deliveredAt: null,
                    status: 'pending',
                    error: null,
                });

                const log = await db.select().from(automationLogs)
                    .where(and(eq(automationLogs.id, logId), eq(automationLogs.tenantId, tenantId)))
                    .get();
                if (!log) throw new Error('Failed to insert SMS ledger row');

                await sendOneSms({
                    db,
                    log,
                    inspection: flushInspection,
                    tenant,
                    bodyTemplate,
                    sms,
                    appName,
                    appHost,
                    env: c.env,
                    ...(quotaGuard ? { quotaGuard } : {}),
                    ...(metering ? { metering } : {}),
                });

                const after = await db.select({ status: automationLogs.status, error: automationLogs.error })
                    .from(automationLogs)
                    .where(and(eq(automationLogs.id, logId), eq(automationLogs.tenantId, tenantId)))
                    .get();

                if (after?.status === 'sent') {
                    sentTo.push(seated.phone);
                    auditFromContext(c, 'inspection.send_sms', 'inspection', {
                        entityId: id,
                        metadata: { recipient: seated.phone, roleKey: recipient.roleKey, channel: 'sms' },
                    });
                } else {
                    skipped.push({
                        recipient: label,
                        reason: after?.error ?? after?.status ?? 'Send failed',
                    });
                }
            } catch (err) {
                logger.error('[send-sms] recipient send failed', { inspectionId: id, recipient: label }, err instanceof Error ? err : undefined);
                skipped.push({
                    recipient: label,
                    reason: err instanceof Error ? err.message : 'Send failed',
                });
            }
        }

        return c.json({
            success: true as const,
            data: { sentTo, ...(skipped.length ? { skipped } : {}) },
        }, 200);
    });

export default sendSmsRoutes;
