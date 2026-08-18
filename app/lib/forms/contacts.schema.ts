import { z } from "zod";
import { requiredText } from "~/lib/forms/required-text";
// The contact-party axis, DERIVED not re-typed: the select, the DB column and
// the API schema all answer to ROLE_KIND, so a fourth hand-written literal list
// here can only ever drift behind them — and did, rejecting the "other" option
// the modal already rendered. A real value import (not type-only) is safe:
// role-kinds.ts has no imports of its own, so nothing server-only is pulled
// into the browser bundle. Same reasoning as `app/lib/access.ts`.
import { ROLE_KIND } from "../../../server/lib/people/role-kinds";
// i18n — locale-aware validation messages. `m.*()` resolves to the active locale
// via paraglide's ALS (server) / cookie (client), so schemas carrying user-facing
// messages are built by a FACTORY called per validation (never a module-level
// const, which would freeze the message at import time).
import { m } from "~/paraglide/messages";

/**
 * Form schema for the add/edit contact modal (contacts.tsx). Mirrors the field
 * set the form actually collects: type, name, email (optional), phone (optional),
 * agency (optional). Kept as plain zod (no `.openapi()`) so the SAME schema runs
 * in the action (`parseWithZod`) and in the browser via Conform's `onValidate` —
 * one validation source, progressive-enhancement safe.
 *
 * Field set (from the ContactModal form):
 *   - type    — one of ROLE_KIND (client | agent | other), select, defaults to "client"
 *   - name    — required free-text
 *   - email   — optional; empty string coerced to undefined so the API receives null
 *   - phone   — optional free-text (tel input)
 *   - agency  — optional free-text
 *   - locale  — optional; "" is the real "not set" state, kept as-is here and
 *               turned into an explicit null by the action
 */
export function makeAddContactSchema() {
  return z.object({
    type: z.enum(ROLE_KIND).default(ROLE_KIND.CLIENT),
    name: requiredText(m.validation_contact_name_required()).min(1, m.validation_contact_name_required()),
    email: z
      .string()
      .email(m.validation_contact_email_invalid())
      .optional()
      .or(z.literal("").transform(() => undefined)),
    phone: z.string().optional(),
    agency: z.string().optional(),
    // No `.default()`, deliberately: "" and absent both have to survive to the
    // action so it can send an explicit null. A default here would make every
    // save look like a stated preference.
    locale: z.string().optional(),
  });
}
