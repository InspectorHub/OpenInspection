import { eq, and, inArray } from 'drizzle-orm';
import { inspections, inspectionResults, templates, tenantConfigs, agreementRequests, contactRoleProfiles } from '../../lib/db/schema';
import { resolveAgentRepairAccess, type AgentRepairAccess } from '../../lib/people/agent-repair-access';
import { contacts } from '../../lib/db/schema/contact';
import { PeopleService } from '../people.service';
import { Errors } from '../../lib/errors';
import { safeISODate } from '../../lib/date';
import { logger } from '../../lib/logger';
import { createPrimaryReport } from '../../lib/inspection/reports';
import { writeInspectionServiceSnapshots, type ServiceSelection } from '../../lib/inspection/service-snapshot';
import { computePreflightFromData } from '../../lib/preflight';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { INSPECTION_STATUS, type InspectionStatus } from '../../lib/status/inspection-status';
import { fireAutomation, type Inspection, type InspectionListParams, type CreateInspectionData } from './shared';
import { InspectionSubService } from './base';
import { ServiceService } from '../service.service';
import type { ScopedDB } from '../../lib/db/scoped';
import type { ImagesBinding } from '../../lib/media/strip-exif';
import { InspectionQueryService } from './inspection-query.service';
import { InspectionReinspectionService, type CreatedReinspection } from './inspection-reinspection.service';
import { InspectionCreateVariantsService } from './inspection-create-variants.service';
import { InspectionRecipientsService } from './inspection-recipients.service';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';

/**
 * The inspection PRIMITIVE: create one, read one, and the two guards that
 * creating one needs (contact ownership, agent repair access) plus the publish
 * pre-flight that reads one.
 *
 * What is left here is what everything else calls INTO. The four sub-services
 * it composes are the callers, not peers: `./inspection-query.service` reads
 * MANY, `./inspection-reinspection.service` creates one FROM a published
 * baseline, `./inspection-create-variants.service` translates the wizard
 * payload or an existing row INTO `createInspection`, and
 * `./inspection-recipients.service` reads who is attached. They are composed
 * here rather than on the `InspectionService` facade so that every existing
 * `this.core.x()` delegation on the facade keeps working unchanged.
 */
export class InspectionCoreService extends InspectionSubService {
    /**
     * Free-tier usage-quota guard (optional). Present only in SaaS deploys
     * with `hasUsageQuota` (see deployment-profile.ts); undefined in
     * standalone, where inspection creation stays unlimited. See the three
     * `consumeInspection` call sites in createInspection / createReinspection
     * / cloneInspection.
     */
    private readonly planQuota: PlanQuotaGuard | undefined;
    private readonly query: InspectionQueryService;
    private readonly reinspection: InspectionReinspectionService;
    private readonly variants: InspectionCreateVariantsService;
    private readonly recipients: InspectionRecipientsService;

    constructor(
        db: D1Database,
        r2?: R2Bucket,
        sdb?: ScopedDB,
        kv?: KVNamespace,
        images?: ImagesBinding,
        planQuota?: PlanQuotaGuard,
    ) {
        super(db, r2, sdb, kv, images);
        this.planQuota = planQuota;
        this.query = new InspectionQueryService(db, r2, sdb, kv, images);
        this.reinspection = new InspectionReinspectionService(db, r2, sdb, kv, images, planQuota);
        // `this` is the primitive both variants translate into — see that module.
        this.variants = new InspectionCreateVariantsService(db, r2, sdb, kv, images, planQuota, this);
        this.recipients = new InspectionRecipientsService(db, r2, sdb, kv, images);
    }

    /**
     * Guard: every non-null id in `ids` must be a `contacts` row that belongs
     * to `tenantId`. Throws BadRequest for the first id that fails — preventing
     * cross-tenant contact/agent references from being persisted (D1 does not
     * enforce FK constraints at runtime, so this is the application-layer gate).
     * IA-35 / IA-73 — the tenant's policy for whether agents may act on the
     * repair request list (`off` / `read` / `readwrite`). Stored in the
     * inspectionPrefs JSON; absent → `readwrite` (see the schema default).
     */
    async getAgentRepairAccess(tenantId: string): Promise<AgentRepairAccess> {
        const db = this.getDrizzle();
        const row = await db.select({ prefs: tenantConfigs.inspectionPrefs })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        // Shared with the agent portal, which decides what to OFFER from the
        // same answer this enforces.
        return resolveAgentRepairAccess(row?.prefs);
    }

