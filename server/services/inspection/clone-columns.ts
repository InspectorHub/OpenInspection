/**
 * What a copy of an inspection takes from its source.
 *
 * An explicit list rather than "everything except": a column added to the table later
 * is NOT carried until someone decides it should be. The old copy spread the whole
 * source row, so a copy of a published job arrived with the source's published
 * report status, unlock record, cover photo, confirmation time, cancellation reason,
 * re-inspection links and PCA narrative, none of which describe the new job.
 *
 * Carried: where and what (address, property facts, template and its snapshot), who
 * (the inspector), and the booking terms (price, requirements, references, deposit).
 * Not carried, so they start as the table defaults: report and payment state,
 * signature switch, cover, confirmation, cancellation, unlock, schedule instants,
 * request and re-inspection links, concierge state, discount, and the inspection's own
 * findings-side data (property facts envelope, PCA narrative, deviations, sampling).
 */
import type { inspections } from '../../lib/db/schema';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';

type Row = typeof inspections.$inferSelect;
type NewRow = typeof inspections.$inferInsert;

export function cloneInsertValues(source: Row, fresh: { id: string; tenantId: string; date: string; createdAt: Date }): NewRow {
    return {
        id: fresh.id,
        tenantId: fresh.tenantId,
        date: fresh.date,
        createdAt: fresh.createdAt,
        status: INSPECTION_STATUS.REQUESTED,
        paymentStatus: 'unpaid',
        inspectorId: source.inspectorId,
        propertyAddress: source.propertyAddress,
        addressPlaceId: source.addressPlaceId,
        addressStreet: source.addressStreet,
        addressCity: source.addressCity,
        addressState: source.addressState,
        addressZip: source.addressZip,
        addressCounty: source.addressCounty,
        addressLat: source.addressLat,
        addressLng: source.addressLng,
        addressGeocodedAt: source.addressGeocodedAt,
        templateId: source.templateId,
        templateSnapshot: source.templateSnapshot,
        templateSnapshotVersion: source.templateSnapshotVersion,
        price: source.price,
        paymentRequired: source.paymentRequired,
        agreementRequired: source.agreementRequired,
        depositRequiredCents: source.depositRequiredCents,
        depositOverridden: source.depositOverridden,
        closingDate: source.closingDate,
        referralSource: source.referralSource,
        referenceNumber: source.referenceNumber,
        referredByContactId: source.referredByContactId,
        yearBuilt: source.yearBuilt,
        sqft: source.sqft,
        foundationType: source.foundationType,
        bedrooms: source.bedrooms,
        bathrooms: source.bathrooms,
        lotSize: source.lotSize,
        unit: source.unit,
        county: source.county,
        propertyType: source.propertyType,
        commercialSubtype: source.commercialSubtype,
        reportTier: source.reportTier,
        unitInspectionMode: source.unitInspectionMode,
        disableAutomations: source.disableAutomations,
        teamMode: source.teamMode,
        durationMin: source.durationMin,
        profileOverride: source.profileOverride,
        requireDefectFieldsOverride: source.requireDefectFieldsOverride,
        badgeLayoutOverride: source.badgeLayoutOverride,
        reportPhotoColumns: source.reportPhotoColumns,
        reportPhotoMode: source.reportPhotoMode,
    };
}
