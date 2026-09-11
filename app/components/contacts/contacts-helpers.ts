/**
 * Shapes the contacts screens share.
 *
 * A `inferMappingFromCsv` used to sit at the top of this file: it matched CSV
 * headers case-insensitively against `name`/`email`/`phone`/`agency` and, when
 * no header matched, took the FIRST column as the name. That last clause is
 * the reason it is gone — it answered the one question the file cannot answer,
 * silently, with no screen on which to correct it. The import wizard asks
 * instead (`/settings/imports?intent=contacts.import`), and the answer travels
 * with a run that can be reviewed and undone.
 */
import type { RoleKind } from "../../../server/lib/people/role-kinds";
import { m } from "~/paraglide/messages";

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  agency: string;
  /** BCP-47 tag the contact asked to be addressed in; null/absent means they
   *  have not said, which is NOT the same as English. */
  locale?: string | null;
  inspectionCount?: number;
  referralCount?: number;
}

/** Mirrors `RoleProfileSchema` (server/lib/validations/role-profile.schema.ts). */
export interface RoleProfile {
  id: string;
  key: string;
  label: string;
  kind: RoleKind;
  emailTemplateId: string | null;
  smsTemplateId: string | null;
  isSystem: boolean;
  sortOrder: number;
  active: boolean;
  /** Raw per-profile capability overrides; resolve with capabilitiesForProfile. */
  capabilityOverrides?: unknown;
}

/** Trimmed view of a message template — just enough for the Select options in RoleProfileModal. */
export interface MessageTemplateOption {
  id: string;
  name: string;
  channel: "email" | "sms";
}

/**
 * What each contact-party kind is CALLED on the contacts screens.
 *
 * A `Record<RoleKind, …>`, and shared rather than per-screen: the Roles table
 * and the role modal render the same three words, and a picker that offered
 * fewer kinds than the schema accepts is the drift this vocabulary was
 * consolidated to remove. Resolved at call time so paraglide's locale scope is
 * the request's, not module-load's.
 */
export const KIND_LABEL: Record<RoleKind, () => string> = {
  client: () => m.contacts_roles_kind_client(),
  agent: () => m.contacts_roles_kind_agent(),
  other: () => m.contacts_roles_kind_other(),
};