    /**
     * Called in createInspection before the inspections insert.
     */
    private async assertContactsBelongToTenant(tenantId: string, ids: Array<string | null | undefined>) {
        const want = ids.filter((x): x is string => !!x);
        if (!want.length) return;
        const db = this.getDrizzle();
        const found = await db.select({ id: contacts.id }).from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, want))).all();
        const ok = new Set(found.map(r => r.id as string));
        for (const id of want) if (!ok.has(id)) throw Errors.BadRequest('Unknown contact for this workspace');
    }

    /** Lists inspections with pagination and filtering. Body in `./inspection-query.service`. */
    async listInspections(tenantId: string, params: InspectionListParams) {
        return this.query.listInspections(tenantId, params);
    }

    /** Fetches counts for the dashboard. Body in `./inspection-query.service`. */
    async getStats(tenantId: string) {
        return this.query.getStats(tenantId);
    }

    /**
     * Design System 0520 subsystem E P1.2 — Publish pre-flight gates.
     *
     * Loads the inspection + parsed inspection_results.data and
     * delegates to the pure aggregator in server/lib/preflight.ts.
     */
    async computePreflight(inspectionId: string, tenantId: string) {
        if (!this.sdb) throw new Error('ScopedDB session missing');

        const ins = await this.sdb.getById(inspections, inspectionId);
        if (!ins) throw Errors.NotFound('Inspection not found');

        const resultsRow = await this.sdb.raw.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const items: Record<string, { rating?: unknown; value?: unknown }> = (() => {
            const raw = resultsRow?.data;
            if (!raw) return {};
            try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return (parsed && typeof parsed === 'object') ? parsed as Record<string, never> : {};
            } catch { return {}; }
        })();

        return computePreflightFromData(
            {
                coverPhotoId:      (ins.coverPhotoId as string | null) ?? null,
                propertyFacts:     (ins.propertyFacts as Record<string, unknown> | null) ?? null,
                agreementSignedAt: (ins.agreementSignedAt as number | null) ?? null,
            },
            items,
        );
    }

    async getInspection(id: string, tenantId: string) {
        if (!this.sdb) throw new Error('ScopedDB session missing');

        const result = await this.sdb.getById(inspections, id);
        if (!result) throw Errors.NotFound('Inspection not found');

        const template = result.templateId
            ? await this.sdb.getById(templates, result.templateId as string)
            : null;
        // Track I-a — signed truth rides the envelope: a signed agreement_requests
        // row (any channel — emailed OR on-site) sets signedByClient.
        const signed = await this.sdb.raw.select({ id: agreementRequests.id }).from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            ))
            .get();

        // Task 9c (people-role-profiles) — clientName/clientEmail/clientPhone
        // are sourced from the inspection_people primary-client join
        // (PeopleService), not the legacy inspections.client_name/_email/_phone
        // columns (frozen cache, dropped Task 13). Hard cutover, no
        // legacy-column fallback — mirrors invoices.ts requestPaymentRoute /
        // agreements.ts / publish.ts elsewhere on this branch.
        const primaryClient = await new PeopleService({ DB: this.db }).getPrimaryClient(tenantId, id);

        return {
            inspection: {
                ...result,
                id: result.id as string,
                propertyAddress: result.propertyAddress as string,
                clientName: primaryClient?.name ?? null,
                clientEmail: primaryClient?.email ?? null,
                clientPhone: primaryClient?.phone ?? null,
                status: result.status as InspectionStatus,
                date: result.date as string,
                inspectorId: result.inspectorId as string | null,
                templateId: result.templateId as string | null,
                createdAt: safeISODate(result.createdAt),
                signedByClient: !!signed
            },
            template: template || null
        };
    }

    /**
     * Creates a new inspection.
     */
    async createInspection(tenantId: string, data: CreateInspectionData & { inspectorId?: string; clientContactId?: string }): Promise<Inspection> {
        if (!this.sdb) throw new Error('ScopedDB session missing');
        const id = crypto.randomUUID();
        const createdAt = new Date();
        const status = INSPECTION_STATUS.REQUESTED;
        const date = data.date || createdAt.toISOString();

        const db = this.getDrizzle();

        let templateSnapshot: unknown = null;
        let templateSnapshotVersion = 1;
        if (data.templateId) {
            const tpl = await db.select().from(templates)
                .where(and(eq(templates.id, data.templateId), eq(templates.tenantId, tenantId))).get();
            if (tpl) {
                templateSnapshot = tpl.schema;
                templateSnapshotVersion = tpl.version;
                // Sprint 2 S2-1 — the template's rating system is captured at
                // first results-write time (see updateResults below) rather
                // than at inspection creation. Until the inspector touches an
                // item the inspection_results row doesn't exist yet, so there
                // is nowhere to attach the snapshot here.
            }
        }

        // Round-2 #10 — read tenant block-report policy. New inspections
        // inherit `paymentRequired` / `agreementRequired` defaults from
        // `tenant_configs`. Per-inspection override (if the caller sets
        // either flag explicitly) still wins.
        const tenantPolicy = await db
            .select({
                blockUnpaid:            tenantConfigs.blockUnpaid,
                blockUnsignedAgreement: tenantConfigs.blockUnsignedAgreement,
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const defaultPaymentRequired   = tenantPolicy?.blockUnpaid ?? false;
        const defaultAgreementRequired = tenantPolicy?.blockUnsignedAgreement ?? false;

        // #180 — Atomic discount redemption. When a discountCodeId is supplied,
        // attempt an atomic cap-guarded increment. If the cap has been reached
        // (redeemDiscountCode returns false), drop the discount from the persisted
        // row but still create the inspection successfully. The preview-only
        // validateDiscountCode path is unaffected.
        const rawDiscountCodeId = (data as { discountCodeId?: string | null }).discountCodeId ?? null;
        const rawDiscountAmount = (data as { discountAmount?: number | null }).discountAmount ?? null;

        let persistedDiscountCodeId: string | null = null;
        let persistedDiscountAmount: number = 0;

        if (rawDiscountCodeId) {
            const svcSvc = new ServiceService(this.db);
            const redeemed = await svcSvc.redeemDiscountCode(tenantId, rawDiscountCodeId);
            if (redeemed) {
                persistedDiscountCodeId = rawDiscountCodeId;
                persistedDiscountAmount = rawDiscountAmount ?? 0;
            }
            // If redeemed === false: cap hit or code gone — drop the discount silently;
            // the inspection is still created without it.
        }

        // Task 13 (people-role-profiles) — the client/agent identity is NOT
        // stored on the inspections row anymore (clientContactId/clientName/
        // clientEmail/clientPhone/referredByAgentId/sellingAgentId columns
        // dropped, superseded by inspection_people). These locals stay
        // derived from the INPUT DTO and feed the contact soft-upsert +
        // inspection_people writes below; only the row insert itself lost
        // the fields.
        const clientContactIdInput = (data as { clientContactId?: string }).clientContactId ?? null;
        const clientNameInput = data.clientName || 'Private Client';
        const clientEmailInput = (data.clientEmail as string | null) || null;
        const clientPhoneInput = data.clientPhone ?? null;
        const referredByAgentIdInput = (data.referredByAgentId as string | null) || null;
        const sellingAgentIdInput = (data.sellingAgentId as string | null) || null;

        const newInspection = {
            id,
            tenantId,
            inspectorId: data.inspectorId || null,
            propertyAddress: data.propertyAddress,
            templateId: data.templateId,
            templateSnapshot,
            templateSnapshotVersion,
            status,
            date,
            // Spec 5D — geocoded fields, all optional (legacy free-text addresses ok)
            addressPlaceId:    (data.addressPlaceId as string | null) || null,
            addressStreet:     (data.addressStreet as string | null) || null,
            addressCity:       (data.addressCity as string | null) || null,
            addressState:      (data.addressState as string | null) || null,
            addressZip:        (data.addressZip as string | null) || null,
            addressCounty:     (data.addressCounty as string | null) || null,
            addressLat:        (data.addressLat as number | null) ?? null,
            addressLng:        (data.addressLng as number | null) ?? null,
            addressGeocodedAt: data.addressPlaceId ? new Date() : null,
            // #180 — discount columns set after atomic redemption above.
            // null/0 when no code was supplied or the cap blocked redemption.
            discountCodeId:    persistedDiscountCodeId,
            discountAmount:    persistedDiscountAmount,
            // Round-2 #10 — block-report gating defaults inherited from tenant
            // policy. The Sprint 1 D-7 ReportGatePage check at /report/:id
            // reads these per-inspection columns directly.
            paymentRequired:   data.paymentRequired   ?? defaultPaymentRequired,
            agreementRequired: data.agreementRequired ?? defaultAgreementRequired,
            createdAt
        };

        await this.assertContactsBelongToTenant(tenantId, [referredByAgentIdInput, sellingAgentIdInput, clientContactIdInput]);
        // Quota is consumed only after every precondition check above has
        // passed and immediately before the row that actually creates the
        // inspection — a failed validation (e.g. a bad contact reference)
        // must never burn a free tenant's lifetime slot.
        await this.planQuota?.consumeInspection(tenantId);
        await this.sdb.insert(inspections, newInspection);
        // Before the results row, because that row has to NAME it: a NULL
        // `report_id` is accepted silently and reads match a sibling document
        // or none. See `lib/inspection/reports.ts`.
        const primaryReportId = await createPrimaryReport(db, tenantId, id, data.templateId ?? null);
        // Every inspection starts with a results row.
        //
        // The collaborative editor's Durable Object writes findings by UPDATEing
        // this row, and an UPDATE that matches nothing changes nothing without
        // complaining — so an inspection created without it accepted edits in
        // the UI that never reached the database. The DO now inserts as a
        // fallback, but the invariant belongs here, where the inspection is
        // born: results exist for every inspection, empty until someone rates
        // something.
        await db.insert(inspectionResults).values({
            id:           crypto.randomUUID(),
            tenantId,
            inspectionId: id,
            reportId:     primaryReportId,
            data:         {},
            lastSyncedAt: createdAt,
        });
        // DB-8: mirror assignment into inspection_inspectors link table.
        // Non-fatal — a sync failure must not roll back a committed inspection row.
        try {
            await syncInspectionAssignments(db, tenantId, id, { inspectorId: newInspection.inspectorId });
        } catch (e) {
            logger.error('inspection.assignment-sync.failed', { inspectionId: id }, e instanceof Error ? e : undefined);
        }
        await fireAutomation(this.db, tenantId, id, 'inspection.created');

        // Soft-upsert the client into Contacts so it shows up in the Contacts list
        // for future re-use (search, agent linking). Idempotent on tenantId+email
        // (or tenantId+name if no email). Failures are non-fatal — inspection
        // creation must not break because of a contact-side issue. Captures the
        // resolved/created contact id for the inspection_people write below.
        let resolvedClientContactId: string | null = clientContactIdInput;
        if (clientNameInput !== 'Private Client') {
            try {
                const matchConds = [eq(contacts.tenantId, tenantId), eq(contacts.type, 'client')];
                if (clientEmailInput) matchConds.push(eq(contacts.email, clientEmailInput));
                else matchConds.push(eq(contacts.name, clientNameInput));
                const existing = await db.select().from(contacts).where(and(...matchConds)).get();
                if (existing) {
                    resolvedClientContactId = resolvedClientContactId ?? existing.id;
                } else {
                    const newContactId = crypto.randomUUID();
                    await db.insert(contacts).values({
                        id: newContactId,
                        tenantId,
                        type: 'client',
                        name: clientNameInput,
                        email: clientEmailInput,
                        phone: clientPhoneInput,
                        agency: null,
                        notes: null,
                        createdAt: createdAt,
                    });
                    resolvedClientContactId = resolvedClientContactId ?? newContactId;
                }
            } catch (err) {
                logger.error('contact upsert from inspection failed', { inspectionId: id }, err instanceof Error ? err : undefined);
            }
        }

        // Task 7 (people-role-profiles) — mirror the primary client, buyer's
        // agent, and listing agent into the inspection_people join table.
        // Task 13 dropped the legacy clientContactId / referredByAgentId /
        // sellingAgentId columns from the inspections row — this is now the
        // ONLY place WHO is persisted. Best-effort: a people-write failure
        // must never roll back an already-committed inspection row.
        try {
            const roleRows = await db.select({ id: contactRoleProfiles.id, key: contactRoleProfiles.key })
                .from(contactRoleProfiles)
                .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true)));
            const roleIdByKey = new Map(roleRows.map(r => [r.key, r.id]));
            const people = new PeopleService({ DB: this.db });
            const links: Array<[string | null, string | undefined]> = [
                [resolvedClientContactId,   roleIdByKey.get('client')],
                [referredByAgentIdInput,    roleIdByKey.get('buyer_agent')],
                [sellingAgentIdInput,       roleIdByKey.get('listing_agent')],
            ];
            for (const [contactId, roleProfileId] of links) {
                if (contactId && roleProfileId) await people.addPerson(tenantId, id, contactId, roleProfileId);
            }
        } catch (err) {
            logger.error('inspection-people write from inspection create failed', { inspectionId: id }, err instanceof Error ? err : undefined);
        }

        // Link selected services — the tier-2 money authority. Shared with any
        // other path that must produce the same rows; see the module doc.
        await writeInspectionServiceSnapshots(db, tenantId, id, {
            serviceSelections: (data as { serviceSelections?: ServiceSelection[] }).serviceSelections,
            serviceIds:        data.serviceIds,
        });

        return {
            ...newInspection,
            clientName: clientNameInput,
            clientEmail: clientEmailInput,
            inspectorId: newInspection.inspectorId as string | null,
            createdAt: safeISODate(newInspection.createdAt)
        } as Inspection;
    }

    /** #119 — creates a follow-up round over a published baseline. Body in `./inspection-reinspection.service`. */
    async createReinspection(
        tenantId: string,
        baselineId: string,
        opts: { selectedItemIds: string[]; inspectorId?: string | undefined },
    ): Promise<CreatedReinspection> {
        return this.reinspection.createReinspection(tenantId, baselineId, opts);
    }

    /** #119 — what is still open on a baseline and can carry into a round. Body in `./inspection-reinspection.service`. */
    async getReinspectCandidates(
        tenantId: string,
        baselineId: string,
    ): Promise<Array<{ itemId: string; label: string; originalNotes: string | null; open: boolean }>> {
        return this.reinspection.getReinspectCandidates(tenantId, baselineId);
    }

    /** IA-1 post-create hook — priceOverride onto existing rows. Body in `./inspection-create-variants.service`. */
    async applyServicePriceOverrides(
        inspectionId: string,
        tenantId: string,
        selections: ServiceSelection[],
    ): Promise<void> {
        return this.variants.applyServicePriceOverrides(inspectionId, tenantId, selections);
    }

    /** NewInspectionWizard creation path. Body in `./inspection-create-variants.service`. */
    async createFromWizard(
        tenantId: string,
        creatorUserId: string,
        input: import('../../lib/validations/wizard.schema').CreateInspectionFromWizardInput,
    ): Promise<{ id: string }> {
        return this.variants.createFromWizard(tenantId, creatorUserId, input);
    }

    /** Clones an existing inspection. Body in `./inspection-create-variants.service`. */
    async cloneInspection(id: string, tenantId: string): Promise<Inspection> {
        return this.variants.cloneInspection(id, tenantId);
    }

    /** Round-2 F1 — parties an inspection can be delivered to. Body in `./inspection-recipients.service`. */
    async getRecipientList(inspectionId: string, tenantId: string) {
        return this.recipients.getRecipientList(inspectionId, tenantId);
    }

    /** IA-18 — the inspector portal People card. Body in `./inspection-recipients.service`. */
    async getPeopleCard(inspectionId: string, tenantId: string) {
        return this.recipients.getPeopleCard(inspectionId, tenantId);
    }

}