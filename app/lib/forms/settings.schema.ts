import { z } from "zod";
import { requiredText } from "~/lib/forms/required-text";
// i18n — locale-aware validation messages. `m.*()` resolves to the active locale
// via paraglide's ALS (server) / cookie (client), so schemas carrying user-facing
// messages are built by a FACTORY called per validation (never a module-level
// const, which would freeze the message at import time).
import { m } from "~/paraglide/messages";

/**
 * Settings form schemas, mirroring the API's validation rules (see
 * `server/lib/validations/*.schema.ts` and inline route schemas). Kept as
 * plain zod (no `.openapi()`) so the SAME schema runs in each route's action
 * (`parseWithZod`) and in the browser via Conform's `onValidate` — one
 * validation source, progressive-enhancement safe.
 *
 * Settings pages are intent-discriminated (one `<Form>` per intent). Each
 * intent gets its own schema; the `intent` field stays in the form but is NOT
 * part of the validated `submission.value` (the action keeps its own routing).
 */

/* ------------------------------------------------------------------ */
/*  Shared strong-password rule (mirrors api shared.schema passwordSchema) */
/* ------------------------------------------------------------------ */

function makeStrongPassword() {
  return requiredText(m.validation_password_min8())
    .min(8, m.validation_password_min8())
    .regex(/[A-Z]/, m.validation_password_uppercase())
    .regex(/[0-9]/, m.validation_password_number())
    .regex(/[^A-Za-z0-9]/, m.validation_password_special());
}

/* ------------------------------------------------------------------ */
/*  Account (settings-account.tsx)                                     */
/* ------------------------------------------------------------------ */

/**
 * Delete-account confirmation — mirrors the API's `AccountDeleteRequestSchema`
 * (confirmEmail must be a valid email). The action additionally checks the
 * email is non-empty; a valid email already implies that.
 */
export function makeDeleteAccountSchema() {
  return z.object({
    confirmEmail: requiredText(m.validation_delete_account_email_required())
      .min(1, m.validation_delete_account_email_required())
      .email(m.validation_delete_account_email_invalid()),
  });
}

/* ------------------------------------------------------------------ */
/*  Security (settings-security.tsx)                                   */
/* ------------------------------------------------------------------ */

/**
 * Change-password — mirrors the API's `ChangePasswordSchema`
 * (currentPassword required, newPassword = strong). The confirmPassword field
 * is form-only; a cross-field `refine` enforces the match (the action also
 * guards it server-side).
 */
export function makeChangePasswordSchema() {
  return z
    .object({
      currentPassword: requiredText(m.validation_change_password_current_required()).min(1, m.validation_change_password_current_required()),
      newPassword: makeStrongPassword(),
      confirmPassword: requiredText(m.validation_change_password_confirm_required()).min(1, m.validation_change_password_confirm_required()),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: m.validation_change_password_mismatch(),
      path: ["confirmPassword"],
    });
}

export type ChangePasswordInput = z.infer<ReturnType<typeof makeChangePasswordSchema>>;

/* ------------------------------------------------------------------ */
/*  Profile (settings-profile.tsx)                                     */
/* ------------------------------------------------------------------ */

/**
 * Profile fields — mirrors the API's inline `PatchProfileSchema` in
 * `server/api/profile.ts` (name max 100, phone max 30).
 * All fields optional so a partial save leaves untouched fields unchanged.
 *
 * DB-12 / IA-26 (2026-06-06) — slug removed. Inspector booking slugs are
 * frozen; the field was removed from the PATCH endpoint on the API side.
 * Agent slugs use POST /api/agent/profile (separate endpoint, unaffected).
 */
export function makeProfileSchema() {
  return z.object({
    name: z.string().max(100, m.validation_profile_name_too_long()).optional(),
    phone: z.string().max(30, m.validation_profile_phone_too_long()).optional(),
    signatureEnabled: z.boolean().optional(),
    // Per-user display-timezone override (IANA name). Empty string = inherit the
    // tenant default. Constrained to a <select> in the UI.
    timezone: z.string().optional(),
    // Per-user display-locale override (BCP-47). Empty string = inherit the tenant
    // default. Constrained to a <Select> in the UI.
    locale: z.string().optional(),
    // #270 — per-user date/time SHAPE override. Empty string = inherit. This is
    // a SEPARATE axis from `locale`: the locale picks the language, these pick
    // the order and the clock. Constrained to <Select>s in the UI.
    dateFormat: z.string().optional(),
    timeFormat: z.string().optional(),
  });
}

/* ------------------------------------------------------------------ */
/*  Workspace (settings-workspace.tsx)                                 */
/* ------------------------------------------------------------------ */

/**
 * Workspace branding — mirrors the API's `UpdateBrandingSchema`
 * (companyName 1..50, primaryColor #hex, customReferralSources is a textarea
 * split per-line in the action so it is NOT validated as an array here).
 * The report appearance profile picker lives in a dedicated control (Plan 1b).
 */
