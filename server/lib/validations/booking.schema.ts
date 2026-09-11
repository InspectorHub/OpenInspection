import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * F42 — the request-level floor and ceiling on a booking date.
 *
 * The public page used to ship a bare `<input type="date">`: `2020-01-05` (a
 * Sunday six years past) passed every client check, reached the last step, and
 * was refused by the slot scan with "That time slot is no longer available" —
 * wrong about the tense, wrong about the field, and only reachable after the
 * visitor had filled in everything else. The picker now carries `min`/`max`, but
 * a picker is a courtesy: `curl` does not have one, and several browsers accept a
 * typed value outside the range.
 *
 * WHY THE BOUNDS ARE DELIBERATELY SLACK. The exact boundary of "past" is a
 * question about the COMPANY's calendar day, and this schema parses before any
 * tenant has been resolved, so it cannot know that zone. No zone on earth is a
 * full day from UTC (the extremes are UTC-12 and UTC+14), so one day of slack
 * makes a false rejection impossible while still refusing every date that is
 * past by any reading. The tenant-zone-exact refusal belongs where the zone is
 * known — `server/services/booking/booking-admission.ts`, which already resolves
 * it — and this is the bound that holds when nothing else does.
 *
 * The two predicates are exported so the bounds are testable without building a
 * request; the slack itself is not — it is an implementation detail of the
 * "past" predicate, and a test that asserted the constant instead of the
 * behaviour would pass while the comparison was wrong.
 */
const BOOKING_PAST_SLACK_DAYS = 1;
/** Two years is not a schedule, it is a mistyped year. Generous on purpose. */
export const BOOKING_MAX_AHEAD_DAYS = 730;

