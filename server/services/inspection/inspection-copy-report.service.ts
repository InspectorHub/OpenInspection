/**
 * "Copy as a new report": a NEW inspection that starts from the findings of an earlier one.
 *
 * The booking side goes through `cloneInsertValues`, so everything that allow-list refuses stays
 * refused (report and payment state, cover, unlock record, request links, ...). The findings side
 * goes through `selectFindings`, an allow-list of its own. A copy of a signed, published, paid job
 * therefore carries no signature, no report version (so no verification token), no agreement, no
 * client-portal token and no source document history: the results row is written with
 * `ydoc_state` null, so the editor's document starts a lineage of its own.
 *
 * Order matters: every refusal that needs no write comes first; the allowance is then consumed
 * exactly once, before the first write; a failure after that removes what was written (every object
 * under the new report's prefix included) and gives the place back. The source is only ever read.
 *
 * A Worker that dies between the photo copy and the results write leaves a counted, empty
 * inspection and objects nothing refers to; the orphan sweep removes the objects after its grace period.
 *
 * The rollback is itself bounded by what an invocation may do: the cascade is one statement per
 * inspection-keyed table plus a list and delete over the new prefix. Under a tight subrequest
 * allowance (see `MAX_STORAGE_CALLS_PER_RUN`; the figure is unmeasured) it can stop part way. In that
 * case the allowance is deliberately NOT released (a leftover row would then go uncounted), the error
 * is logged, and the orphan sweep finishes the objects. A cleanup that did finish releases the place.
 *
 * Sends nothing and contacts nobody: there is no email, SMS or automation dependency here.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { ItemEntry, PhotoEntry } from '@core/field-ui/shared/results-doc.types';
import { inspectionItemTagLinks, inspectionResults, inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { getInspectionRoster } from '../../lib/inspection/roster';
import { createPrimaryReport, resolvePrimaryReportId } from '../../lib/inspection/reports';
import type { CopyReportScope } from '../../lib/validations/copy-report.schema';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import { PeopleService } from '../people.service';
import { cloneInsertValues } from './clone-columns';
import { deleteInspectionCascade } from './inspection-cascade';
import { photoArrays, selectFindings } from './copy-report-data';
import { copyPhotoEntries, photoIdentity, type CopiedPhotoKeys, type PhotoCopyOutcome } from './copy-report-photos';
import { InspectionSubService } from './base';

export interface CopyReportOptions {
    scope: CopyReportScope;
    property: 'same' | 'different';
    /** Required when `property` is `different`. */
    propertyAddress?: string | undefined;
    photos: boolean;
}

export interface CopyReportSummary {
    findings: { copied: number; dropped: number };
    /** `complete` is null when photos were not asked for; otherwise true only when nothing photo-like is missing. */
    photos: { requested: boolean; copied: number; failed: number; skipped: number; unsupported: number; droppedVariants: number; deferred: number; complete: boolean | null };
    people: { requested: boolean; copied: boolean };
    roster: { copied: boolean };
}

export type CreatedCopy = typeof inspections.$inferSelect;

/** Columns that describe the OTHER property; a copy at a different property starts without them. */
const PROPERTY_COLUMNS_CLEARED = {
    addressPlaceId: null, addressStreet: null, addressCity: null, addressState: null, addressZip: null,
    addressCounty: null, addressLat: null, addressLng: null, addressGeocodedAt: null,
    yearBuilt: null, sqft: null, foundationType: null, bedrooms: null, bathrooms: null, lotSize: null,
    unit: null, county: null, propertyType: null, commercialSubtype: null, referenceNumber: null, closingDate: null,
    // The referrer belongs to the other job, like the client and agents who are not copied either; the referral source stays.
    referredByContactId: null,
} as const;

const NO_PHOTOS: PhotoCopyOutcome = { copies: new Map(), copied: 0, failed: 0, skipped: 0, unsupported: 0, droppedVariants: 0, deferred: 0 };


