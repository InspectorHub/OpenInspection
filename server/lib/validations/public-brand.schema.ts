import { z } from '@hono/zod-openapi';

/**
 * A-10 — the canonical tenant brand every public surface paints with.
 * Fields are nullable verbatim from tenant_configs; null primaryColor means
 * "keep the platform design tokens" (no per-surface fallback drift).
 *
 * Lives here rather than beside the route that first served it: several public
 * payloads embed it, and the frontend derives its own types from those payloads
 * (`z.infer`) instead of hand-copying them. `app/` imports from `server/lib/**`
 * by convention and must not reach into `server/api/**`, so a schema that any
 * client type depends on belongs in validations.
 */
export const PublicBrandSchema = z.object({
    companyName: z.string().nullable(),
    // The registered legal entity, ALREADY RESOLVED by BrandingService.getBrand
    // (falls back to companyName; '' only when the tenant has no config row).
    // Public because it is the 'from' party on an invoice and the contracting
    // party on an agreement — both already handed to every client.
    legalName: z.string().default(''),
    primaryColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    // Tenant display timezone (IANA; 'UTC' when unset). Public/report surfaces
    // anchor displayed inspection dates to this zone.
    defaultTimezone: z.string().default('UTC'),
    // #270 — the tenant's display LANGUAGE and SHAPE. A public surface has no
    // authenticated user to read a personal override from, and an inspection
    // date must read the same to all three parties anyway, so these are the
    // tenant's values and there is no per-viewer variant here.
    defaultLocale: z.string().default('en-US'),
    dateFormat: z.enum(['us', 'iso', 'eu']).default('us'),
    timeFormat: z.enum(['12h', '24h']).default('12h'),
    // IA-36 ⑨ — how a client reaches the company when a link stops working.
    // A dead-link page that names the company but gives no way to contact it
    // tells the reader who failed them, not how to recover.
    //
    // These are business contact details, already the tenant's client-facing
    // channels (`companyPhone` is interpolated into client SMS, `supportEmail`
    // is the address transactional mail tells clients to reply to), so serving
    // them on a slug-addressable public endpoint exposes nothing the tenant
    // was not already handing to every client. Both stay null until set —
    // the UI degrades to "contact the company" rather than inventing a channel.
    supportEmail: z.string().nullable(),
    companyPhone: z.string().nullable(),
    // Effective Privacy / Terms URLs (hosted /legal/:slug/… or custom).
    privacyUrl: z.string().nullable(),
    termsUrl: z.string().nullable(),
});
