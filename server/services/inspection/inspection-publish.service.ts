import { eq, and, desc, inArray } from 'drizzle-orm';
// `templates` is deliberately absent: #307 removed the live-template fallback,
// so nothing in this file reads the templates row any more.
import { inspections, inspectionResults, users, tenantConfigs, tenants, inspectionServices, agreements, agreementRequests, agreementSigners, invoices, contacts } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { applyAutoSignatureOnPublish } from '../../lib/inspection/auto-sign';
import {
    lastSiblingNotifiedAt,
    markReportNotified,
    markReportPublished,
    resolvePublishTargetReport,
    shouldCoalesceNotification,
} from '../../lib/inspection/report-notifications';
import { safeISODate } from '../../lib/date';
import { resolveLocale } from '../../lib/locale';
import { InvoiceService } from '../invoice.service';
import { PeopleService } from '../people.service';
import { REPORT_STATUS } from '../../lib/status/report-status';
import type { AgreementService } from '../agreement.service';
import type { TemplateSchemaV2 } from '../../types/template-schema';
import {
    fireAutomation,
    resolvePublishTrigger,
    resolveRequireDefectFields,
    computePublishReadinessFromState,
    requireTemplateSnapshot,
    type RequireDefectFields,
    type PublishReadiness,
} from './shared';
import { communicationCounts } from '../../lib/communication-counts';
import { listReportsForHub, type ReportListItem } from '../../lib/inspection/reports';
import { InspectionSubService } from './base';
import { CredentialService } from '../credential.service';
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
     * (tier-2 link); when it is absent or yields no outstanding signer there is
     * no signing URL to offer, and the CTA routes to the report rather than to a
     * link that cannot resolve.
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
            unlockedAt:        inspections.unlockedAt,
        }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) return null;

        // THE PAY GATE IS THE INVOICE'S, AND THE INVOICE IS THE ORDER'S. One
        // order, one invoice, one payment — paying it unlocks whatever has been
        // published, and a client who has paid is not asked again because a
        // second report arrived later. Per-report payment would need per-report
        // invoicing, which is a different product.
        //
        // A manual unlock releases the gate for this whole inspection, which is
        // the same scope the gate itself has.
        //
        // THE GATE IS ORDER-WIDE, DELIBERATELY. Any required agreement left
        // unsigned, or payment outstanding, blocks EVERY report on this
        // inspection — not just the report belonging to the service whose
        // agreement is missing. One job, one set of paperwork, one rule a client
        // and an inspector can both state without looking it up.
        //
        // The cost of that rule is real: an add-on's unsigned addendum can hold
        // back a report that is finished and that someone is waiting for. The
        // answer is this unlock — a named person opening one inspection and
        // recording why — rather than resolving the gate per report, which would
        // require a service dimension on `agreement_requests`, a signed-evidence
        // table with a retention rule, to solve what one override solves.
        if (insp.unlockedAt) return null;

        // Resolve the outstanding gate. Agreement before payment (signed first).
        let reason: 'payment' | 'agreement' | null = null;
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

        let inspector: { name: string | null; email: string | null; phone: string | null } | undefined;
        let licenseNumber: string | null = null;
        if (insp.inspectorId) {
            inspector = await db.select({
                name: users.name, email: users.email, phone: users.phone,
            }).from(users)
                .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId)))
                .get();
            // The licence is a credential row — `users` carries no licence column.
            licenseNumber = await new CredentialService(this.db)
                .primaryLicenseNumber(tenantId, insp.inspectorId);
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
        // the agreement-only sign URL. Real tokens live per-signer, so this is
        // the only source: there is no envelope-level token to fall back to.
        //
        // There used to be one, guarded by "still resolves for legacy envelopes
        // whose plaintext token IS distributed". That stopped being true when
        // envelope lookup went hash-only — those rows resolve by `token_hash`,
        // which is NULL on exactly the envelopes the fallback was there for. It
        // was handing the customer a link that could only 404, which is worse
        // than offering no link: no link routes them to their report instead.
        let signerLink: string | null = null;
        if ((bothOutstanding || reason === 'agreement') && agreementService) {
            signerLink = await agreementService.getFirstOutstandingSignerLink(tenantId, inspectionId);
        }
        const agreementLinkToken = signerLink;

        let actionUrl: string;
        let actionLabel: string;
        if (bothOutstanding && signerLink) {
            actionUrl = `/checkout/${tenantSlug}/${signerLink}`;
            actionLabel = 'Sign & pay';
        } else if (reason === 'payment') {
            actionUrl = `/invoice/${inspectionId}`;
            actionLabel = 'Pay invoice';
        } else {
            // IA-45 — when no signer link can be reconstructed, fall back to the
            // Hub overview (which now carries the lock reason + CTA inline), never
            // to /report-gate: that route is retired and the old self-reference
            // formed a closed loop (the page's own CTA pointed back at itself).
            actionUrl = agreementLinkToken
                ? `/agreements/sign/${tenantSlug}/${agreementLinkToken}`
                : `/portal/${tenantSlug}/i/${inspectionId}?section=overview`;
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
            inspectorLicense: licenseNumber,
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
            // The order-wide gate's release record. Null when still gated.
            unlockedAt: string | null;
            unlockedByName: string | null;
            unlockReason: string | null;
            coverPhoto: string | null;
            referredByAgentId: string | null;
            sellingAgentId: string | null;
            createdAt: string | null;
            closingDate: string | null;
            referenceNumber: string | null;
            referralSource: string | null;
            referredByContactId: string | null;
            referredByName: string | null;
        };
        tenantSlug: string;
        people: Awaited<ReturnType<InspectionService['getPeopleCard']>>;
        services: Array<{ id: string; serviceId: string; name: string; priceCents: number; priceSnapshot: number; priceOverride: number | null }>;
        agreements: Array<{ id: string; name: string }>;
        agreementRequests: Array<{
            id: string;
            status: string;
            clientEmail: string;
            signedAt: string | null;
            createdAt: string | null;
            agreementName: string | null;
            signersTotal: number;
            signersSigned: number;
        }>;
        invoice: {
            id: string; status: string; amountCents: number;
            /** Cumulative amount received; null when partial with no recorded figure. */
            amountPaidCents: number | null;
            currency: string; sentAt: string | null; paidAt: string | null;
        } | null;
        publishReadiness: { ready: boolean; blockingCount: number };
        communication: { delivered: number; needsAttention: number; unread: number };
        /** The order's deliverables. One order, several reports. */
        reports: ReportListItem[];
    } | null> {
        const db = this.getDrizzle();

        // Authority row — gate on existence + tenant ownership first.
        const insp = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) return null;

        // The unlock record is meant to be READ by a person later, so resolve
        // the name here rather than shipping an opaque id to the browser. A
        // deleted teammate leaves it null and the UI says "a teammate" — the
        // release still happened and the reason still stands.
        let unlockedByName: string | null = null;
        if (insp.unlockedBy) {
            const u = await db.select({ name: users.name, email: users.email }).from(users)
                .where(and(eq(users.id, insp.unlockedBy), eq(users.tenantId, tenantId)))
                .get();
            unlockedByName = u?.name ?? u?.email ?? null;
        }

        // Service lines — effective price = priceOverride ?? priceSnapshot
        // (P-4 authority chain, tier 2). Tenant-scoped on both columns.
        const serviceRows = await db.select({
            id:            inspectionServices.id,
            serviceId:     inspectionServices.serviceId,
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

        // Agreement requests for this inspection, newest first. IA-65 — the hub
        // now owns signer management, so each envelope arrives with the template
        // name it was sent from and its signing progress. Both were previously
        // reachable only from the tenant-wide Library page.
        const requestRows = await db.select({
            id:            agreementRequests.id,
            status:        agreementRequests.status,
            clientEmail:   agreementRequests.clientEmail,
            signedAt:      agreementRequests.signedAt,
            createdAt:     agreementRequests.createdAt,
            agreementName: agreements.name,
        }).from(agreementRequests)
            .leftJoin(agreements, eq(agreementRequests.agreementId, agreements.id))
            .where(and(
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.inspectionId, inspectionId),
            ))
            .orderBy(desc(agreementRequests.createdAt))
            .all();

        // Signer tallies for those envelopes. One extra round trip over the
        // whole set rather than one per row — an inspection carries a handful of
        // envelopes at most, and the per-row shape is what invites an N+1.
        const signerRows = requestRows.length > 0
            ? await db.select({ requestId: agreementSigners.requestId, status: agreementSigners.status })
                .from(agreementSigners)
                .where(and(
                    eq(agreementSigners.tenantId, tenantId),
                    inArray(agreementSigners.requestId, requestRows.map((r) => r.id)),
                ))
                .all()
            : [];
        const signerTally = new Map<string, { total: number; signed: number }>();
        for (const s of signerRows) {
            const cur = signerTally.get(s.requestId) ?? { total: 0, signed: 0 };
            cur.total += 1;
            if (s.status === 'signed') cur.signed += 1;
            signerTally.set(s.requestId, cur);
        }

        // Reused primitives. getPeopleCard/computePublishReadiness throw NotFound
        // when the row is absent — but we already confirmed it exists above, so
        // they resolve. InvoiceService is constructed inline (it takes only a
        // D1Database, same handle this service holds) per the DI guidance: no
        // constructor-chain redesign, just compose the read.
        const invoiceSvc = new InvoiceService(this.db);
        const peopleSvc = new PeopleService({ DB: this.db });
        // Task 9c — the flat `inspection.*` client/agent fields (kept for the
        // hub page's bare-text client fallback + the /contacts/:id link, and
        // for API-consumer back-compat) are resolved via inspection_people,
        // NOT the legacy inspections.client_name/_email/_phone/_contact_id/
        // referred_by_agent_id/selling_agent_id columns — those survive GDPR
        // erasure as a stale denormalized cache and would leak an erased
        // subject's PII. `people` below (getPeopleCard) already sources the
        // same way; this projection is a separate, intentionally-duplicated
        // read for the flat shape this endpoint has always returned.
        const [people, readiness, invoice, primaryClient, buyerAgentId, listingAgentId] = await Promise.all([
            this.facade.getPeopleCard(inspectionId, tenantId),
            this.computePublishReadiness(inspectionId, tenantId),
            invoiceSvc.findByInspectionId(tenantId, inspectionId),
            peopleSvc.getPrimaryClient(tenantId, inspectionId),
            peopleSvc.contactIdForRole(tenantId, inspectionId, 'buyer_agent'),
            peopleSvc.contactIdForRole(tenantId, inspectionId, 'listing_agent'),
        ]);

        const communication = await communicationCounts(db, tenantId, inspectionId);
        const reportList = await listReportsForHub(db, tenantId, inspectionId);

        // Task 8 — resolve the referrer's display name for the Order details
        // card. Soft reference: a deleted contact resolves null, and the card
        // renders the unattributed state rather than a dangling id.
        let referredByName: string | null = null;
        if (insp.referredByContactId) {
            const ref = await db.select({ name: contacts.name }).from(contacts)
                .where(and(eq(contacts.id, insp.referredByContactId), eq(contacts.tenantId, tenantId)))
                .get();
            referredByName = ref?.name ?? null;
        }

        return {
            inspection: {
                id:                insp.id,
                propertyAddress:   insp.propertyAddress,
                clientName:        primaryClient?.name ?? null,
                clientEmail:       primaryClient?.email ?? null,
                clientPhone:       primaryClient?.phone ?? null,
                clientContactId:   primaryClient?.contactId ?? null,
                status:            insp.status,
                reportStatus:      insp.reportStatus as string,
                date:              insp.date ?? null,
                inspectorId:       insp.inspectorId ?? null,
                templateId:        insp.templateId ?? null,
                price:             insp.price,
                paymentStatus:     insp.paymentStatus,
                paymentRequired:   insp.paymentRequired === true,
                agreementRequired: insp.agreementRequired === true,
                unlockedAt:        safeISODate(insp.unlockedAt) ?? null,
                // The NAME, not the id: this record exists to be read by a
                // person later, and an opaque uuid tells them nothing.
                unlockedByName:    unlockedByName,
                unlockReason:      insp.unlockReason ?? null,
                coverPhoto:        insp.coverPhotoId ?? null,
                referredByAgentId: buyerAgentId,
                sellingAgentId:    listingAgentId,
                createdAt:         safeISODate(insp.createdAt),
                // IA-87 / settings-merge — the order facts that used to be
                // editable ONLY from the report editor's settings sheet. They
                // describe the order, not the report, so the hub owns them now
                // and needs them in its own payload.
                closingDate:       insp.closingDate ?? null,
                referenceNumber:   insp.referenceNumber ?? null,
                referralSource:    insp.referralSource ?? null,
                referredByContactId: insp.referredByContactId ?? null,
                referredByName,
            },
            tenantSlug,
            people,
            services: serviceRows.map(s => ({
                id:        s.id,
                serviceId: s.serviceId,
                name:      s.nameSnapshot,
                priceCents: s.priceOverride ?? s.priceSnapshot,
                // The two components of the effective price, so the hub can
                // show "was $X, charging $Y" and offer a revert.
                priceSnapshot: s.priceSnapshot,
                priceOverride: s.priceOverride ?? null,
            })),
            agreements: agreementRows.map(a => ({ id: a.id, name: a.name })),
            agreementRequests: requestRows.map(r => ({
                id:            r.id,
                status:        r.status,
                clientEmail:   r.clientEmail,
                signedAt:      r.signedAt ? safeISODate(r.signedAt) : null,
                createdAt:     safeISODate(r.createdAt),
                agreementName: r.agreementName ?? null,
                signersTotal:  signerTally.get(r.id)?.total ?? 0,
                signersSigned: signerTally.get(r.id)?.signed ?? 0,
            })),
            invoice: invoice
                ? {
                    id:         invoice.id,
                    status:     invoice.status,
                    amountCents: invoice.amountCents,
                    amountPaidCents: invoice.amountPaidCents ?? null,
                    currency:   invoice.currency,
                    sentAt:     invoice.sentAt,
                    paidAt:     invoice.paidAt,
                }
                : null,
            publishReadiness: {
                ready:         readiness.ready,
                blockingCount: readiness.blockingDefects.length,
            },
            communication,
            reports: reportList,
        };
    }

    /**
     * Publishes one of an inspection's reports (transitions to delivered status).
     *
     * `reportId` names WHICH deliverable — a standard report today, the radon
     * report on Thursday. Omitted, it means the order's primary report, which is
     * what every caller predating multi-report delivery intends.
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
        /** Which report to publish. Defaults to the inspection's primary. */
        reportId?: string;
    }) {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');
        // The order lifecycle does not gate delivery — a report can ship while
        // the order is still scheduled. Content completeness: publishReadiness.

        // Which deliverable — the standard report today, radon on Thursday.
        // Validation and tenant re-resolution live in resolvePublishTargetReport.
        const now = new Date();
        const targetReportId = await resolvePublishTargetReport(
            db, tenantId, inspectionId, _options.reportId);

        await db.update(inspections)
            .set({ reportStatus: REPORT_STATUS.PUBLISHED })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        if (targetReportId) await markReportPublished(db, tenantId, targetReportId, now);

        // Await so AutomationService.trigger actually inserts automation_logs
        // before the response goes out — the prior fire-and-forget pattern
        // dangled the promise so CF terminated the isolate before the insert
        // completed (and ditto for inspection.confirmed / cancelled / created
        // below — all four paths now block on trigger). First publish fires
        // report.published; a re-publish (a prior version row exists) fires
        // report.amended so the client gets a distinct amendment notice.
        const reportTrigger = await resolvePublishTrigger(
            this.db, tenantId, inspectionId, targetReportId ?? undefined);

        // COALESCE WITHIN A WINDOW (see lib/inspection/report-notifications).
        // An AMENDMENT is never coalesced — "your report changed" is its own
        // thing to say, and suppressing it leaves the client reading a document
        // they think they have already seen.
        const coalesced = reportTrigger === 'report.published' && shouldCoalesceNotification(
            targetReportId ? await lastSiblingNotifiedAt(db, tenantId, inspectionId, targetReportId) : null,
            now.getTime());

        if (coalesced) {
            logger.info('report notification coalesced into a sibling delivery',
                { inspectionId, reportId: targetReportId });
        } else {
            await fireAutomation(this.db, tenantId, inspectionId, reportTrigger,
                targetReportId ?? undefined);
            if (targetReportId) await markReportNotified(db, tenantId, targetReportId, now);
        }

        // Spec 5H D2 — auto-sign on publish (lib/inspection/auto-sign).
        await applyAutoSignatureOnPublish(db, tenantId, inspectionId);

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
     * Schema resolution mirrors getReportData: the inspection's own
     * templateSnapshot, and nothing else (#307). The live `templates` row is
     * deliberately not read here any more — see requireTemplateSnapshot.
     */
    async computePublishReadiness(inspectionId: string, tenantId: string): Promise<PublishReadiness> {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        // #307 — the per-inspection snapshot is REQUIRED, not preferred. This
        // used to fall back to the live template schema, so "may this report be
        // published" could be answered against a structure the inspector never
        // saw. A missing snapshot fails loudly with the inspection id instead.
        const schemaData: TemplateSchemaV2 = requireTemplateSnapshot(
            inspection as { id: string; templateId?: string | null; templateSnapshot?: unknown },
            tenantId,
        );

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
