import { z } from '@hono/zod-openapi';
import { DepositPolicySchema } from './deposit-policy.schema';

/** Error body of the public booking profile reads when the tenant or the inspector does not exist. */
export const BookingProfileNotFoundSchema = z.object({
    success: z.literal(false).describe('Always false on an error.'),
    error: z.object({
        code: z.string().describe('Stable machine-readable error code.'),
        message: z.string().describe('Human-readable description of what was not found.'),
    }).describe('Error detail.'),
}).openapi('BookingProfileNotFound');

/** GET /api/public/book/{tenant}: what a company offers and whether it is taking bookings. */
export const CompanyBookingProfileResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        company: z.string().describe('Company display name shown on the booking page.'),
        turnstileSiteKey: z.string().nullable().describe('Public site key for the bot-protection widget; null when no widget is shown.'),
        bookingOpen: z.boolean().describe('Whether online booking is on: some qualified inspector has working hours and the company has a declared time zone.'),
        bookingClosedReason: z.enum(['no_inspector_hours', 'no_company_timezone']).nullable().describe('Operator diagnostic naming which half of the open test is missing; null while booking is open.'),
        allowInspectorChoice: z.boolean().describe('Whether the visitor may pick an inspector.'),
        conciergeReviewRequired: z.boolean().describe('Whether new bookings wait for office review before they are confirmed.'),
        inspectors: z.array(z.object({
            id: z.string().describe('Inspector user id.'),
            name: z.string().nullable().describe('Inspector display name; null when the user has none.'),
            photoUrl: z.string().nullable().describe('Inspector photo URL; null when none is set.'),
        })).describe('Inspectors the visitor may choose from; empty unless inspector choice is enabled.'),
        currency: z.string().describe('ISO currency code prices are quoted in.'),
        depositPolicy: DepositPolicySchema.nullable().describe('The company default deposit, quoted for the page; null when none is set.'),
        services: z.array(z.object({
            id: z.string().describe('Service id.'),
            name: z.string().describe('Service name.'),
            price: z.number().describe('Price in integer cents.'),
            duration: z.number().describe('Duration in minutes.'),
            depositPolicy: DepositPolicySchema.nullable().describe('Deposit override for this service; null when it follows the company default.'),
        })).describe('Active services that have an inspection template attached.'),
    }).describe('The company booking profile.'),
}).openapi('CompanyBookingProfileResponse');

/** GET /api/public/book/{tenant}/{slug}: the booking profile of one inspector. */
export const InspectorBookingProfileResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        inspectorId: z.string().describe('Inspector user id.'),
        name: z.string().nullable().describe('Inspector display name; null when the user has none.'),
        company: z.string().describe('Company display name shown on the booking page.'),
        avatar: z.string().nullable().describe('Inspector photo URL; null when none is set.'),
        turnstileSiteKey: z.string().nullable().describe('Public site key for the bot-protection widget; null when no widget is shown.'),
        bookingOpen: z.boolean().describe('Whether this inspector has working hours and the company has a declared time zone.'),
        services: z.array(z.object({
            id: z.string().describe('Service id.'),
            name: z.string().describe('Service name.'),
            price: z.number().describe('Price in integer cents.'),
            duration: z.number().describe('Duration in minutes.'),
        })).describe('Active services of the company.'),
    }).describe('The inspector booking profile.'),
}).openapi('InspectorBookingProfileResponse');
