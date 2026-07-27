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
    primaryColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    // Tenant display timezone (IANA; 'UTC' when unset). Public/report surfaces
    // anchor displayed inspection dates to this zone.
    defaultTimezone: z.string().default('UTC'),
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
});
