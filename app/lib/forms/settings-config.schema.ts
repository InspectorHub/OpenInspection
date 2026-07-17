import { z } from "zod";
// i18n — locale-aware validation messages. `m.*()` resolves to the active locale
// via paraglide's ALS (server) / cookie (client), so schemas carrying user-facing
// messages are built by a FACTORY called per validation (never a module-level
// const, which would freeze the message at import time).
import { m } from "~/paraglide/messages";

/**
 * Form schemas for the SETTINGS/config pages, mirroring the API's validation
 * rules (server/lib/validations/* and server/api/admin.ts). Kept as plain zod
 * (no `.openapi()`) so the SAME schema runs in each route action
 * (`parseWithZod`) and in the browser via Conform's `onValidate` — one
 * validation source, progressive-enhancement safe.
 *
 * NOTE (scope): only the text-validatable forms on these pages are migrated to
 * Conform. Secret-paste-only sections (driven by <SecretField>, which submits an
 * empty hidden value when unchanged to mean "no change") and pure toggle/button
 * intents have nothing to text-validate and are intentionally left as plain
 * <Form> POSTs.
 */

/**
 * Stripe Connect — `connect-stripe` intent on /settings/advanced.
 * Mirrors the API's inspector-facing stripe-connect body
 * (server/lib/validations/admin.schema.ts): account id must look like
 * `acct_` + 10+ alphanumerics.
 */
export function makeStripeConnectSchema() {
  return z.object({
    stripeAccountId: z
      .string()
      .min(1, m.validation_stripe_account_id_required())
      .regex(
        /^acct_[a-zA-Z0-9]{10,}$/,
        m.validation_stripe_account_id_invalid(),
      ),
  });
}

export type StripeConnectInput = z.infer<ReturnType<typeof makeStripeConnectSchema>>;

/**
 * Email delivery — `save-email` intent on /settings/communication.
 * Both fields are optional (the API stores them as nullable), but when present
 * they must be valid email addresses. The action maps empty strings to null.
 */
export function makeCommunicationEmailSchema() {
  return z.object({
    senderEmail: z
      .string()
      .trim()
      .email(m.validation_comm_email_invalid())
      .or(z.literal(""))
      .optional(),
    replyTo: z
      .string()
      .trim()
      .email(m.validation_comm_email_invalid())
      .or(z.literal(""))
      .optional(),
    emailMode: z.enum(["platform", "own"]).default("platform"),
    senderDisplayName: z.string().trim().max(120).optional(),
    pointOfContact: z.enum(["inspector", "company"]).default("company"),
  });
}

export type CommunicationEmailInput = z.infer<ReturnType<typeof makeCommunicationEmailSchema>>;
