import { eq, and, desc } from 'drizzle-orm';
import { inspections, inspectionResults, templates, users, tenantConfigs, tenants, inspectionServices, agreements, agreementRequests, invoices } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { safeISODate } from '../../lib/date';
import { resolveLocale } from '../../lib/locale';
import { InvoiceService } from '../invoice.service';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { REPORT_STATUS } from '../../lib/status/report-status';
import type { AgreementService } from '../agreement.service';
import type { TemplateSchemaV2 } from '../../types/template-schema';
import {
    fireAutomation,
    resolveRequireDefectFields,
    computePublishReadinessFromState,
    type RequireDefectFields,
    type PublishReadiness,
} from './shared';
import { InspectionSubService } from './base';
import type { InspectionService } from '../inspection.service';

/** Normalise a possibly-JSON-encoded D1 column: parse when it's a string,
 *  pass objects through, and collapse any falsy value (undefined/null/'') to
 *  null. computePublishReadiness reads templateSnapshot / template.schema /
 *  inspection_results.data through this — all may arrive as either shape. */
function parseMaybeJson(raw: unknown): unknown {
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * Report publish + pre-publish gate logic: publishInspection (status flip +
 * automation trigger + auto-sign), computePublishReadiness (defect-field gate),
 * getReportGate (public agreement/payment gate payload), and getInspectionHub
 * (the aggregate hub page). Extracted verbatim from InspectionService.
 * getInspectionHub composes getPeopleCard (core) via the facade and
 * computePublishReadiness internally.
 */
export class InspectionPublishService extends InspectionSubService {
    constructor(
        db: D1Database,
        r2: R2Bucket | undefined,
        sdb: import('../../lib/db/scoped').ScopedDB | undefined,
        kv: KVNamespace | undefined,
        images: import('../../lib/media/strip-exif').ImagesBinding | undefined,
        private facade: InspectionService,
    ) {
        super(db, r2, sdb, kv, images);
    }

    /**
     * C-10 ③-A.2 — the public report-gate payload ("your report is almost ready,
     * here's what's blocking it + the CTA"). Mirrors the report double-gate used
     * by /report/:id: agreement-signed first (chronologically
     * first gate), then invoice-paid. Returns null when the inspection does not
     * exist OR is not actually gated (nothing to show). The `tenantSlug` is only
     * used to build the agreement-sign URL — authority is always `tenantId`.
     *
     * Track I-a Task 7 — when BOTH the agreement and the payment gates are
     * outstanding, the CTA routes to the combined `/checkout/{slug}/{signerToken}`
     * page ('Sign & pay') instead of the agreement-only sign page. `reason` stays
     * 'agreement' (the first-reported gate) for consumer compatibility. The signer
     * token is reconstructed server-side via the optional `agreementService`
     * (tier-2 link); when it is absent or yields no outstanding signer the gate
     * falls back to the legacy single-gate agreement URL.
     */
    async getReportGate(inspectionId: string, tenantId: string, tenantSlug: string, agreementService?: AgreementService): Promise<{
        reason: 'payment' | 'agreement';
        companyName: string;
        primaryColor: string | null;
        actionUrl: string;
        actionLabel: string;
        propertyAddress: string | null;
        inspectorName: string | null;
        inspectorEmail: string | null;
        inspectorPhone: string | null;
        inspectorLicense: string | null;
        scheduledDate: string | null;
        amountCents: number | null;
        currency: string | null;
        locale: string;
    } | null> {
        const db = this.getDrizzle();
        const insp = await db.select({
            id:                inspections.id,
            propertyAddress:   inspections.propertyAddress,
            date:              inspections.date,
            inspectorId:       inspections.inspectorId,
            paymentRequired:   inspections.paymentRequired,
            paymentStatus:     inspections.paymentStatus,
            agreementRequired: inspections.agreementRequired,
        }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) return null;

        // Resolve the outstanding gate. Agreement before payment (signed first).
        let reason: 'payment' | 'agreement' | null = null;
        let agreementToken: string | null = null;
        if (insp.agreementRequired === true) {
            const signed = await db.select({ id: agreementRequests.id })
                .from(agreementRequests)
                .where(and(
                    eq(agreementRequests.inspectionId, inspectionId),
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.status, 'signed'),
                ))
                .limit(1);
            if (signed.length === 0) {
                reason = 'agreement';
                const pending = await db.select({ token: agreementRequests.token })
                    .from(agreementRequests)
                    .where(and(
                        eq(agreementRequests.inspectionId, inspectionId),
                        eq(agreementRequests.tenantId, tenantId),
                    ))
                    .orderBy(desc(agreementRequests.createdAt))
                    .limit(1)
                    .get();
                agreementToken = pending?.token ?? null;
            }
        }
        // Payment-outstanding is computed independently of `reason` so the
        // dual-gate (agreement AND payment) case can route to combined checkout.
        const paymentOutstanding = insp.paymentRequired === true && insp.paymentStatus !== 'paid';
        if (!reason && paymentOutstanding) {
            reason = 'payment';
        }
        if (!reason) return null;   // not gated — nothing to surface

        // Track I-a Task 7 — both gates outstanding → combined "Sign & pay".
        const bothOutstanding = reason === 'agreement' && paymentOutstanding;

        const branding = await db.select({ companyName: tenantConfigs.companyName, primaryColor: tenantConfigs.primaryColor, defaultLocale: tenantConfigs.defaultLocale })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        let inspector: { name: string | null; email: string | null; phone: string | null; licenseNumber: string | null } | undefined;
        if (insp.inspectorId) {
            inspector = await db.select({
                name: users.name, email: users.email, phone: users.phone, licenseNumber: users.licenseNumber,
            }).from(users)
                .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId)))
                .get();
        }

        // Surface the invoice amount whenever payment is part of the gate (the
        // payment-only page AND the combined Sign & pay page both show it).
        let amountCents: number | null = null;
        // Phase B — carry the invoice's snapshot currency onto the gate so the
        // amount renders in the currency it was billed in, not the tenant's
        // current setting. Null when there is no outstanding invoice.
        let currency: string | null = null;
        if (paymentOutstanding) {
            const invoice = await db.select({ amountCents: invoices.amountCents, currency: invoices.currency })
                .from(invoices)
                .where(and(eq(invoices.tenantId, tenantId), eq(invoices.inspectionId, inspectionId)))
                .orderBy(desc(invoices.createdAt))
                .limit(1)
                .get();
            amountCents = invoice?.amountCents ?? null;
            currency = invoice?.currency ?? null;
        }

        // Reconstruct the first outstanding signer's tier-2 link token
        // server-side. Used by BOTH the combined "Sign & pay" checkout URL and
        // the agreement-only sign URL — `agreementRequests.token` is an
        // UNDISTRIBUTED placeholder for envelope-v2 (real tokens live per-signer),
        // so routing the customer to it would 404. When the helper is unavailable
        // or yields no outstanding signer, fall back to the legacy envelope token
        // (still resolves for legacy `createSigningRequest` envelopes whose
        // plaintext token IS distributed) — last resort, never break those.
        let signerLink: string | null = null;
        if ((bothOutstanding || reason === 'agreement') && agreementService) {
            signerLink = await agreementService.getFirstOutstandingSignerLink(tenantId, inspectionId);
        }
        const agreementLinkToken = signerLink ?? agreementToken;

        let actionUrl: string;
        let actionLabel: string;
        if (bothOutstanding && signerLink) {
            actionUrl = `/checkout/${tenantSlug}/${signerLink}`;
            actionLabel = 'Sign & pay';
        } else if (reason === 'payment') {
            actionUrl = `/invoice/${inspectionId}`;
            actionLabel = 'Pay invoice';
        } else {
            actionUrl = agreementLinkToken
                ? `/agreements/sign/${tenantSlug}/${agreementLinkToken}`
                : `/report-gate/${tenantSlug}/${inspectionId}`;
            actionLabel = 'Sign agreement';
        }

        return {
            reason,
            companyName: branding?.companyName ?? 'OpenInspection',
            // A-10 — nullable: null means "tenant set no accent", the page
            // keeps the platform design tokens (no per-surface fallback hex).
            primaryColor: branding?.primaryColor ?? null,
            actionUrl,
            actionLabel,
            propertyAddress: insp.propertyAddress ?? null,
            inspectorName: inspector?.name ?? null,
            inspectorEmail: inspector?.email ?? null,
            inspectorPhone: inspector?.phone ?? null,
            inspectorLicense: inspector?.licenseNumber ?? null,
            scheduledDate: insp.date ?? null,
            amountCents,
            // Snapshot currency from the invoice (Phase B); fall back to USD only
            // when an amount exists without a resolvable currency.
            currency: amountCents != null ? (currency ?? 'USD') : null,
            // Tenant default display locale for the public gate page (external
            // client has no user override).
            locale: resolveLocale(branding?.defaultLocale),
        };
    }

    /**
     * Issue #111 — single aggregate payload for the `/inspections/:id` hub page.
     * The page loader makes ONE round trip and renders six blocks (People,
     * Schedule, Services, Agreement, Invoice, Report status) from this result.
     *
     * Composition only — every block reuses an existing, already-tenant-scoped
     * primitive so the hub never re-derives logic that lives elsewhere:
     *   - `people`            → getPeopleCard (inspector/client/agents)
     *   - `publishReadiness`  → computePublishReadiness (report-status gate)
     *   - `invoice`           → InvoiceService.findByInspectionId (+ its getStatus)
     *
     * Returns `null` when the inspection does not exist OR belongs to another
     * tenant; the route turns that into a 404. Every direct query filters by
     * tenantId. `tenantSlug` is passed through verbatim for building
     * `/report/:tenantSlug/:id` style links on the page.
     */
    async getInspectionHub(inspectionId: string, tenantId: string, tenantSlug: string): Promise<{
        inspection: {
            id: string;
            propertyAddress: string;
            clientName: string | null;
            clientEmail: string | null;
            clientPhone: string | null;
            clientContactId: string | null;
            status: string;
            reportStatus: string;
            date: string | null;
            inspectorId: string | null;
            templateId: string | null;
            price: number;
            paymentStatus: string;
            paymentRequired: boolean;
            agreementRequired: boolean;
            coverPhoto: string | null;
            referredByAgentId: string | null;
            sellingAgentId: string | null;
            createdAt: string | null;
        };
        tenantSlug: string;
        people: Awaited<ReturnType<InspectionService['getPeopleCard']>>;
        services: Array<{ id: string; name: string; priceCents: number }>;
        agreements: Array<{ id: string; name: string }>;
        agreementRequests: Array<{
            id: string;
            status: string;
            clientEmail: string;
            signedAt: string | null;
            createdAt: string | null;
        }>;
        invoice: { id: string; status: string; amountCents: number; sentAt: string | null; paidAt: string | null } | null;
        publishReadiness: { ready: boolean; blockingCount: number };
    } | null> {
        const db = this.getDrizzle();

        // Authority row — gate on existence + tenant ownership first.
        const insp = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) return null;

        // Service lines — effective price = priceOverride ?? priceSnapshot
        // (P-4 authority chain, tier 2). Tenant-scoped on both columns.
        const serviceRows = await db.select({
            id:            inspectionServices.id,
            nameSnapshot:  inspectionServices.nameSnapshot,
            priceSnapshot: inspectionServices.priceSnapshot,
            priceOverride: inspectionServices.priceOverride,
        }).from(inspectionServices)
            .where(and(
                eq(inspectionServices.tenantId, tenantId),
                eq(inspectionServices.inspectionId, inspectionId),
            ))
            .all();

        // Tenant's agreement templates — drives a "send agreement" dropdown later.
        const agreementRows = await db.select({ id: agreements.id, name: agreements.name })
            .from(agreements)
            .where(eq(agreements.tenantId, tenantId))
            .orderBy(desc(agreements.createdAt))
            .all();

        // Agreement requests for this inspection, newest first.
        const requestRows = await db.select({
            id:          agreementRequests.id,
            status:      agreementRequests.status,
            clientEmail: agreementRequests.clientEmail,
            signedAt:    agreementRequests.signedAt,
            createdAt:   agreementRequests.createdAt,
        }).from(agreementRequests)
            .where(and(
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.inspectionId, inspectionId),
            ))
            .orderBy(desc(agreementRequests.createdAt))
            .all();

        // Reused primitives. getPeopleCard/computePublishReadiness throw NotFound
        // when the row is absent — but we already confirmed it exists above, so
        // they resolve. InvoiceService is constructed inline (it takes only a
        // D1Database, same handle this service holds) per the DI guidance: no
        // constructor-chain redesign, just compose the read.
        const invoiceSvc = new InvoiceService(this.db);
        const [people, readiness, invoice] = await Promise.all([
            this.facade.getPeopleCard(inspectionId, tenantId),
            this.computePublishReadiness(inspectionId, tenantId),
            invoiceSvc.findByInspectionId(tenantId, inspectionId),
        ]);

        return {
            inspection: {
                id:                insp.id,
                propertyAddress:   insp.propertyAddress,
                clientName:        insp.clientName ?? null,
                clientEmail:       insp.clientEmail ?? null,
                clientPhone:       insp.clientPhone ?? null,
                clientContactId:   insp.clientContactId ?? null,
                status:            insp.status,
                reportStatus:      insp.reportStatus as string,
                date:              insp.date ?? null,
                inspectorId:       insp.inspectorId ?? null,
                templateId:        insp.templateId ?? null,
                price:             insp.price,
                paymentStatus:     insp.paymentStatus,
                paymentRequired:   insp.paymentRequired === true,
                agreementRequired: insp.agreementRequired === true,
                coverPhoto:        insp.coverPhotoId ?? null,
                referredByAgentId: insp.referredByAgentId ?? null,
                sellingAgentId:    insp.sellingAgentId ?? null,
                createdAt:         safeISODate(insp.createdAt),
            },
            tenantSlug,
            people,
            services: serviceRows.map(s => ({
                id:        s.id,
                name:      s.nameSnapshot,
                priceCents: s.priceOverride ?? s.priceSnapshot,
            })),
            agreements: agreementRows.map(a => ({ id: a.id, name: a.name })),
            agreementRequests: requestRows.map(r => ({
                id:          r.id,
                status:      r.status,
                clientEmail: r.clientEmail,
                signedAt:    r.signedAt ? safeISODate(r.signedAt) : null,
                createdAt:   safeISODate(r.createdAt),
            })),
            invoice: invoice
                ? {
                    id:         invoice.id,
                    status:     invoice.status,
                    amountCents: invoice.amountCents,
                    sentAt:     invoice.sentAt,
                    paidAt:     invoice.paidAt,
                }
                : null,
            publishReadiness: {
                ready:         readiness.ready,
                blockingCount: readiness.blockingDefects.length,
            },
        };
    }

    /**
     * Publishes an inspection report (transitions to delivered status).
     */
    async publishInspection(inspectionId: string, tenantId: string, _options: {
        theme: string;
        notifyClient: boolean;
        notifyAgent: boolean;
        requireSignature: boolean;
        requirePayment: boolean;
        // Round-2 F1 — optional per-recipient delivery list. Older callers
        // (legacy publish modal, AI agent flows) keep working without it.
        recipients?: Array<{ contactId: string | null; channels: Array<'email' | 'text'> }>;
        sendAgreementCopy?: boolean;
    }) {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');
        if (inspection.status !== INSPECTION_STATUS.COMPLETED) throw Errors.BadRequest('Inspection must be completed before publishing the report.');

        await db.update(inspections)
            .set({ reportStatus: REPORT_STATUS.PUBLISHED })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        // Await so AutomationService.trigger actually inserts automation_logs
        // before the response goes out — the prior fire-and-forget pattern
        // dangled the promise so CF terminated the isolate before the insert
        // completed (and ditto for inspection.confirmed / cancelled / created
        // below — all four paths now block on trigger).
        await fireAutomation(this.db, tenantId, inspectionId, 'report.published');

        // Spec 5H D2 — auto-sign on publish: if the inspection has the flag
        // enabled AND the assigned inspector has a saved signature, inject
        // _inspector_signature into inspection_results.data so the published
        // report renders with the signature without requiring a manual step.
        const inspForSign = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (inspForSign?.autoSignOnPublish && inspForSign.inspectorId) {
            const inspector = await db.select().from(users)
                .where(eq(users.id, inspForSign.inspectorId)).get();
            if (inspector?.defaultSignatureBase64) {
                const resultsRow = await db.select().from(inspectionResults)
                    .where(eq(inspectionResults.inspectionId, inspectionId)).get();
                const data: Record<string, unknown> = (resultsRow?.data as Record<string, unknown>) ?? {};
                data._inspector_signature = {
                    signatureBase64: inspector.defaultSignatureBase64,
                    signedAt:        Date.now(),
                    userId:          inspector.id,
                    auto:            true,
                };
                if (resultsRow) {
                    await db.update(inspectionResults)
                        .set({ data: data as object, lastSyncedAt: new Date() })
                        .where(and(eq(inspectionResults.id, resultsRow.id), eq(inspectionResults.tenantId, tenantId)));
                } else {
                    await db.insert(inspectionResults).values({
                        id:           crypto.randomUUID(),
                        tenantId,
                        inspectionId,
                        data:         data as object,
                        lastSyncedAt: new Date(),
                    });
                }
            }
        }

        const tenantRow = await db.select({ slug: tenants.slug })
            .from(tenants).where(eq(tenants.id, tenantId)).get();
        const tenantSlug = tenantRow?.slug ?? '';
        return {
            reportUrl: `/report/${tenantSlug}/${inspectionId}`,
            reportStatus: REPORT_STATUS.PUBLISHED,
        };
    }

    /**
     * Task 12 — check whether an inspection has all required defect fields
     * filled in for every included defect (location + trade). Returns the
     * PublishReadiness payload so the pre-publish gate can surface blocking
     * defects to the inspector.
     *
     * Schema resolution mirrors getReportData: inspection templateSnapshot
     * takes precedence over the live template.schema.
     */
    async computePublishReadiness(inspectionId: string, tenantId: string): Promise<PublishReadiness> {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const template = inspection.templateId
            ? await db.select().from(templates)
                .where(and(eq(templates.id, inspection.templateId as string), eq(templates.tenantId, tenantId)))
                .get()
            : null;

        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        // Prefer per-inspection snapshot over live template schema (mirrors getReportData).
        const inspectionSnapshotRaw = (inspection as unknown as { templateSnapshot?: unknown }).templateSnapshot;
        const inspectionSnapshot = parseMaybeJson(inspectionSnapshotRaw);
        const hasInspectionSnapshot = inspectionSnapshot
            && typeof inspectionSnapshot === 'object'
            && Array.isArray((inspectionSnapshot as { sections?: unknown }).sections)
            && (inspectionSnapshot as { sections: unknown[] }).sections.length > 0;

        let rawSchema: unknown;
        if (hasInspectionSnapshot) {
            rawSchema = inspectionSnapshot;
        } else if (template?.schema) {
            rawSchema = parseMaybeJson(template.schema);
        } else {
            rawSchema = { sections: [] };
        }

        interface RawSchemaData { sections?: unknown[] }
        let schemaData: TemplateSchemaV2;
        if (Array.isArray(rawSchema)) {
            schemaData = { schemaVersion: 2, sections: [{ id: 'general', title: 'General', items: rawSchema }] } as unknown as TemplateSchemaV2;
        } else if ((rawSchema as RawSchemaData).sections) {
            schemaData = rawSchema as TemplateSchemaV2;
        } else {
            schemaData = { schemaVersion: 2, sections: [] } as unknown as TemplateSchemaV2;
        }

        const resultData: Record<string, unknown> = (parseMaybeJson(resultsRow?.data) as Record<string, unknown> | null) ?? {};

        // Track H (IA-7 / P-6②) — effective requirement: per-inspection
        // override beats the tenant default; both unset → 'none' (loose).
        const cfgRow = await db.select({ requireDefectFields: tenantConfigs.requireDefectFields })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const override = (inspection as unknown as { requireDefectFieldsOverride?: RequireDefectFields | null }).requireDefectFieldsOverride;
        const requirement = resolveRequireDefectFields(override, cfgRow?.requireDefectFields);

        return computePublishReadinessFromState(schemaData, resultData, requirement);
    }
}
