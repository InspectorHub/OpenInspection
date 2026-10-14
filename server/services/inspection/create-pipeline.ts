/**
 * The writes that follow the `inspections` row when an inspection is created.
 *
 * Creating an inspection is many writes and D1 gives no transaction across them.
 * An id the server minted cannot be retried, so a failure partway is logged where
 * it was always non-fatal and the request goes on. An id the CLIENT chose can be
 * retried, and that changes what a half-finished create costs: the retry finds
 * the row and would answer as a replay, so whatever the first attempt did not
 * reach would be missing for good. This module is the one place that sequence is
 * written down, run by the create and by the replay that completes it.
 *
 * For a client-chosen id (`strict`):
 *  - the PRIMARY REPORT IS THE LAST STEP. "The report exists" therefore means
 *    "the pipeline finished", and its absence is the signal the replay acts on;
 *  - a failing step stops the pipeline instead of being logged, so the report is
 *    not written and the retry runs the step again;
 *  - every step is safe to run twice, and safe to run twice AT ONCE, because the
 *    create and a replay of it can overlap and there is no lock to keep them
 *    apart. The client contact and the people links are upserts; the service
 *    lines and the audit row carry ids derived from the inspection, so a second
 *    insert is a no-op rather than a duplicate; the automation notices carry a
 *    dedup key; the report has a derived id too. Quota and the discount are
 *    spent before this module runs, and a replay never reaches them.
 */

import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { contactRoleProfiles, inspectionInspectors, inspectionPeople, inspectionServices } from '../../lib/db/schema';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { Errors } from '../../lib/errors';
import { ensurePrimaryReportAndResults } from '../../lib/inspection/primary-report';
import { writeInspectionServiceSnapshots, type ServiceSelection } from '../../lib/inspection/service-snapshot';
import { logger } from '../../lib/logger';
import { PeopleService } from '../people.service';
import { softUpsertClientContact } from './create-client-contact';
import { fireAutomation } from './automation-fire';

type Db = DrizzleD1Database & { $client: D1Database };

/** The client name the request carries when it names none; such a client is never saved as a contact. */
const ANONYMOUS_CLIENT = 'Private Client';

export interface CreatePipelineDeps {
    d1: D1Database;
    db: Db;
}

/** What the pipeline needs to know about the inspection being created. */
export interface CreatePipelineInput {
    inspectionId: string;
    templateId: string | null;
    inspectorId: string | null;
    createdAt: Date;
    clientName: string;
    clientEmail: string | null;
    clientPhone: string | null;
    /** A contact the caller already resolved; the soft upsert may replace it with the matching one. */
    clientContactId: string | null;
    /** Buyer's agent (`referredByAgentId` on the request). */
    buyerAgentId: string | null;
    /** Listing agent (`sellingAgentId` on the request). */
    listingAgentId: string | null;
    serviceSelections: ServiceSelection[] | undefined;
    serviceIds: string[] | undefined;
}

/** The create request, as far as the pipeline reads it. */
export interface CreateRequestFields {
    templateId?: string | undefined;
    clientName?: string | undefined;
    clientEmail?: string | null | undefined;
    clientPhone?: string | null | undefined;
    clientContactId?: string | null | undefined;
    referredByAgentId?: string | null | undefined;
    sellingAgentId?: string | null | undefined;
    serviceSelections?: ServiceSelection[] | undefined;
    serviceIds?: string[] | undefined;
}

export function pipelineInputFrom(
    data: CreateRequestFields,
    inspection: { id: string; inspectorId: string | null; createdAt: Date },
): CreatePipelineInput {
    return {
        inspectionId: inspection.id,
        templateId: data.templateId ?? null,
        inspectorId: inspection.inspectorId,
        createdAt: inspection.createdAt,
        clientName: data.clientName || ANONYMOUS_CLIENT,
        clientEmail: data.clientEmail || null,
        clientPhone: data.clientPhone ?? null,
        clientContactId: data.clientContactId ?? null,
        buyerAgentId: data.referredByAgentId || null,
        listingAgentId: data.sellingAgentId || null,
        serviceSelections: data.serviceSelections,
        serviceIds: data.serviceIds,
    };
}

export interface CreatePipelineOptions {
    /** True for a client-chosen id: see the module comment. */
    strict: boolean;
    /** Runs after every other step and before the report (the audit row). */
    beforeReport?: ((inspectionId: string) => Promise<void>) | undefined;
    /**
     * True when this call has just inserted the inspection row itself, so nothing else can have
     * written anything for it yet. The reads that only spare a REPEAT its writes (is anyone assigned,
     * are there service lines) are skipped then: on the import path every query counts against the
     * Worker's subrequest allowance.
     */
    fresh?: boolean | undefined;
}


async function step(strict: boolean, message: string, inspectionId: string, run: () => Promise<void>): Promise<void> {
    if (strict) return run();
    try { await run(); } catch (err) {
        logger.error(message, { inspectionId }, err instanceof Error ? err : undefined);
    }
}

async function isAssigned(db: Db, tenantId: string, inspectionId: string): Promise<boolean> {
    const rows = await db.select({ userId: inspectionInspectors.userId }).from(inspectionInspectors)
        .where(and(eq(inspectionInspectors.tenantId, tenantId), eq(inspectionInspectors.inspectionId, inspectionId))).limit(1);
    return rows.length > 0;
}

