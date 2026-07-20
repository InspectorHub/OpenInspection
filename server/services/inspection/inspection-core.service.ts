import { eq, and, or, lt, gte, lte, sql, inArray, desc } from 'drizzle-orm';
import { inspections, inspectionResults, templates, users, services, inspectionServices, tenantConfigs, agreementRequests, reportVersions, contactRoleProfiles, inspectionPeople } from '../../lib/db/schema';
import { contacts } from '../../lib/db/schema/contact';
import { PeopleService } from '../people.service';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { Errors } from '../../lib/errors';
import { getRatingBucket, type RatingLevel } from '../../lib/report-utils';
import { mapRatingSystemLevels } from '../../lib/map-rating-levels';
import { escapeLikePattern } from '../../lib/db/like-escape';
import { safeISODate, safeTimestamp } from '../../lib/date';
import { logger } from '../../lib/logger';
import { computePreflightFromData } from '../../lib/preflight';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { findingKey, DEFAULT_UNIT } from '../../lib/finding-key';
import { parseReinspectionStatuses, isOpenStatus } from '../../lib/reinspection-status';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { fireAutomation, type Inspection, type InspectionListParams, type CreateInspectionData } from './shared';
import { InspectionSubService } from './base';
import { ServiceService } from '../service.service';
import type { ScopedDB } from '../../lib/db/scoped';
import type { ImagesBinding } from '../../lib/media/strip-exif';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';

/** Internal — one Publish-modal recipient row (client or agent). Not exported:
 *  the public `getRecipientList` signature keeps its inline structural type. */
interface InspectionRecipient {
    contactId: string | null;
    name:      string;
    role:      'client' | 'agent_buyer' | 'agent_listing';
    email:     string | null;
    phone:     string | null;
}

/** `contact_role_profiles.key` → `InspectionRecipient.role`, for the three
 *  roles `getRecipientList` covers. Other role keys (co_client, attorney,
 *  ...) are intentionally absent — Spec 2 widens the recipient set. */
const RECIPIENT_ROLE_MAP: Record<string, 'client' | 'agent_buyer' | 'agent_listing'> = {
    client:        'client',
    buyer_agent:   'agent_buyer',
    listing_agent: 'agent_listing',
};

/** Parse a report_versions.snapshotJson payload (snapshotOnPublish serialises
 *  `{ inspection, data, units }`); both re-inspection paths read only `.data`,
 *  keyed by findingKey or legacy item id. */
function parseSnapshotData(snapshotJson: string): { data?: Record<string, Record<string, unknown>> } {
    return JSON.parse(snapshotJson) as { data?: Record<string, Record<string, unknown>> };
}