export class InspectionCopyReportService extends InspectionSubService {
    constructor(db: D1Database, private readonly bucket: R2Bucket, private readonly planQuota?: PlanQuotaGuard) {
        super(db, bucket);
    }

    async copyReport(tenantId: string, sourceId: string, options: CopyReportOptions): Promise<{ inspection: CreatedCopy; summary: CopyReportSummary }> {
        const db = this.getDrizzle();
        const source = await db.select().from(inspections)
            .where(and(eq(inspections.id, sourceId), eq(inspections.tenantId, tenantId))).get();
        // A foreign tenant's id is the same answer as a missing one.
        if (!source) throw Errors.NotFound('Inspection not found');
        if (options.property === 'different' && !options.propertyAddress?.trim()) {
            throw Errors.BadRequest('propertyAddress is required when the copy is for a different property');
        }
        // Photo metadata can carry the original property's location, so photos do not travel to a different property.
        if (options.property === 'different' && options.photos) {
            throw Errors.BadRequest('photos cannot be copied to a different property');
        }

        const primaryId = await resolvePrimaryReportId(db, tenantId, sourceId);
        const sourceResults = await db.select().from(inspectionResults)
            .where(primaryId
                ? and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.reportId, primaryId))
                : and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.inspectionId, sourceId)))
            .get();
        const sourceData = (sourceResults?.data ?? {}) as Record<string, ItemEntry>;
        const selected = selectFindings(sourceData, source.templateSnapshot as object | string | null, options.scope, { photos: options.photos });

        const newId = crypto.randomUUID();
        const now = new Date();
        const values = cloneInsertValues(source, { id: newId, tenantId, date: now.toISOString(), createdAt: now });

        // The allowance is consumed once, after every check above and before the first write. A refusal writes nothing.
        await this.planQuota?.consumeInspection(tenantId);

        // From here on a failure gives the place back and removes whatever was written.
        try {
            await db.insert(inspections).values(options.property === 'different'
                ? { ...values, ...PROPERTY_COLUMNS_CLEARED, propertyAddress: options.propertyAddress!.trim() }
                : values);
            const photoOutcome = options.photos ? await this.copyPhotos(tenantId, sourceId, newId, selected.data) : NO_PHOTOS;
            const reportId = await createPrimaryReport(db, tenantId, newId, source.templateId);
            // Without its report the copy could not be opened in the editor.
            if (!reportId) throw new Error('the primary report of the copy could not be created');
            await db.insert(inspectionResults).values({
                id: crypto.randomUUID(),
                tenantId,
                inspectionId: newId,
                reportId,
                data: selected.data as unknown as object,
                // `ydocState` is left null on purpose: the editor's document for the new report hydrates from `data` and starts its own history.
                lastSyncedAt: now,
                ratingSystemId: sourceResults?.ratingSystemId ?? null,
                ratingSystemSnapshot: sourceResults?.ratingSystemSnapshot ?? null,
            });
            if (options.scope === 'all') await this.copyTags(tenantId, sourceId, newId, selected.keys, now);
            const links = await this.copyRoster(tenantId, sourceId, newId, options.property === 'same');

            const created = await db.select().from(inspections)
                .where(and(eq(inspections.id, newId), eq(inspections.tenantId, tenantId))).get();
            if (!created) throw new Error('copied inspection disappeared immediately after insert');
            return {
                inspection: created,
                summary: {
                    findings: { copied: selected.copied, dropped: selected.dropped },
                    photos: {
                        requested: options.photos, copied: photoOutcome.copied, failed: photoOutcome.failed, skipped: photoOutcome.skipped,
                        unsupported: photoOutcome.unsupported, droppedVariants: photoOutcome.droppedVariants, deferred: photoOutcome.deferred,
                        complete: options.photos
                            ? photoOutcome.failed === 0 && photoOutcome.deferred === 0 && photoOutcome.unsupported === 0 && photoOutcome.droppedVariants === 0
                            : null,
                    },
                    people: { requested: options.property === 'same', copied: links.people },
                    roster: { copied: links.roster },
                },
            };
        } catch (err) {
            // Nothing half-made is left behind: the rows and every object under the new report's prefix go.
            let cleaned = true;
            await deleteInspectionCascade(db, this.bucket, tenantId, newId).catch((cleanup) => {
                cleaned = false;
                logger.error('copy-report.cleanup.failed', { inspectionId: newId }, cleanup instanceof Error ? cleanup : undefined);
            });
            // The place the failed copy took, given back only when nothing of it is left to count. The guard drops its own
            // failures, so this cannot replace the error that matters.
            if (cleaned) await this.planQuota?.releaseInspection(tenantId);
            throw err;
        }
    }

    /** Copies the objects, then rewrites the photo entries in `data` to the new keys; an entry that did not copy is removed. */
    private async copyPhotos(tenantId: string, sourceId: string, newId: string, data: Record<string, ItemEntry>): Promise<PhotoCopyOutcome> {
        const arrays = Object.values(data).flatMap(photoArrays);
        const entries = arrays.flatMap(({ owner }) => owner.photos ?? []);
        const outcome = await copyPhotoEntries(this.bucket, { tenantId, sourceInspectionId: sourceId, targetInspectionId: newId }, entries);
        for (const { owner } of arrays) {
            owner.photos = (owner.photos ?? []).flatMap((entry): PhotoEntry[] => {
                const keys: CopiedPhotoKeys | undefined = outcome.copies.get(photoIdentity(entry));
                if (!keys) return [];
                const copy: PhotoEntry = { ...entry, ...keys };
                // A variant that was not copied must not keep pointing at the source's file, nor its crop transform.
                if (!keys.croppedKey) { delete copy.croppedKey; delete copy.crop; }
                if (!keys.annotatedKey) delete copy.annotatedKey;
                return [copy];
            });
        }
        return outcome;
    }

    private async copyTags(tenantId: string, sourceId: string, newId: string, keys: string[], now: Date): Promise<void> {
        if (keys.length === 0) return;
        const db = this.getDrizzle();
        const links = await db.select().from(inspectionItemTagLinks).where(and(
            eq(inspectionItemTagLinks.tenantId, tenantId),
            eq(inspectionItemTagLinks.inspectionId, sourceId),
            inArray(inspectionItemTagLinks.itemId, keys),
        )).all();
        for (const link of links) {
            await db.insert(inspectionItemTagLinks).values({ inspectionId: newId, itemId: link.itemId, tagId: link.tagId, tenantId, createdAt: now });
        }
    }

    /** The lead and helpers come along; the client and agents only when the copy is for the same property. */
    private async copyRoster(tenantId: string, sourceId: string, newId: string, withPeople: boolean): Promise<{ people: boolean; roster: boolean }> {
        const db = this.getDrizzle();
        const done = { people: true, roster: true };
        // Same non-fatal stance as the booking clone: the inspection row is committed, and assignment can be redone.
        if (withPeople) {
            try {
                const people = new PeopleService({ DB: this.db });
                for (const p of await people.listPeople(tenantId, sourceId)) await people.addPerson(tenantId, newId, p.contactId, p.roleProfileId);
            } catch (err) {
                done.people = false;
                logger.error('copy-report.people.failed', { inspectionId: newId }, err instanceof Error ? err : undefined);
            }
        }
        try {
            const roster = await getInspectionRoster(db, tenantId, sourceId);
            const row = await db.select({ inspectorId: inspections.inspectorId }).from(inspections)
                .where(and(eq(inspections.id, newId), eq(inspections.tenantId, tenantId))).get();
            await syncInspectionAssignments(db, tenantId, newId, {
                inspectorId: row?.inspectorId ?? null,
                leadInspectorId: roster.lead?.id ?? null,
                helperInspectorIds: roster.helpers.map((h) => h.id),
            });
        } catch (err) {
            done.roster = false;
            logger.error('copy-report.roster.failed', { inspectionId: newId }, err instanceof Error ? err : undefined);
        }
        return done;
    }
}