async function hasServiceLines(db: Db, tenantId: string, inspectionId: string): Promise<boolean> {
    const rows = await db.select({ id: inspectionServices.id }).from(inspectionServices)
        .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.inspectionId, inspectionId))).limit(1);
    return rows.length > 0;
}

/**
 * A repeat only fills the roles nobody holds yet. The first attempt's body is the one on record, so a
 * replay that names someone else must not hand the primary seat over; a role it did not reach is added.
 */
async function linkPeople(
    db: Db, d1: D1Database, tenantId: string, input: CreatePipelineInput, clientContactId: string | null, fresh: boolean,
): Promise<void> {
    const roleRows = await db.select({ id: contactRoleProfiles.id, key: contactRoleProfiles.key })
        .from(contactRoleProfiles)
        .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true)));
    const roleIdByKey = new Map(roleRows.map(r => [r.key, r.id]));
    const held = fresh ? [] : await db.select({ roleProfileId: inspectionPeople.roleProfileId }).from(inspectionPeople)
        .where(and(eq(inspectionPeople.tenantId, tenantId), eq(inspectionPeople.inspectionId, input.inspectionId)));
    const heldRoles = new Set(held.map(r => r.roleProfileId));
    const people = new PeopleService({ DB: d1 });
    const links: Array<[string | null, string | undefined]> = [
        [clientContactId,       roleIdByKey.get('client')],
        [input.buyerAgentId,    roleIdByKey.get('buyer_agent')],
        [input.listingAgentId,  roleIdByKey.get('listing_agent')],
    ];
    for (const [contactId, roleProfileId] of links) {
        if (contactId && roleProfileId && !heldRoles.has(roleProfileId)) await people.addPerson(tenantId, input.inspectionId, contactId, roleProfileId);
    }
}

/**
 * Runs the steps after the `inspections` row. Returns the primary report's id, or
 * null when it could not be created and the id was minted by the server (logged,
 * non-fatal, as it always was). A client-chosen id throws 503 instead, so the
 * device retries and the replay finishes the job.
 */
export async function runCreatePipeline(
    deps: CreatePipelineDeps,
    tenantId: string,
    input: CreatePipelineInput,
    opts: CreatePipelineOptions,
): Promise<string | null> {
    const { d1, db } = deps;
    const { strict } = opts;
    const id = input.inspectionId;
    const ensureReport = () => ensurePrimaryReportAndResults(db, tenantId, id, input.templateId, input.createdAt);

    // The primary report first, because the results row has to NAME it: a NULL `report_id` is
    // accepted silently and reads match a sibling document or none (see `lib/inspection/reports.ts`).
    // A server-minted id keeps that order. A client-chosen id writes it last, see the module comment.
    let reportId: string | null = strict ? null : await ensureReport();

    // DB-8: mirror assignment into the inspection_inspectors link table, for an inspection nobody is
    // assigned to yet, so it can never undo a later reassignment.
    await step(strict, 'inspection.assignment-sync.failed', id, async () => {
        if (input.inspectorId && (opts.fresh || !(await isAssigned(db, tenantId, id)))) {
            await syncInspectionAssignments(db, tenantId, id, { inspectorId: input.inspectorId });
        }
    });
    // Who receives a notice is read from the people links, so WHEN it fires decides the recipients. A
    // server-minted id keeps its historical place, before the links exist. A client-chosen id fires once
    // they are written: every run, the first or a replay, then sees the same recipients, which is what
    // makes the dedup key below enough to keep a replay from sending the notices a second time.
    const fire = () => fireAutomation(d1, tenantId, id, 'inspection.created', undefined,
        strict ? { eventId: `auto:inspection.created:${id}`, rethrow: true } : undefined);
    if (!strict) await fire();

    const clientContactId = input.clientName === ANONYMOUS_CLIENT
        ? input.clientContactId
        : await softUpsertClientContact(db, tenantId,
            { name: input.clientName, email: input.clientEmail, phone: input.clientPhone, createdAt: input.createdAt },
            input.clientContactId, id, { rethrow: strict });

    // Mirror the primary client, buyer's agent and listing agent into inspection_people. This is the
    // ONLY place WHO is persisted. A server-minted id must not roll back a committed inspection for it.
    await step(strict, 'inspection-people write from inspection create failed', id, () => linkPeople(db, d1, tenantId, input, clientContactId, opts.fresh === true));

    // The service lines, the tier-2 money authority, carry any per-line price override with them. A
    // repeat must not double the price: it finds the lines and skips, and two runs at once insert the
    // same derived ids, so the second insert is a no-op (see `writeInspectionServiceSnapshots`).
    const wantsServices = (input.serviceSelections?.length ?? 0) > 0 || (input.serviceIds?.length ?? 0) > 0;
    if (wantsServices && (opts.fresh || !(await hasServiceLines(db, tenantId, id)))) {
        await writeInspectionServiceSnapshots(db, tenantId, id, { serviceSelections: input.serviceSelections, serviceIds: input.serviceIds });
    }

    if (strict) await fire();

    if (opts.beforeReport) {
        const hook = opts.beforeReport;
        await step(strict, 'inspection.create audit failed', id, () => hook(id));
    }

    if (strict) {
        reportId = await ensureReport();
        if (!reportId) throw Errors.ServiceUnavailable('The inspection was saved but its report could not be created; retry the request');
    }
    return reportId;
}
