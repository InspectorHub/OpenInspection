import { z } from "zod";
import { requiredText } from "~/lib/forms/required-text";
// i18n — locale-aware validation messages, built by a FACTORY (never a
// module-level const) so the active locale is resolved per validation call,
// mirroring app/lib/forms/contacts.schema.ts.
import { m } from "~/paraglide/messages";

/**
 * Form schema for RoleProfileModal (contacts.tsx Roles tab), shared by both
 * the create and edit paths — mirrors ContactModal's single-schema approach.
 * `kind` is optional here because the edit path disables that Select (kind is
 * immutable after creation — see UpdateRoleProfileSchema in
 * server/lib/validations/role-profile.schema.ts, which doesn't accept it at
 * all); a disabled <select> never appears in the submitted FormData, so
 * requiring it would fail edit submissions for no reason. The create path's
 * Select always has a real value (defaultValue "client"), so this stays safe
 * in practice — the server is the authoritative validator either way.
 */
export function makeRoleProfileSchema() {
  return z.object({
    label: requiredText(m.validation_role_label_required()).trim().min(1, m.validation_role_label_required()).max(80),
    kind: z.enum(["client", "agent", "other"]).optional(),
    emailTemplateId: z.string().optional(),
    smsTemplateId: z.string().optional(),
    // Capability controls (checkboxes submit "on"; absent means unchecked).
    // Mirrors CapabilityOverridesSchema server-side — the server remains the
    // authoritative validator; these exist so the fields are declared, not to
    // gate submission.
    cap_receivesReport: z.string().optional(),
    cap_selfRetrieveReport: z.string().optional(),
    cap_canHaveAccount: z.string().optional(),
    cap_showsInAgentPortal: z.string().optional(),
    cap_canAccessRepairList: z.enum(["off", "read", "readwrite"]).optional(),
  });
}