export function makeWorkspaceSchema() {
  return z.object({
    companyName: requiredText(m.validation_workspace_name_required())
      .min(1, m.validation_workspace_name_required())
      .max(50, m.validation_workspace_name_too_long()),
    primaryColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, m.validation_workspace_color_invalid())
      .optional(),
    defaultProfileId: z.enum(["signature", "meridian", "terra"]).optional(),
    customReferralSources: z.string().optional(),
    // Report-feature flags. Rendered as conform-native checkboxes (single input,
    // value "on", NO hidden "false" sibling) so a checked box submits ONE value that
    // conform coerces to a boolean — read from submission.value in the action. (An
    // earlier hidden+checkbox pair submitted two values and broke z.boolean parsing.)
    enableRepairList: z.boolean().optional(),
    enableCustomerRepairExport: z.boolean().optional(),
    // Report PDF print-layout settings (mirror UpdateBrandingSchema). companyAddress
    // is a free-text field (empty string clears it); the three toggles are
    // conform-native checkboxes like the report-feature flags above.
    companyAddress: z.string().max(300, m.validation_workspace_company_address_too_long()).optional(),
    pdfShowFooter: z.boolean().optional(),
    pdfShowPageNumbers: z.boolean().optional(),
    pdfShowLicense: z.boolean().optional(),
    // Tenant display timezone (IANA name). Free-form string validated on the API;
    // the UI constrains it to a <select> of TIMEZONE_OPTIONS.
    defaultTimezone: z.string().optional(),
    // Tenant default display locale (BCP-47). UI constrains to a <Select> of the
    // supported LOCALE_OPTIONS; API validates via resolveLocale.
    defaultLocale: z.string().optional(),
    // Tenant currency (ISO 4217). UI constrains to a <Select> of CURRENCY_OPTIONS.
    currency: z.string().optional(),
    // #270 — tenant default date order + clock. Not nullable at this level: the
    // tenant value is the bottom of the resolution chain.
    dateFormat: z.string().optional(),
    timeFormat: z.string().optional(),
  });
}

/* ------------------------------------------------------------------ */
/*  Services (settings-services.tsx)                                   */
/* ------------------------------------------------------------------ */

/**
 * Create-service — mirrors the API's `CreateServiceSchema` (name 1..200,
 * description max 1000 optional, price >= 0). The price is entered in dollars
 * and converted to integer cents in the action, so we validate the raw dollar
 * input as a non-negative number string.
 *
 * `durationMinutes` and `templateId` are optional here for the same reason they
 * are optional on the API: a service is a nameable, priceable thing before it is
 * a schedulable one. But both are consumed downstream — the catalog table shows
 * the duration and public booking sums it to size the appointment, and a booking
 * that selects a service builds its inspection from that service's template.
 * Until this form carried them, neither could ever be set.
 */
export function makeCreateServiceSchema() {
  return z.object({
    name: requiredText(m.validation_service_name_required())
      .min(1, m.validation_service_name_required())
      .max(200, m.validation_service_name_too_long()),
    description: z.string().max(1000, m.validation_service_description_too_long()).optional(),
    price: z
      .string()
      .optional()
      .refine(
        (v) => v == null || v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0),
        m.validation_service_price_invalid(),
      ),
    // Whole minutes. The upper bound rejects a slipped decimal point ("1800"
    // meant as 18:00), which would otherwise size a booking window absurdly.
    durationMinutes: z
      .string()
      .optional()
      .refine((v) => {
        if (v == null || v === "") return true;
        const n = Number(v);
        return Number.isInteger(n) && n > 0 && n < 1440;
      }, m.validation_service_duration_invalid()),
    templateId: z.string().optional(),
  });
}

/**
 * Editing an existing service: the same fields, plus which service.
 *
 * Extended rather than restated so the two forms cannot drift into disagreeing
 * about what a valid duration is — the create form gained that bound because a
 * slipped decimal point sizes a booking window absurdly, and the edit form is
 * where an existing bad value would be corrected.
 */
export function makeUpdateServiceSchema() {
  return makeCreateServiceSchema().extend({
    id: requiredText(m.validation_service_id_required()).min(1, m.validation_service_id_required()),
  });
}


/**
 * Read an "inherit-or-override" <select> straight off the FormData.
 *
 * Conform's `parseWithZod` maps an empty string to `undefined`, which is the
 * right call for "the user left the text box blank" and the wrong one here: for
 * these controls `''` is not absence, it is the CLEAR signal ("use the workspace
 * default"), and the action distinguishes clear from leave-alone by whether the
 * key is present at all. Reading the parsed value made clearing a per-user
 * override impossible through the UI — the field silently dropped out of the
 * PATCH body and the old value stayed. Caught in Chrome on #270; `timezone` and
 * `locale` had the same defect and are fixed with it.
 *
 * @returns `''` to clear, the chosen value to set, `undefined` when the control
 *          was not on the submitted form at all.
 */
export function overrideFieldFromForm(fd: FormData, key: string): string | undefined {
  if (!fd.has(key)) return undefined;
  const raw = fd.get(key);
  return typeof raw === "string" ? raw : undefined;
}
