import { z } from "zod";

/**
 * Form schemas, mirroring the API's validation rules
 * (server/lib/validations/auth.schema.ts). Kept as plain zod (no `.openapi()`)
 * so the SAME schema runs in the action (`parseWithZod`) and in the browser via
 * Conform's `onValidate` — one validation source, progressive-enhancement safe.
 *
 * NOTE (rollout): the API schemas use `@hono/zod-openapi`'s `z`. To make these
 * a single shared source of truth, extract the plain-zod base of each schema
 * into a `packages/shared-schemas` consumed by both api and frontend. For now
 * these are co-located mirrors.
 */
export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Shared strong-password rule, mirroring the API's `passwordSchema`
 * (server/lib/validations/shared.schema.ts): min 8 chars with at least one
 * uppercase letter, one digit, and one special character.
 */
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Must contain at least one uppercase letter")
  .regex(/[0-9]/, "Must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Must contain at least one special character");

/**
 * Setup (first-run) — mirrors the API's `SetupSchema`. The form field names
 * (`workspaceName` → companyName, `adminName`, `setupCode` → verificationCode)
 * are preserved; the action maps them to the API body. `setupCode` is required
 * by the form (min 6), matching the operator-provisioned SETUP_CODE.
 */
export const setupSchema = z.object({
  workspaceName: z.string().min(2, "Workspace name is required"),
  adminName: z
    .string()
    .min(2, "Your name is required")
    .max(120, "Name is too long"),
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  password: strongPassword,
  setupCode: z.string().min(6, "Setup code must be at least 6 characters"),
});

export type SetupInput = z.infer<typeof setupSchema>;

/**
 * Human-readable strong-password requirement, shown next to password inputs on
 * the reset and join pages. Kept as ONE constant so both surfaces stay in sync
 * with `strongPassword` above.
 */
export const PASSWORD_HINT =
  'At least 8 characters, with an uppercase letter, a number, and a special character.';

/**
 * Forgot-password request (`/forgot-password`). Only the email is user-entered;
 * the backend answers 200 unconditionally (anti-enumeration).
 */
export const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
});

/**
 * Reset-password submit (`/reset-password`). The token rides as a hidden field
 * (sourced from the URL via the loader), NOT a schema field — the schema only
 * validates the new password. Field name is `newPassword`, matching the API's
 * `ResetPasswordSchema` (server/lib/validations/auth.schema.ts).
 */
export const resetPasswordSchema = z.object({
  newPassword: strongPassword,
});

/**
 * Team-invite accept (`/join`). Token comes from the URL, NOT the form — the
 * schema only validates the user-entered name + password. Mirrors the API's
 * `JoinTeamSchema` password strength.
 */
export const joinSchema = z.object({
  name: z.string().min(1, "Name is required").max(120, "Name is too long"),
  password: strongPassword,
});

export type JoinInput = z.infer<typeof joinSchema>;

/**
 * Partner-agent invite accept (`/agent-invite/accept`). Token + email come from
 * the invite (email is read-only), so only name + password are validated.
 * Mirrors the API's agent accept schema: name min 2, password min 12.
 */
export const agentInviteAcceptSchema = z.object({
  name: z.string().min(2, "Please enter your full name").max(120, "Name is too long"),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

export type AgentInviteAcceptInput = z.infer<typeof agentInviteAcceptSchema>;

/**
 * Partner-agent self-signup (`/agent-signup`). Mirrors the API's
 * `SignupBodySchema`: name min 2/max 120, email, password min 12/max 120.
 * The Turnstile token is not a validated form field — it passes through.
 */
export const agentSignupSchema = z.object({
  name: z.string().min(2, "Please enter your full name").max(120, "Name is too long"),
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(120, "Password is too long"),
});

export type AgentSignupInput = z.infer<typeof agentSignupSchema>;