/**
 * Core inspection CRUD + lifecycle: list / stats / preflight / get / create /
 * reinspection / candidates / service-price overrides / wizard create / clone,
 * plus the recipient + people aggregation cards. Extracted verbatim from
 * InspectionService. Self-contained (cloneInspection calls getInspection
 * internally on this service).
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
    }

    /**
     * Guard: every non-null id in `ids` must be a `contacts` row that belongs
     * to `tenantId`. Throws BadRequest for the first id that fails — preventing
     * cross-tenant contact/agent references from being persisted (D1 does not
     * enforce FK constraints at runtime, so this is the application-layer gate).
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

    /**
     * Lists inspections with pagination and filtering.
     */
    async listInspections(tenantId: string, params: InspectionListParams) {
        const db = this.getDrizzle();
        const conditions = [eq(inspections.tenantId, tenantId)];

        if (params.status) conditions.push(eq(inspections.status, params.status));
        if (params.inspectorId) conditions.push(eq(inspections.inspectorId, params.inspectorId));
        if (params.dateFrom) conditions.push(gte(inspections.date, params.dateFrom));
        if (params.dateTo) conditions.push(lte(inspections.date, params.dateTo));
        
        if (params.search) {
            const term = `%${escapeLikePattern(params.search)}%`;
            conditions.push(or(
                sql`lower(${inspections.propertyAddress}) like lower(${term})`,
                sql`lower(${contacts.name}) like lower(${term})` // primary-client join below, not the frozen legacy inspections.client_name
            )!);
        }

        const tabParam = (params as { tab?: string }).tab;
        if (tabParam && tabParam !== 'all') {
            const todayStr = new Date().toISOString().slice(0, 10);
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            switch (tabParam) {
                case 'today':
                    conditions.push(sql`date(${inspections.date}) = ${todayStr}`);
                    break;
                case 'upcoming':
                    conditions.push(sql`${inspections.date} > ${todayStr}`);
                    conditions.push(sql`${inspections.status} not in ('completed','cancelled')`);
                    break;
                case 'past':
                    conditions.push(or(
                        sql`${inspections.date} < ${todayStr}`,
                        inArray(inspections.status, ['completed', 'cancelled'])
                    )!);
                    break;
                case 'unconfirmed':
                    conditions.push(eq(inspections.status, 'scheduled'));
                    conditions.push(sql`${inspections.createdAt} < ${cutoff}`);
                    break;
                case 'in_progress':
                    conditions.push(eq(inspections.reportStatus, REPORT_STATUS.IN_PROGRESS));
                    break;
            }
        }

        if (params.cursor) {
            try {
                const c = JSON.parse(atob(params.cursor));
                conditions.push(or(
                    lt(inspections.createdAt, new Date(c.createdAt)),
                    and(eq(inspections.createdAt, new Date(c.createdAt)), lt(inspections.id, c.id))
                )!);
            } catch { throw Errors.BadRequest('Invalid cursor'); }
        }

        // Task 9c (people-role-profiles) — clientName/clientEmail are sourced
        // from the inspection_people primary-client join, not the legacy
        // inspections.client_name/_email columns (frozen cache, dropped Task
        // 13). A single LEFT JOIN keeps this list N+1-free; contact_role_profiles
        // is joined BEFORE inspection_people (filtered to the 'client' role)
        // so the join stays scoped to the primary client, mirroring the join
        // order already used for top-agents in api/metrics.ts.
        const rows = await db.select({
            inspection: inspections,
            primaryClientName: contacts.name,
            primaryClientEmail: contacts.email,
        })
            .from(inspections)
            .leftJoin(contactRoleProfiles, and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                eq(contactRoleProfiles.active, true),
            ))
            .leftJoin(inspectionPeople, and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ))
            .leftJoin(contacts, and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
            ))
            .where(and(...conditions))
            .orderBy(sql`${inspections.createdAt} desc, ${inspections.id} desc`)
            .limit(params.limit + 1);

        const hasMore = rows.length > params.limit;
        const page = hasMore ? rows.slice(0, params.limit) : rows;

        let nextCursor: string | null = null;
        if (hasMore) {
            const last = page[page.length - 1].inspection;
            nextCursor = btoa(JSON.stringify({ createdAt: safeTimestamp(last.createdAt), id: last.id }));
        }

        const inspectionsFormatted: Inspection[] = page.map(({ inspection: row, primaryClientName, primaryClientEmail }) => ({
            ...row,
            id: row.id as string,
            propertyAddress: row.propertyAddress as string,
            clientName: primaryClientName ?? null,
            clientEmail: primaryClientEmail ?? null,
            status: row.status,
            date: row.date as string,
            inspectorId: row.inspectorId as string | null,
            templateId: row.templateId as string | null,
            createdAt: safeISODate(row.createdAt),
        }));

        return { inspections: inspectionsFormatted, nextCursor, hasMore };
    }

    /**
     * Fetches counts for the dashboard.
     */
    async getStats(tenantId: string) {
        const db = this.getDrizzle();
        const counts = await db.select({ status: inspections.status, count: sql<number>`count(*)` })
            .from(inspections)
            .where(eq(inspections.tenantId, tenantId))
            .groupBy(inspections.status);

        const stats = { total: 0, requested: 0, completed: 0, published: 0 };
        for (const row of counts) {
            const n = Number(row.count);
            stats.total += n;
            if (row.status === INSPECTION_STATUS.REQUESTED) stats.requested = n;
            else if (row.status === INSPECTION_STATUS.COMPLETED) stats.completed = n;
        }
        return stats;
    }

    /**
     * Fetches a single inspection with its template.
     */
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
                status: result.status as 'draft' | 'completed' | 'delivered',
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

        // Link selected services.
        // serviceSelections (IA-1 superset) takes precedence when present; otherwise
        // fall back to the legacy flat serviceIds list. The two may coexist — the
        // handler already merges them so only one branch fires here.
        const serviceSelectionsInput = (data as { serviceSelections?: Array<{ serviceId: string; priceOverrideCents?: number }> }).serviceSelections;
        const effectiveServiceIds: string[] = serviceSelectionsInput && serviceSelectionsInput.length > 0
            ? serviceSelectionsInput.map(s => s.serviceId)
            : (data.serviceIds ?? []);
        if (effectiveServiceIds.length > 0) {
            const svcRows = await db.select().from(services)
                .where(and(eq(services.tenantId, tenantId), inArray(services.id, effectiveServiceIds)));
            if (svcRows.length > 0) {
                // Build a map from serviceId → priceOverrideCents for fast lookup.
                const overrideMap = new Map<string, number | undefined>(
                    (serviceSelectionsInput ?? []).map(s => [s.serviceId, s.priceOverrideCents]),
                );
                await db.insert(inspectionServices).values(svcRows.map(s => ({
                    id:            crypto.randomUUID(),
                    tenantId,
                    inspectionId:  id,
                    serviceId:     s.id,
                    priceOverride: overrideMap.get(s.id) ?? null,
                    nameSnapshot:  s.name,
                    priceSnapshot: s.price,
                })));
            }
        }

        return {
            ...newInspection,
            clientName: clientNameInput,
            clientEmail: clientEmailInput,
            inspectorId: newInspection.inspectorId as string | null,
            createdAt: safeISODate(newInspection.createdAt)
        } as Inspection;
    }

    /**
     * #119 — Re-inspection. Creates a NEW draft inspection linked to a published
     * baseline (the original OR a prior re-inspection). Seeds inspection_results.data
     * for ONLY the selected items, each `{ original, followupStatus: null }`, where
     * `original` carries the root finding forward from the baseline's latest published
     * report_versions snapshot (or the propagated `.original` if the baseline is itself
     * a re-inspection).
     *
     * GATE: the baseline must be published — i.e. have ≥1 report_versions row.
     */
    async createReinspection(
        tenantId: string,
        baselineId: string,
        opts: { selectedItemIds: string[]; inspectorId?: string },
    ): Promise<Inspection> {
        const db = this.getDrizzle();

        const baseline = await db.select().from(inspections)
            .where(and(eq(inspections.id, baselineId), eq(inspections.tenantId, tenantId))).get();
        if (!baseline) throw new Error('Baseline inspection not found');

        const latestVersion = await db.select().from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, baselineId)))
            .orderBy(desc(reportVersions.versionNumber)).limit(1).get();
        if (!latestVersion) throw new Error('Cannot re-inspect an unpublished baseline');

        // When an explicit inspectorId is supplied, it MUST resolve to a user in
        // this tenant. inspector_id has a DB FK to users.id; a foreign-tenant or
        // bogus id would either violate the FK at runtime or assign the round to
        // another tenant's user. Validate before use; omitted → baseline fallback.
        if (opts.inspectorId) {
            const owner = await db.select({ id: users.id }).from(users)
                .where(and(eq(users.id, opts.inspectorId), eq(users.tenantId, tenantId))).get();
            if (!owner) throw new Error('Inspector not found in this workspace');
        }

        const rootId = baseline.rootInspectionId ?? baseline.id;
        const existingRounds = await db.select().from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), eq(inspections.rootInspectionId, rootId))).all();
        const round = existingRounds.length + 1;

        // The latest published snapshot is the carry-forward source. snapshotOnPublish
        // serialises { inspection, data, units }; we read .data[itemId].
        const baseSnapshot = parseSnapshotData(latestVersion.snapshotJson);
        const baselineIsReinspection = baseline.sourceInspectionId != null;

        const seeded: Record<string, unknown> = {};
        for (const itemId of opts.selectedItemIds) {
            const item = baseSnapshot.data?.[itemId] ?? {};
            // When the baseline is itself a re-inspection AND its snapshot item already
            // carries a propagated `.original` root finding, forward THAT (so round N
            // always shows the root defect, never the intermediate follow-up state).
            const original = baselineIsReinspection && item.original
                ? item.original
                : { rating: item.rating ?? null, notes: item.notes ?? null, photos: item.photos ?? [] };
            seeded[itemId] = { original, followupStatus: null };
        }

        const id = crypto.randomUUID();
        const createdAt = new Date();
        // Quota is consumed only after every precondition check above (baseline
        // existence, published-baseline gate, inspector ownership) has passed
        // and immediately before the insert that actually creates the
        // re-inspection — a failed validation must never burn a free tenant's
        // lifetime slot.
        await this.planQuota?.consumeInspection(tenantId);
        await db.insert(inspections).values({
            id,
            tenantId,
            // Reuse the baseline's property + client + template fields.
            inspectorId:             opts.inspectorId ?? baseline.inspectorId ?? null,
            propertyAddress:         baseline.propertyAddress,
            addressPlaceId:          baseline.addressPlaceId,
            addressStreet:           baseline.addressStreet,
            addressCity:             baseline.addressCity,
            addressState:            baseline.addressState,
            addressZip:              baseline.addressZip,
            addressCounty:           baseline.addressCounty,
            addressLat:              baseline.addressLat,
            addressLng:              baseline.addressLng,
            templateId:              baseline.templateId,
            templateSnapshot:        baseline.templateSnapshot,
            templateSnapshotVersion: baseline.templateSnapshotVersion,
            date:                    createdAt.toISOString(),
            status:                  INSPECTION_STATUS.REQUESTED,
            paymentStatus:           'unpaid',
            price:                   0,
            paymentRequired:         false,
            agreementRequired:       false,
            createdAt,
            // #119 link columns.
            sourceInspectionId: baselineId,
            rootInspectionId:   rootId,
            reinspectionRound:  round,
        });

        await db.insert(inspectionResults).values({
            id:           crypto.randomUUID(),
            tenantId,
            inspectionId: id,
            data:         seeded as unknown as object,
            lastSyncedAt: createdAt,
        });

        // Task 7c (people-role-profiles fix) — copy the baseline's
        // inspection_people rows (client / buyer_agent / listing_agent / ...)
        // onto the new re-inspection. Task 13 dropped the legacy
        // clientContactId/clientName/clientEmail/clientPhone columns from the
        // inspections row, so this copy is now the ONLY carry-forward of WHO.
        // Without this, getInspection/listInspections (Task 9c-reads) resolve the client
        // via inspection_people ONLY and would show a null client on every
        // re-inspection. Non-fatal: a people-write failure must never roll
        // back the already-committed re-inspection row.
        try {
            const people = new PeopleService({ DB: this.db });
            const baselinePeople = await people.listPeople(tenantId, baselineId);
            for (const p of baselinePeople) {
                await people.addPerson(tenantId, id, p.contactId, p.roleProfileId);
            }
        } catch (err) {
            logger.error('inspection-people copy from reinspection create failed', { inspectionId: id }, err instanceof Error ? err : undefined);
        }

        const created = await db.select().from(inspections).where(eq(inspections.id, id)).get();
        return created as unknown as Inspection;
    }

    /**
     * #119 (Task 6) — Candidate items for the "Create re-inspection" modal.
     * Returns the baseline's still-open flagged items so the UI can pre-check
     * the ones worth carrying forward. Computed off the SAME published snapshot
     * `createReinspection` reads, so the returned `itemId`s are exactly the keys
     * accepted as `selectedItemIds`.
     *
     * `open` default-check rule (mirrors the task spec):
     *   - ORIGINAL baseline (no sourceInspectionId): item is open when its rating
     *     bucket is `defect` or `monitor`.
     *   - RE-INSPECTION baseline: item is open when its `followupStatus` is a
     *     non-closed status (via isOpenStatus + the tenant's status set).
     *
     * Returns [] when the baseline is unpublished (no snapshot) — the caller
     * gates the action on publication anyway, and the modal renders an empty
     * state. Labels come from the baseline's templateSnapshot; an unmatched key
     * degrades to the raw item id.
     */
    async getReinspectCandidates(
        tenantId: string,
        baselineId: string,
    ): Promise<Array<{ itemId: string; label: string; originalNotes: string | null; open: boolean }>> {
        const db = this.getDrizzle();

        const baseline = await db.select().from(inspections)
            .where(and(eq(inspections.id, baselineId), eq(inspections.tenantId, tenantId))).get();
        if (!baseline) return [];

        const latestVersion = await db.select().from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, baselineId)))
            .orderBy(desc(reportVersions.versionNumber)).limit(1).get();
        if (!latestVersion) return [];  // unpublished baseline → no candidates

        const baselineIsReinspection = baseline.sourceInspectionId != null;

        // Snapshot data is keyed by findingKey (unit:section:item) or, for legacy
        // inspections, the plain item id — the same keys createReinspection reads.
        const snapData = parseSnapshotData(latestVersion.snapshotJson).data ?? {};

        // Resolve item labels from the baseline's templateSnapshot (authoritative
        // shape once an inspection exists). Both {sections:[...]} and flat-array
        // formats are supported, matching getReportData's schema resolution.
        const labelByItemId = new Map<string, string>();
        const rawSnap = baseline.templateSnapshot as unknown;
        const tplSnap = rawSnap
            ? (typeof rawSnap === 'string' ? JSON.parse(rawSnap as string) : rawSnap)
            : null;
        const sections: Array<{ id?: string; items?: Array<Record<string, unknown>> }> = Array.isArray(tplSnap)
            ? [{ id: 'general', items: tplSnap as Array<Record<string, unknown>> }]
            : Array.isArray((tplSnap as { sections?: unknown })?.sections)
                ? (tplSnap as { sections: Array<{ id?: string; items?: Array<Record<string, unknown>> }> }).sections
                : [];
        for (const sec of sections) {
            for (const it of sec.items ?? []) {
                const itemId = String(it.id ?? '');
                if (!itemId) continue;
                const label = String(it.label ?? it.title ?? it.name ?? itemId);
                labelByItemId.set(itemId, label);
                // Also map the composite findingKey so snapshot keys resolve.
                labelByItemId.set(findingKey(DEFAULT_UNIT, String(sec.id ?? ''), itemId), label);
            }
        }

        // Rating levels for bucket resolution (original-baseline rule). Read from
        // the templateSnapshot.ratingSystem when present; absence degrades to the
        // legacy string-bucket map inside getRatingBucket.
        const snapLevels = !Array.isArray(tplSnap)
            ? (tplSnap as { ratingSystem?: { levels?: unknown[] } } | null)?.ratingSystem?.levels
            : undefined;
        const levels: RatingLevel[] = Array.isArray(snapLevels)
            ? mapRatingSystemLevels(snapLevels as Array<Record<string, unknown>>)
            : [];

        // Resolve the tenant's configured follow-up status set (re-inspection rule).
        const configRow = await db.select({ reinspectionStatuses: tenantConfigs.reinspectionStatuses })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const resolvedStatuses = parseReinspectionStatuses(configRow?.reinspectionStatuses ?? null);

        const out: Array<{ itemId: string; label: string; originalNotes: string | null; open: boolean }> = [];
        for (const [itemId, entry] of Object.entries(snapData)) {
            const rating = (entry.rating ?? null) as string | null;
            const notes = (entry.notes ?? null) as string | null;
            // A re-inspection snapshot may already carry the propagated root finding.
            const original = (entry.original ?? null) as { notes?: string | null } | null;
            const originalNotes = baselineIsReinspection && original ? (original.notes ?? null) : notes;

            let open: boolean;
            if (baselineIsReinspection) {
                open = isOpenStatus((entry.followupStatus ?? null) as string | null, resolvedStatuses);
            } else {
                const bucket = getRatingBucket(rating, levels);
                open = bucket === 'defect' || bucket === 'monitor';
            }

            out.push({
                itemId,
                label: labelByItemId.get(itemId) ?? itemId,
                originalNotes,
                open,
            });
        }
        // Open items first, then by label — the pre-checked carry-forward set surfaces on top.
        out.sort((a, b) => (a.open === b.open ? a.label.localeCompare(b.label) : a.open ? -1 : 1));
        return out;
    }

    /**
     * IA-1: Post-create hook — write priceOverride onto inspection_services rows
     * that were already inserted by createInspection. Called by the handler AFTER
     * createInspection returns so it can use the resolved inspection id.
     * Only rows whose serviceId appears in selections AND carry a priceOverrideCents
     * value are updated; rows without an override are left with priceOverride=null.
     */
    async applyServicePriceOverrides(
        inspectionId: string,
        tenantId: string,
        selections: Array<{ serviceId: string; priceOverrideCents?: number }>,
    ): Promise<void> {
        const db = this.getDrizzle();
        for (const sel of selections) {
            if (sel.priceOverrideCents !== undefined) {
                await db.update(inspectionServices)
                    .set({ priceOverride: sel.priceOverrideCents })
                    .where(
                        and(
                            eq(inspectionServices.inspectionId, inspectionId),
                            eq(inspectionServices.tenantId, tenantId),
                            eq(inspectionServices.serviceId, sel.serviceId),
                        ),
                    );
            }
        }
    }

    /**
     * Design System 0520 subsystem B phase 5 — NewInspectionWizard creation
     * path. Thin wrapper around createInspection that maps the wizard's
     * 4-step payload onto the existing column set + the new team_mode /
     * lead_inspector_id / helper_inspector_ids columns added in subsystem
     * B phase 1.
     *
     * Returns the freshly-inserted inspection id so the wizard factory can
     * redirect to /inspections/:id/edit.
     *
     * Services array (wizard step 2) is stored informational-only on this
     * MVP — wiring to the inspectionServices catalog needs slug→id
     * lookup which is a separate follow-up.
     */
    async createFromWizard(
        tenantId: string,
        creatorUserId: string,
        input: import('../../lib/validations/wizard.schema').CreateInspectionFromWizardInput,
    ): Promise<{ id: string }> {
        // Build the base CreateInspectionData shape consumed by createInspection.
        // The wizard's schedule.startTime is appended to the ISO date so the
        // existing `date` column carries both — the editor's calendar pane
        // already round-trips this format.
        const dateTime = `${input.schedule.date}T${input.schedule.startTime}:00`;

        const created = await this.createInspection(tenantId, {
            inspectorId:     creatorUserId,
            propertyAddress: input.property.address,
            clientName:      'Private Client',  // wizard MVP — client picker is step-extension follow-up
            clientEmail:     null,
            clientPhone:     null,
            templateId:      null,
            date:            dateTime,
            yearBuilt:       input.property.yearBuilt ?? null,
            sqft:            input.property.sqft ?? null,
            foundationType:  null,
            bedrooms:        null,
            bathrooms:       null,
        } as unknown as CreateInspectionData & { inspectorId?: string });

        {
            const db = this.getDrizzle();
            const patch: Record<string, unknown> = {};
            if (input.property.propertyType) patch.propertyType = input.property.propertyType;
            if (input.property.propertyType === 'commercial' && input.property.commercialSubtype) {
                patch.commercialSubtype = input.property.commercialSubtype;
            }
            let teamFieldsPatched = false;
            let effectiveLead: string | null = null;
            let effectiveHelpers: string[] = [];
            if (input.teamMode || input.leadInspectorId || (input.helperInspectorIds?.length ?? 0) > 0) {
                patch.teamMode           = input.teamMode;
                patch.leadInspectorId    = input.teamMode ? (input.leadInspectorId ?? creatorUserId) : null;
                patch.helperInspectorIds = JSON.stringify(input.teamMode ? (input.helperInspectorIds ?? []) : []);
                teamFieldsPatched = true;
                effectiveLead    = patch.leadInspectorId as string | null;
                effectiveHelpers = input.teamMode ? (input.helperInspectorIds ?? []) : [];
            }
            if (Object.keys(patch).length > 0) {
                await db.update(inspections)
                    .set(patch)
                    .where(and(eq(inspections.id, created.id), eq(inspections.tenantId, tenantId)));
            }
            // DB-8: re-sync with effective post-patch assignment values when team
            // fields were written. Always pass creatorUserId as the inspectorId
            // fallback so that when teamMode=false but a stale leadInspectorId was
            // present in the request (effectiveLead=null, effectiveHelpers=[]),
            // syncInspectionAssignments still writes a lead row for the creator
            // rather than clearing all link rows while inspections.inspectorId
            // still holds creatorUserId (which would diverge the two sources of truth).
            if (teamFieldsPatched) {
                // Non-fatal — the link table is a denormalized mirror; a sync
                // failure must not surface to the caller after the canonical row
                // has already been written.
                try {
                    await syncInspectionAssignments(db, tenantId, created.id, {
                        inspectorId:        creatorUserId,
                        leadInspectorId:    effectiveLead,
                        helperInspectorIds: effectiveHelpers,
                    });
                } catch (e) {
                    logger.error('inspection.wizard-team-sync.failed', { inspectionId: created.id }, e instanceof Error ? e : undefined);
                }
            }
        }

        return { id: created.id };
    }

    /**
     * Clones an existing inspection.
     */
    async cloneInspection(id: string, tenantId: string): Promise<Inspection> {
        // getInspection throws NotFound for a bad id — that precondition check
        // must run BEFORE quota is consumed, so cloning a nonexistent
        // inspection never burns a free tenant's lifetime slot.
        const { inspection: source } = await this.getInspection(id, tenantId);
        await this.planQuota?.consumeInspection(tenantId);

        const clone = {
            ...source,
            id: crypto.randomUUID(),
            tenantId,
            date: new Date().toISOString(),
            status: 'draft' as const,
            paymentStatus: 'unpaid' as const,
            createdAt: new Date(),
        };
        delete (clone as { signedByClient?: boolean }).signedByClient; // Remove ephemeral field

        // Task 13 — clientName/clientEmail/clientPhone on `source` are
        // resolved via PeopleService inside getInspection (not raw DB
        // columns; clientContactId/referredByAgentId/sellingAgentId are gone
        // entirely now that the columns are dropped). Strip them from the
        // insert payload — they'd otherwise be dead keys on an object the
        // schema no longer recognizes. The inspection_people copy below is
        // the only carry-forward of WHO.
        const { clientName: _clientName, clientEmail: _clientEmail, clientPhone: _clientPhone, ...cloneDbValues } =
            clone as typeof clone & { clientName?: unknown; clientEmail?: unknown; clientPhone?: unknown };
        void _clientName; void _clientEmail; void _clientPhone;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.getDrizzle().insert(inspections).values(cloneDbValues as any);

        // Task 7c (people-role-profiles fix) — copy the source inspection's
        // inspection_people rows (client + any agents) onto the clone.
        // Without this, getInspection/listInspections (Task 9c-reads)
        // resolve the client via inspection_people ONLY and would show a
        // null client on every clone. Non-fatal: a people-write failure must
        // never roll back the already-committed clone row.
        try {
            const people = new PeopleService({ DB: this.db });
            const sourcePeople = await people.listPeople(tenantId, id);
            for (const p of sourcePeople) {
                await people.addPerson(tenantId, clone.id, p.contactId, p.roleProfileId);
            }
        } catch (err) {
            logger.error('inspection-people copy from clone create failed', { inspectionId: clone.id }, err instanceof Error ? err : undefined);
        }
        // DB-8: mirror the cloned inspection's assignment into inspection_inspectors.
        // Non-fatal — the link table is a denormalized mirror; a sync failure must
        // not abort a clone whose canonical inspection row already committed.
        try {
            await syncInspectionAssignments(this.getDrizzle(), tenantId, clone.id, {
                inspectorId:        (clone as { inspectorId?: string | null }).inspectorId ?? null,
                leadInspectorId:    (clone as { leadInspectorId?: string | null }).leadInspectorId ?? null,
                helperInspectorIds: JSON.parse((clone as { helperInspectorIds?: string }).helperInspectorIds ?? '[]') as string[],
            });
        } catch (e) {
            logger.error('inspection.clone-sync.failed', { inspectionId: clone.id }, e instanceof Error ? e : undefined);
        }

        return {
            ...clone,
            createdAt: safeISODate(clone.createdAt)
        };
    }

    /**
     * Round-2 F1 — list every party associated with an inspection so the
     * Publish modal can render per-recipient Email + Text checkboxes.
     *
     * Sourced from `PeopleService.listPeople` (the `inspection_people` join),
     * restricted to the three roles this Publish-modal contract covers
     * (`client` / `buyer_agent` / `listing_agent` — see `RECIPIENT_ROLE_MAP`);
     * other role kinds (co_client, attorney, ...) are ignored here (Spec 2
     * widens the recipient set).
     *
     * Returned shape (`InspectionRecipient[]`):
     *   - role: 'client' | 'agent_buyer' | 'agent_listing'
     *   - contactId: the person's contact row id (now populated for every
     *     role, including the client — the legacy inline-client column had
     *     no contact row, so this used to be null for `role: 'client'`)
     *   - name, email, phone
     *
     * Recipients without any contact info (no email AND no phone) are dropped
     * because there is no way to deliver to them. Tenant-scoped via the
     * compound `where(eq(id), eq(tenantId))` guard on the inspection lookup
     * AND `PeopleService.listPeople`'s own tenant filter.
     */
    async getRecipientList(inspectionId: string, tenantId: string): Promise<InspectionRecipient[]> {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const people = await new PeopleService({ DB: this.db }).listPeople(tenantId, inspectionId);

        const recipients: InspectionRecipient[] = [];
        for (const p of people) {
            const role = RECIPIENT_ROLE_MAP[p.roleKey];
            if (!role) continue; // ignore co_client/attorney/etc — Spec 2 widens the recipient set
            if (!p.email && !p.phone) continue; // no delivery channel
            recipients.push({
                contactId: p.contactId,
                name:      p.name,
                role,
                email:     p.email ?? null,
                phone:     p.phone ?? null,
            });
        }

        return recipients;
    }

    /**
     * Round-2 F3 — People card payload (Spectora §E.2 / §4.1).
     *
     * Groups every party connected to an inspection by role so the inspection
     * Settings page can render a contact card with role chips:
     *
     *   - Inspector  → users row referenced by inspectorId
     *   - Client, Buyer's Agent, Listing Agent → `inspection_people` rows
     *     (via `PeopleService.listPeople`), matched on `roleKey`. Other role
     *     kinds (co_client, attorney, ...) are ignored here (Spec 2 widens
     *     the people card).
     *
     * Each agent's `.id` is the CONTACT id (`p.contactId`), matching the old
     * contract — NOT the `inspection_people` join-row id (`p.id`).
     *
     * Schema currently allows ONE buyer agent + ONE listing agent per
     * inspection. The result returns arrays for forward-compat (so the UI
     * can render "Buyer's Agent · 2" if multi-agent ever ships) without a
     * follow-up service refactor.
     */
    async getPeopleCard(inspectionId: string, tenantId: string): Promise<{
        inspector:     { id: string; name: string | null; email: string; phone: string | null } | null;
        client:        { name: string; email: string | null; phone: string | null } | null;
        buyerAgents:   Array<{ id: string; name: string; email: string | null; phone: string | null; agency: string | null }>;
        listingAgents: Array<{ id: string; name: string; email: string | null; phone: string | null; agency: string | null }>;
    }> {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Inspector — users table (tenant-scoped).
        let inspector: { id: string; name: string | null; email: string; phone: string | null } | null = null;
        if (inspection.inspectorId) {
            const u = await db.select().from(users)
                .where(and(eq(users.id, inspection.inspectorId as string), eq(users.tenantId, tenantId)))
                .get();
            if (u) {
                inspector = {
                    id:    u.id as string,
                    name:  (u.name  as string | null) ?? null,
                    email: u.email as string,
                    phone: (u.phone as string | null) ?? null,
                };
            }
        }

        // Client + agents — from inspection_people (via PeopleService).
        const people = await new PeopleService({ DB: this.db }).listPeople(tenantId, inspectionId);

        const clientP = people.find(p => p.roleKey === 'client') ?? null;
        const client = clientP
            ? {
                name:  clientP.name,
                email: clientP.email ?? null,
                phone: clientP.phone ?? null,
            }
            : null;

        const toAgent = (p: (typeof people)[number]) => ({
            id:     p.contactId, // CONTACT id — matches the old contract, not the join-row id
            name:   p.name,
            email:  p.email  ?? null,
            phone:  p.phone  ?? null,
            agency: p.agency ?? null,
        });
        const buyerAgents   = people.filter(p => p.roleKey === 'buyer_agent').map(toAgent);
        const listingAgents = people.filter(p => p.roleKey === 'listing_agent').map(toAgent);

        return {
            inspector,
            client,
            buyerAgents,
            listingAgents,
        };
    }
}