function utcCivilDay(offsetDays: number): string {
    const d = new Date(Date.now() + offsetDays * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    // Assembled from UTC parts rather than sliced off an ISO string: this is a
    // civil-day bucket, and the slice form is the shape the tz gate rejects.
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** False only for a date that is past however it is read. `YYYY-MM-DD` in. */
export function bookingDateIsNotPast(date: string, nowIso = utcCivilDay(-BOOKING_PAST_SLACK_DAYS)): boolean {
    // Civil dates compare correctly as strings — no Date, no zone, no DST.
    return date >= nowIso;
}

/** False for a date so far ahead it can only be a typo. */
export function bookingDateIsWithinHorizon(date: string, lastIso = utcCivilDay(BOOKING_MAX_AHEAD_DAYS)): boolean {
    return date <= lastIso;
}

/**
 * Validation schema for the public booking request.
 *
 * Sprint 1 C-6 — `timeSlot` extended from morning/afternoon to a 4-option
 * window enum. `all-day` collapses to a morning slot internally; `custom`
 * requires a paired `customTime` (HH:mm) — see bookings.ts for the mapping.
 */
export const PublicBookingSchema = z.object({
    // B-16 — the tenant slug from the booking page URL. The submit endpoint
    // has no tenant in its path, and context resolution (SINGLE_TENANT_ID /
    // JWT) does not apply to a public cross-mode endpoint — the slug is the
    // public tenant identifier, resolved server-side exactly like the
    // GET /book/:tenant/:slug page data.
    tenant: z.string().min(1, 'Tenant is required').openapi({ example: 'acme-inspections' }).describe('Tenant slug from the booking page URL; resolved server-side to the tenant id.'),
    address: z.string().min(5, 'Address is too short').openapi({ example: '123 Main St, City, ST 12345' }).describe('TODO describe address field for the OpenInspection MCP integration'),
    // The structured half of the address, present when the visitor picked a
    // suggestion from the public autocomplete instead of typing free text.
    //
    // Both stay OPTIONAL and neither is trusted as the last word: `addressZip`
    // is the lenient client-side parse of Google's secondary text, and the
    // server re-resolves `addressPlaceId` through Places Details to get the
    // authoritative ZIP and the coordinates. A booking typed by hand — or made
    // on a deployment with no Places key — still submits, and simply has no
    // geocode. That absence is reported by the routing decision rather than
    // being invented as (0,0).
    addressZip: z.string().trim().min(3).max(10).optional().openapi({ example: '78701' })
        .describe('ZIP hint from the selected autocomplete suggestion. Re-resolved server-side when a placeId is supplied.'),
    addressPlaceId: z.string().trim().min(8).max(200).optional().openapi({ example: 'ChIJxxx' })
        .describe('Google place id of the selected suggestion. Resolved server-side to the property coordinates used by `closest` routing.'),
    clientName: z.string().min(1, 'Client name is required').openapi({ example: 'John Doe' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email('Invalid email address').openapi({ example: 'john@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    // F42 — the bounds are enforced by the two object-level refinements below,
    // not here: a `.refine()` on the field would wrap it in a ZodEffects, and
    // this object is registered with `.openapi('PublicBooking')` for the MCP
    // surface. Same reason the `customTime` rule sits down there.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
        .openapi({ example: '2026-04-15' })
        .describe('Requested inspection date, YYYY-MM-DD. Must not be in the past, and must be within two years.'),
    timeSlot: z.enum(['morning', 'afternoon', 'all-day', 'custom']).openapi({ example: 'morning' }).describe('TODO describe timeSlot field for the OpenInspection MCP integration'),
    customTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').optional().openapi({ example: '13:30' }).describe('TODO describe customTime field for the OpenInspection MCP integration'),
    // IA-26 — optional. Omit for company-level auto-assign (the server picks the
    // first available qualified inspector). Supply to target a specific inspector
    // (per-inspector deep link / allowInspectorChoice dropdown). If supplied and
    // the inspector is unavailable or belongs to a different tenant the request
    // is rejected; the server will NOT silently reassign to a free inspector.
    inspectorId: z.string().trim().min(1).optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('Optional inspector id. Omit for company-level auto-assign; supply to target a specific inspector (deep link / inspector-choice flow).'),
    turnstileToken: z.string().optional().openapi({ example: '0.xtoken...' }).describe('TODO describe turnstileToken field for the OpenInspection MCP integration'),
    // Sprint 2 S2-2 — Multi-inspection per request. Customer can pick multiple
    // services in a single visit. When omitted (legacy single-service flow),
    // the server still creates a one-inspection request to keep the data model
    // uniform. `serviceIds` are tenant Service entries; their templateId is
    // resolved server-side.
    services: z.array(z.object({
        serviceId: z.string().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe serviceId field for the OpenInspection MCP integration'),
    })).min(1).max(10).optional().openapi({ description: 'Optional list of services to book in one visit (1-10)' }),
    // UC-A-1 — agent referral attribution. The `?ref=<agentSlug>` query param
    // on /book/<inspectorSlug> flows through the form as a hidden field. Server
    // resolves the slug to a global agent user, finds their active link to
    // this tenant, and persists the linked inspectorContactId on
    // inspections.referredByAgentId.
    agentRefSlug: z.string().min(2).max(64).optional().openapi({ example: 'jane-tester' }).describe('TODO describe agentRefSlug field for the OpenInspection MCP integration'),
    // Track L (D6, path A) — unchecked SMS opt-in. When true, the submit records a
    // `granted` SMS consent event (captured_via=booking_form) for the client contact.
    smsOptin: z.boolean().optional().openapi({ example: false }).describe('Client self-book SMS opt-in (TCPA consent). When true, records a granted consent event.'),
    // The language the client asked to be addressed in, stored on their
    // contact. Optional with NO default: an omitted choice must stay NULL,
    // because a stored value is a stated preference and only a stated
    // preference is evidence that anyone wants another language.
    //
    // Typed as a free BCP-47 tag rather than an enum so an unrecognised
    // language can never reject a booking over a cosmetic field; the service
    // reduces it to a locale we have messages for, or to NULL.
    locale: z.string().trim().min(2).max(35).optional().openapi({ example: 'es-419' }).describe("Client's preferred language as a BCP-47 tag; reduced server-side to a supported locale, or ignored when unsupported."),
}).refine(
    (data) => data.timeSlot !== 'custom' || !!data.customTime,
    { message: 'customTime is required when timeSlot is custom', path: ['customTime'] },
).refine(
    (data) => bookingDateIsNotPast(data.date),
    // Names the DATE. The message this replaces — "That time slot is no longer
    // available. Please pick another time." — named the time, so a visitor who
    // asked for a Sunday six years ago was sent back to change the one field
    // that was not the problem.
    { message: 'That date has already passed. Please pick a date from today onwards.', path: ['date'] },
).refine(
    (data) => bookingDateIsWithinHorizon(data.date),
    { message: 'That date is too far ahead to book. Please pick a date within the next two years.', path: ['date'] },
).openapi('PublicBooking');

/**
 * Validation schema for recurring weekly availability.
 */
export const AvailabilitySchema = z.object({
    inspectorId: z.string().trim().min(1).optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    slots: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6).openapi({ example: 1 }).describe('TODO describe dayOfWeek field for the OpenInspection MCP integration'),
        startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').openapi({ example: '09:00' }).describe('TODO describe startTime field for the OpenInspection MCP integration'),
        endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').openapi({ example: '17:00' }).describe('TODO describe endTime field for the OpenInspection MCP integration'),
    })).min(0).openapi({ description: 'List of weekly availability slots (empty array clears all slots)' }),
}).openapi('Availability');

/**
 * Validation schema for date-specific availability overrides.
 */
export const OverrideSchema = z.object({
    inspectorId: z.string().trim().min(1).optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').openapi({ example: '2024-04-16' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    isAvailable: z.boolean().openapi({ example: false }).describe('TODO describe isAvailable field for the OpenInspection MCP integration'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').optional().nullable().openapi({ example: '09:00' }).describe('TODO describe startTime field for the OpenInspection MCP integration'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').optional().nullable().openapi({ example: '17:00' }).describe('TODO describe endTime field for the OpenInspection MCP integration'),
}).openapi('Override');

/**
 * Response Schemas
 */
export const InspectorsResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
    // Nullable because an account may carry no name. It used to be `string`,
    // which the service satisfied by returning the local part of the mailbox —
    // a contract that promised a name and was kept by inventing one.
    name: z.string().nullable().openapi({ example: 'Jane Smith' }).describe("The inspector's name, or null when the account has none"),
}))).openapi('InspectorsResponse');

