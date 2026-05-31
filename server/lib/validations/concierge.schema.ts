import { z } from '@hono/zod-openapi';

/**
 * Public concierge booking flow schemas (Tasks 15-17 of
 * typed-hono-dead-routes-cleanup).
 *
 * These describe the UNAUTHENTICATED endpoints:
 *   GET  /api/concierge/book-info?token=...    — render the booking page
 *   POST /api/concierge/book                   — create a booking
 *   GET  /api/concierge/confirm-info?token=... — show just-booked details
 *
 * The token in each query param is an invite/confirmation token, NOT a JWT.
 */

export const BookInfoQuerySchema = z.object({
    token: z
        .string()
        .min(8)
        .describe('Single-use concierge invite token; opaque opaque magic-link secret rotated by the inspector.'),
});

export const BookInfoResponseSchema = z.object({
    success: z.literal(true).describe('Always true on a 200 success response from this endpoint.'),
    data: z.object({
        tenant: z.object({
            name: z.string().describe('Inspection-business display name surfaced on the public booking page.'),
            brand: z
                .record(z.string(), z.any())
                .nullable()
                .describe('Optional tenant brand JSON (colors, logo) — null until the brand-on-tenant migration ships.'),
        }).describe('Tenant snapshot used to brand the public booking page header and CTAs.'),
        inspector: z
            .object({
                id: z.string().describe('Inspector user id linked to this invite, when one is assigned.'),
                name: z.string().describe('Inspector display name shown to the customer on the booking page.'),
            })
            .nullable()
            .describe('Optional inspector binding — null when the invite is for any inspector on the team.'),
        availableSlots: z
            .array(
                z.object({
                    start: z.string().describe('ISO 8601 timestamp marking the slot start in UTC.'),
                    end: z.string().describe('ISO 8601 timestamp marking the slot end in UTC.'),
                }),
            )
            .describe('Bookable slot windows — empty array until calendar integration lands in a follow-up plan.'),
        expiresAt: z
            .string()
            .describe('ISO 8601 timestamp at which this invite token stops being valid.'),
    }).describe('Booking page bootstrap payload — tenant, optional inspector, slots, expiry.'),
});

export const BookRequestSchema = z.object({
    token: z
        .string()
        .min(8)
        .describe('Same invite token used to fetch /book-info; re-sent so the API can re-verify validity.'),
    slot: z.object({
        start: z.string().describe('ISO 8601 timestamp marking the chosen slot start in UTC.'),
        end: z.string().describe('ISO 8601 timestamp marking the chosen slot end in UTC.'),
    }).describe('Customer-selected appointment window (must overlap an availableSlots entry from /book-info).'),
    contactName: z.string().min(1).describe('Customer full name used for the confirmation email and inspection record.'),
    contactEmail: z.string().email().describe('Customer email address used for the confirmation email and follow-ups.'),
    contactPhone: z.string().optional().describe('Optional customer phone number; passed through to the inspection record.'),
    address: z.string().min(1).describe('Property address being inspected; free-form text from the booking form.'),
    notes: z.string().optional().describe('Optional free-form notes the customer wants the inspector to see.'),
});

export const BookResponseSchema = z.object({
    success: z.literal(true).describe('Always true on a 200 success response from this endpoint.'),
    data: z.object({
        bookingId: z.string().describe('Server-assigned UUID for the freshly-created concierge_bookings row.'),
        confirmationToken: z
            .string()
            .describe('Opaque token the frontend hands to /confirm-info to display just-booked details.'),
    }).describe('Booking outcome — id of the new row plus the confirmation token for the next page.'),
});

export const ConfirmInfoQuerySchema = z.object({
    token: z
        .string()
        .min(8)
        .describe('Confirmation token returned by POST /book; used to read back the booking on the confirm page.'),
});

export const ConfirmInfoResponseSchema = z.object({
    success: z.literal(true).describe('Always true on a 200 success response from this endpoint.'),
    data: z.object({
        booking: z.object({
            id: z.string().describe('UUID of the concierge_bookings row being summarized.'),
            start: z.string().describe('ISO 8601 timestamp of the booked slot start in UTC.'),
            end: z.string().describe('ISO 8601 timestamp of the booked slot end in UTC.'),
            address: z.string().describe('Property address being inspected, echoed back from the booking form.'),
            contactName: z.string().describe('Customer full name echoed back from the booking form.'),
            tenant: z.object({
                name: z.string().describe('Inspection-business display name surfaced on the confirm page.'),
            }).describe('Tenant snapshot used to brand the confirm page header.'),
        }).describe('Booking record echoed back to the customer for visual confirmation.'),
    }).describe('Confirm page payload — booking + tenant snapshot.'),
});
