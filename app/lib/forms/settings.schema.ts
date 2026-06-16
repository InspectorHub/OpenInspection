import { z } from "zod";

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

const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Must contain at least one uppercase letter")
  .regex(/[0-9]/, "Must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Must contain at least one special character");

/* ------------------------------------------------------------------ */
/*  Account (settings-account.tsx)                                     */
/* ------------------------------------------------------------------ */

/**
 * Delete-account confirmation — mirrors the API's `AccountDeleteRequestSchema`
 * (confirmEmail must be a valid email). The action additionally checks the
 * email is non-empty; a valid email already implies that.
 */
export const deleteAccountSchema = z.object({
  confirmEmail: z
    .string()
    .min(1, "Retype your account email to confirm deletion")
    .email("Enter a valid email address"),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

/* ------------------------------------------------------------------ */
/*  Security (settings-security.tsx)                                   */
/* ------------------------------------------------------------------ */

/**
 * Change-password — mirrors the API's `ChangePasswordSchema`
 * (currentPassword required, newPassword = strong). The confirmPassword field
 * is form-only; a cross-field `refine` enforces the match (the action also
 * guards it server-side).
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: strongPassword,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Turnstile secret key — the only validated field on the bot-protection form.
 * The action only writes when non-empty, so a blank value is allowed (no-op);
 * any non-blank value is trimmed and saved.
 */
export const turnstileSchema = z.object({
  TURNSTILE_SECRET_KEY: z.string(),
});

export type TurnstileInput = z.infer<typeof turnstileSchema>;

/* ------------------------------------------------------------------ */
/*  Profile (settings-profile.tsx)                                     */
/* ------------------------------------------------------------------ */

/**
 * Profile fields — mirrors the API's inline `PatchProfileSchema` in
 * `server/api/profile.ts` (name max 100, phone max 30, licenseNumber max 50,
 * bio max 600). All fields optional so a partial save leaves untouched fields
 * unchanged.
 *
 * DB-12 / IA-26 (2026-06-06) — slug removed. Inspector booking slugs are
 * frozen; the field was removed from the PATCH endpoint on the API side.
 * Agent slugs use POST /api/agent/profile (separate endpoint, unaffected).
 */
export const profileSchema = z.object({
  name: z.string().max(100, "Name is too long").optional(),
  phone: z.string().max(30, "Phone is too long").optional(),
  licenseNumber: z.string().max(50, "License number is too long").optional(),
  bio: z.string().max(600, "Bio must be at most 600 characters").optional(),
  signatureEnabled: z.boolean().optional(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/* ------------------------------------------------------------------ */
/*  Workspace (settings-workspace.tsx)                                 */
/* ------------------------------------------------------------------ */

/**
 * Workspace branding — mirrors the API's `UpdateBrandingSchema`
 * (siteName 1..50, primaryColor #hex, reportTheme enum, customReferralSources
 * is a textarea split per-line in the action so it is NOT validated as an
 * array here).
 */
const THEMES = ["modern", "classic", "minimal"] as const;

export const workspaceSchema = z.object({
  siteName: z
    .string()
    .min(1, "Workspace name is required")
    .max(50, "Workspace name is too long"),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  reportTheme: z.enum(THEMES).optional(),
  customReferralSources: z.string().optional(),
  // Track E1 — gate the "Repair List" tab on published reports.
  // The action reads these via fd.getAll() and appends to body directly;
  // the schema entries ensure they are present in the field map for conform.
  enableRepairList: z.boolean().optional(),
  // Gate the client-driven "Build repair request" export on published reports.
  enableCustomerRepairExport: z.boolean().optional(),
});

export type WorkspaceInput = z.infer<typeof workspaceSchema>;

/* ------------------------------------------------------------------ */
/*  Services (settings-services.tsx)                                   */
/* ------------------------------------------------------------------ */

/**
 * Create-service — mirrors the API's `CreateServiceSchema` (name 1..200,
 * description max 1000 optional, price >= 0). The price is entered in dollars
 * and converted to integer cents in the action, so we validate the raw dollar
 * input as a non-negative number string.
 */
export const createServiceSchema = z.object({
  name: z
    .string()
    .min(1, "Service name is required")
    .max(200, "Service name is too long"),
  description: z.string().max(1000, "Description is too long").optional(),
  price: z
    .string()
    .optional()
    .refine(
      (v) => v == null || v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0),
      "Enter a price of 0 or more",
    ),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