export const AvailabilityResponseSchema = createApiResponseSchema(z.object({
    bookedSlots: z.array(z.string()).openapi({ example: ['2024-04-15T09:00:00Z'] }).describe('TODO describe bookedSlots field for the OpenInspection MCP integration'),
    overrides: z.array(z.any()).openapi({ description: 'Active availability overrides' }),
    baseAvailability: z.array(z.any()).openapi({ description: 'Standard weekly availability' }),
})).openapi('AvailabilityResponse');

export const BookingResponseSchema = createApiResponseSchema(z.object({
    success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
    // Single-service legacy callers still get the first inspection's id here.
    inspectionId: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    // Sprint 2 S2-2 — request grouping is always present, even for single-service bookings.
    requestId: z.string().optional().openapi({ example: 'req-abc12345' }).describe('TODO describe requestId field for the OpenInspection MCP integration'),
    inspectionIds: z.array(z.string().trim().min(1)).optional().openapi({ description: 'All inspection ids in the request' }),
    // What the booking OWES up front, frozen at this moment. 0 (the default for
    // every workspace) means no payment step is shown. Never what was paid —
    // nothing has been at this point, and only the Stripe webhook says otherwise.
    depositRequiredCents: z.number().int().optional().openapi({ example: 9000 })
        .describe('Deposit owed on this booking in integer cents; 0 when the workspace asks for none.'),
})).openapi('BookingResponse');

export const AvailabilityListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    dayOfWeek: z.number().describe('TODO describe dayOfWeek field for the OpenInspection MCP integration'),
    startTime: z.string().describe('TODO describe startTime field for the OpenInspection MCP integration'),
    endTime: z.string().describe('TODO describe endTime field for the OpenInspection MCP integration'),
    inspectorId: z.string().trim().min(1).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}))).openapi('AvailabilityListResponse');

export const OverrideListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    date: z.string().describe('TODO describe date field for the OpenInspection MCP integration'),
    isAvailable: z.boolean().describe('TODO describe isAvailable field for the OpenInspection MCP integration'),
    startTime: z.string().nullable().describe('TODO describe startTime field for the OpenInspection MCP integration'),
    endTime: z.string().nullable().describe('TODO describe endTime field for the OpenInspection MCP integration'),
    inspectorId: z.string().trim().min(1).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}))).openapi('OverrideListResponse');

export const OverrideResponseSchema = createApiResponseSchema(z.object({
    override: z.object({
        id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
        date: z.string().describe('TODO describe date field for the OpenInspection MCP integration'),
        isAvailable: z.boolean().describe('TODO describe isAvailable field for the OpenInspection MCP integration'),
        startTime: z.string().nullable().describe('TODO describe startTime field for the OpenInspection MCP integration'),
        endTime: z.string().nullable().describe('TODO describe endTime field for the OpenInspection MCP integration'),
        inspectorId: z.string().trim().min(1).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    }).describe('TODO describe override field for the OpenInspection MCP integration'),
})).openapi('OverrideResponse');
