import { z } from "zod";
// i18n Phase C (auth pilot) — locale-aware validation messages. `m.*()` resolves
// to the active locale via paraglide's ALS (server) / cookie (client), so schemas
// carrying user-facing messages are built by a FACTORY called per validation
// (never a module-level const, which would freeze the message at import time).
import { m } from "~/paraglide/messages";

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
export function makeLoginSchema() {
  return z.object({
    email: z
      .string()
      .min(1, m.auth_validation_email_required())
      .email(m.auth_validation_email_invalid()),
    password: z.string().min(1, m.auth_validation_password_required()),
  });
}

/**
 * Shared strong-password rule, mirroring the API's `passwordSchema`
 * (server/lib/validations/shared.schema.ts): min 8 chars with at least one
 * uppercase letter, one digit, and one special character. Built by a FACTORY
 * (not a module const) so its user-facing messages resolve per validation
 * against the active locale (paraglide ALS/cookie) instead of freezing at
 * import time.
 */
function makeStrongPassword() {
  return z
    .string()
    .min(8, m.auth_validation_password_min8())
    .regex(/[A-Z]/, m.auth_validation_password_uppercase())
    .regex(/[0-9]/, m.auth_validation_password_number())
    .regex(/[^A-Za-z0-9]/, m.auth_validation_password_special());
}

/**
 * Setup (first-run) — mirrors the API's `SetupSchema`. The form field names
 * (`workspaceName` → companyName, `adminName`, `setupCode` → verificationCode)
 * are preserved; the action maps them to the API body. `setupCode` is required
 * by the form (min 6), matching the operator-provisioned SETUP_CODE.
 */
export function makeSetupSchema() {
  return z.object({
    workspaceName: z.string().min(2, m.auth_validation_workspace_name_required()),
    adminName: z
      .string()
      .min(2, m.auth_validation_your_name_required())
      .max(120, m.auth_validation_name_too_long()),
    email: z
      .string()
      .min(1, m.auth_validation_email_required())
      .email(m.auth_validation_email_invalid()),
    password: makeStrongPassword(),
    setupCode: z.string().min(6, m.auth_validation_setup_code_min()),
  });
}

/**
 * Human-readable strong-password requirement, shown next to password inputs on
 * the reset and join pages. A factory (not a const) so the copy tracks the
 * active locale; stays in sync with `makeStrongPassword()` above.
 */
export function makePasswordHint() {
  return m.auth_password_hint();
}

/**
 * Forgot-password request (`/forgot-password`). Only the email is user-entered;
 * the backend answers 200 unconditionally (anti-enumeration).
 */
export function makeForgotPasswordSchema() {
  return z.object({
    email: z
      .string()
      .min(1, m.auth_validation_email_required())
      .email(m.auth_validation_email_invalid()),
  });
}

/**
 * Reset-password submit (`/reset-password`). The token rides as a hidden field
 * (sourced from the URL via the loader), NOT a schema field — the schema only
 * validates the new password. Field name is `newPassword`, matching the API's
 * `ResetPasswordSchema` (server/lib/validations/auth.schema.ts).
 */
export function makeResetPasswordSchema() {
  return z.object({
    newPassword: makeStrongPassword(),
  });
}

/**
 * Team-invite accept (`/join`). Token comes from the URL, NOT the form — the
 * schema only validates the user-entered name + password. Mirrors the API's
 * `JoinTeamSchema` password strength.
 */
export function makeJoinSchema() {
  return z.object({
    name: z
      .string()
      .min(1, m.auth_validation_name_required())
      .max(120, m.auth_validation_name_too_long()),
    password: makeStrongPassword(),
  });
}

/**
 * Partner-agent invite accept (`/agent-invite/accept`). Token + email come from
 * the invite (email is read-only), so only name + password are validated.
 * Mirrors the API's agent accept schema: name min 2, password min 12.
 */
export function makeAgentInviteAcceptSchema() {
  return z.object({
    name: z
      .string()
      .min(2, m.auth_validation_full_name_required())
      .max(120, m.auth_validation_name_too_long()),
    password: z.string().min(12, m.auth_validation_password_min12()),
  });
}

/**
 * Partner-agent self-signup (`/agent-signup`). Mirrors the API's
 * `SignupBodySchema`: name min 2/max 120, email, password min 12/max 120.
 * The Turnstile token is not a validated form field — it passes through.
 */
export function makeAgentSignupSchema() {
  return z.object({
    name: z
      .string()
      .min(2, m.auth_validation_full_name_required())
      .max(120, m.auth_validation_name_too_long()),
    email: z
      .string()
      .min(1, m.auth_validation_email_required())
      .email(m.auth_validation_email_invalid()),
    password: z
      .string()
      .min(12, m.auth_validation_password_min12())
      .max(120, m.auth_validation_password_too_long()),
  });
}

/**
 * Task 5 — core agent password login (`/agent-login`, primary form). Mirrors
 * the API's `AgentLoginSchema` (server/lib/validations/agent-login.schema.ts):
 * email + password min(1) — this authenticates an EXISTING account, so no
 * strength rule applies here (unlike signup's makeAgentSignupSchema).
 */
export function makeAgentLoginSchema() {
  return z.object({
    email: z
      .string()
      .min(1, m.auth_validation_email_required())
      .email(m.auth_validation_email_invalid()),
    password: z.string().min(1, m.auth_validation_password_required()),
  });
}

/**
 * Task 5 — core agent login's magic-link fallback form (`/agent-login`,
 * secondary form). Mirrors the API's `AgentLoginLinkSchema`: email only.
 */
export function makeAgentLoginLinkSchema() {
  return z.object({
    email: z
      .string()
      .min(1, m.auth_validation_email_required())
      .email(m.auth_validation_email_invalid()),
  });
}
