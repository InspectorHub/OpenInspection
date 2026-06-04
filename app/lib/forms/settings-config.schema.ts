import { z } from "zod";

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
export const stripeConnectSchema = z.object({
  stripeAccountId: z
    .string()
    .min(1, "Stripe account ID is required")
    .regex(
      /^acct_[a-zA-Z0-9]{10,}$/,
      "Please enter a valid Stripe account ID (starts with acct_).",
    ),
});

export type StripeConnectInput = z.infer<typeof stripeConnectSchema>;

/**
 * Email delivery — `save-email` intent on /settings/communication.
 * Both fields are optional (the API stores them as nullable), but when present
 * they must be valid email addresses. The action maps empty strings to null.
 */
export const communicationEmailSchema = z.object({
  senderEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .or(z.literal(""))
    .optional(),
  replyTo: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .or(z.literal(""))
    .optional(),
  emailMode: z.enum(["platform", "own"]).default("platform"),
  senderDisplayName: z.string().trim().max(120).optional(),
  useInspectorFromName: z.preprocess((v) => v === "on" || v === true, z.boolean()).default(false),
});

export type CommunicationEmailInput = z.infer<typeof communicationEmailSchema>;
