/**
 * The columns of an inspection record that a read returns beyond the short `Inspection` header.
 *
 * One object, shared by every response that carries the record (the create response, `GET /api/inspections/{id}`
 * and the staff report payload), so the three cannot drift apart. Every key is optional: a server that predates a
 * column leaves it out, a caller without a capability gets the key removed (money), and a client must cope with
 * both. Nullable where the column is.
 *
 * `tests/unit/inspections/inspection-row-schema.spec.ts` checks that each key here is a column of `inspections`,
 * or one of the computed keys below.
 *
 * Not listed on purpose: `tenantId`, which the record also carries. It is not part of the published contract and is tracked in
 * the undeclared-keys allow-list (tests/unit/helpers/undeclared-response-keys.allowlist.json).
 */
import { z } from '@hono/zod-openapi';
import { CANCELLATION_REASONS } from '../../cancellation-reason';
import { REPORT_STATUSES } from '../../status/report-status';
import { INSPECTION_PROPERTY_TYPES } from '@core/field-ui/shared/inspection-property-type';

/** A timestamp column as it reaches a client: an ISO 8601 string, or null. */
const when = (what: string) => z.string().datetime().nullable().optional().describe(`${what} (ISO 8601), or null.`);

export const INSPECTION_ROW_FIELDS = {
    // Property and address
    addressPlaceId: z.string().nullable().optional().describe('Place identifier returned by the address autocomplete, or null.'),
    addressStreet: z.string().nullable().optional().describe('Street line of the geocoded address, or null.'),
    addressCity: z.string().nullable().optional().describe('City of the geocoded address, or null.'),
    addressState: z.string().nullable().optional().describe('State or region code of the geocoded address, or null.'),
    addressZip: z.string().nullable().optional().describe('Postal code of the geocoded address, or null.'),
    addressCounty: z.string().nullable().optional().describe('County as the address autocomplete returned it, or null. The Property Facts county is `county`.'),
    addressLat: z.number().nullable().optional().describe('Latitude of the geocoded address, or null.'),
    addressLng: z.number().nullable().optional().describe('Longitude of the geocoded address, or null.'),
    addressGeocodedAt: when('When the address was geocoded'),
    unit: z.string().nullable().optional().describe('Suite or unit designation of the inspected property, or null.'),
    county: z.string().nullable().optional().describe('County as the Property Facts strip edits it, or null.'),
    propertyType: z.enum(INSPECTION_PROPERTY_TYPES).nullable().optional().describe('What kind of property is being inspected, or null when it was never classified.'),
    commercialSubtype: z.string().nullable().optional().describe('Commercial property subtype, or null. Only meaningful when the property type is commercial.'),
    yearBuilt: z.number().int().nullable().optional().describe('Year the property was built, or null.'),
    sqft: z.number().int().nullable().optional().describe('Floor area in square feet, or null.'),
    foundationType: z.string().nullable().optional().describe('Foundation type, or null.'),
    bedrooms: z.number().int().nullable().optional().describe('Number of bedrooms, or null.'),
    bathrooms: z.number().nullable().optional().describe('Number of bathrooms (may be fractional), or null.'),
    lotSize: z.string().nullable().optional().describe('Lot size as free text, such as "0.25 acres", or null.'),
    propertyFacts: z.record(z.string(), z.unknown()).nullable().optional().describe('The Property Facts values (year built, size, foundation and the like), or null when none are stored.'),

    // Order and scheduling
    reportStatus: z.enum(REPORT_STATUSES).optional().describe('Where the report is in its life: in_progress, submitted or published.'),
    paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional().describe('How much of the order has been paid.'),
    paymentRequired: z.boolean().optional().describe('Whether payment is required before the report is released.'),
    agreementRequired: z.boolean().optional().describe('Whether a signed agreement is required before the report is released.'),
    autoSignOnPublish: z.boolean().optional().describe('Whether the inspector signature is applied automatically when the report is published.'),
    disableAutomations: z.boolean().optional().describe('True when automations are switched off for this inspection.'),
    teamMode: z.boolean().optional().describe('True when the inspection is worked by a team.'),
    confirmedAt: when('When the client confirmed the booking'),
    scheduledStartMs: z.string().datetime().nullable().optional().describe('Start of the scheduled time slot, or null. An ISO 8601 string here, unlike the epoch-millisecond number the schedule request takes.'),
    scheduledEndMs: z.string().datetime().nullable().optional().describe('End of the scheduled time slot, or null. An ISO 8601 string here, unlike the epoch-millisecond number the schedule request takes.'),
    durationMin: z.number().int().nullable().optional().describe('Expected duration in minutes, or null.'),
    requestId: z.string().nullable().optional().describe('Id of the booking request this inspection came from, or null.'),
    conciergeStatus: z.string().nullable().optional().describe('Status of the concierge booking flow for this inspection, or null.'),
    referenceNumber: z.string().nullable().optional().describe('External order or reference number, or null.'),
    referralSource: z.string().nullable().optional().describe('Free-text label for the referral channel, or null.'),
    referredByContactId: z.string().nullable().optional().describe('Contact who referred this job, or null.'),
    closingDate: z.string().nullable().optional().describe('Closing date of the property sale (YYYY-MM-DD), or null.'),
    internalNotes: z.string().nullable().optional().describe('Private notes for the company; never shown to the client.'),

    // Money
    price: z.number().optional().describe('Denormalized price cache in cents. ABSENT without the inspectionFees capability.'),
    discountAmount: z.number().nullable().optional().describe('Discount applied to the order, in cents, or null. ABSENT without the inspectionFees capability.'),
    discountCodeId: z.string().nullable().optional().describe('Id of the discount code applied to the order, or null.'),
    depositRequiredCents: z.number().int().nullable().optional().describe('Deposit owed on this order, in integer cents, or null. ABSENT without the inspectionFees capability.'),
    depositOverridden: z.boolean().optional().describe('True when an operator set the deposit by hand, so a later re-resolve does not replace it.'),

    // Cancellation
    cancelReason: z.enum(CANCELLATION_REASONS).nullable().optional().describe('Why the inspection was cancelled, or null when it was not.'),
    cancelNotes: z.string().nullable().optional().describe('Free-text note stored with a cancellation, or null.'),

    // Report settings
    coverPhotoId: z.string().nullable().optional().describe('Storage key of the photo chosen as the report cover, or null when none is chosen.'),
    coverCrop: z.object({
        aspect: z.enum(['3:2', '16:9', '1.91:1', '4:3']),
        orientation: z.enum(['landscape', 'portrait']),
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
    }).nullable().optional().describe('The crop rectangle chosen for the cover photo, or null. It is only meaningful against the current cover photo.'),
    coverImageKey: z.string().nullable().optional().describe('Storage key of the cropped cover image the report uses when set, or null.'),
    reportTier: z.enum(['light_commercial', 'full_pca']).nullable().optional().describe('Report tier of a commercial inspection, or null for none.'),
    reportPhotoMode: z.enum(['appendix', 'inline']).nullable().optional().describe('Forced photo presentation mode, or null to derive it from the report tier.'),
    reportPhotoColumns: z.number().int().nullable().optional().describe('Photo grid columns for this report (1-4), or null to inherit the profile.'),
    profileOverride: z.string().nullable().optional().describe('Appearance profile id for this report, or null to inherit.'),
    badgeLayoutOverride: z.enum(['strip', 'inline']).nullable().optional().describe('Credential badge layout for this report, or null to inherit the profile.'),
    requireDefectFieldsOverride: z.enum(['none', 'location', 'trade', 'both']).nullable().optional().describe('Which defect fields the publish gate requires for this inspection, or null to inherit the company default.'),
    reportsGeneratedAt: when('When the report files were last generated'),
    templateSnapshot: z.record(z.string(), z.unknown()).nullable().optional().describe('The template structure frozen onto this inspection, or null when it has none or the stored value is not a readable object. The editor reads it to render the checklist.'),
    templateSnapshotVersion: z.number().int().nullable().optional().describe('Version of the template at the time the snapshot was taken, or null.'),

    // Commercial property condition report
    pcaNarrative: z.record(z.string(), z.string()).nullable().optional().describe('The stored PCA report narrative blocks by key, or null when none are stored. Blocks left empty fall back to seed copy when the report renders.'),
    unitInspectionMode: z.enum(['tagged', 'per_unit']).optional().describe('Whether findings are tagged with a location or recorded per unit.'),
    locationOptions: z.array(z.string()).nullable().optional().describe('Locations a finding can be tagged with in tagged mode, or null.'),
    samplingDeclaration: z.object({
        samplingMethod: z.enum(['exhaustive', 'representative']),
        unitsTotal: z.number().optional(),
        unitsInspected: z.number().optional(),
        basis: z.string().optional(),
    }).nullable().optional().describe('What was sampled and what was not, or null.'),
    deviations: z.array(z.object({
        id: z.string(), area: z.string(), baselineRequirement: z.string(), deviation: z.string(), reason: z.string(),
    })).nullable().optional().describe('Deviations from the standard guide, or null when none are recorded.'),

    // Re-inspection and unlock
    sourceInspectionId: z.string().nullable().optional().describe('Inspection this one was created from, or null.'),
    rootInspectionId: z.string().nullable().optional().describe('First inspection of a re-inspection chain, or null.'),
    reinspectionRound: z.number().int().nullable().optional().describe('Position in a re-inspection chain, or null.'),
    unlockedAt: when('When the published report was unlocked for editing'),
    unlockedBy: z.string().nullable().optional().describe('Id of the person who unlocked the report, or null.'),
    unlockReason: z.string().nullable().optional().describe('Reason given for unlocking the report, or null.'),
} as const;

/**
 * Keys a read adds that are not columns of `inspections`: the client contact comes from the people join and the
 * signed flag from the agreements table.
 */
export const INSPECTION_COMPUTED_FIELDS = {
    clientPhone: z.string().nullable().optional().describe('Phone number of the primary client, or null when none is recorded.'),
    signedByClient: z.boolean().optional().describe('True when the client has signed an agreement for this inspection.'),
} as const;

export const INSPECTION_COMPUTED_KEYS: readonly string[] = Object.keys(INSPECTION_COMPUTED_FIELDS);

/** The record fields without the given keys, for a payload that never carries them. The result keeps the types of the rest. */
export function inspectionRowFieldsWithout<K extends keyof typeof INSPECTION_ROW_FIELDS>(...omit: K[]): Omit<typeof INSPECTION_ROW_FIELDS, K> {
    const dropped: readonly string[] = omit;
    return Object.fromEntries(Object.entries(INSPECTION_ROW_FIELDS).filter(([key]) => !dropped.includes(key))) as Omit<typeof INSPECTION_ROW_FIELDS, K>;
}
