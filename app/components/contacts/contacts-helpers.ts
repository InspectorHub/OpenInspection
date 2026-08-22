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
  kind: "client" | "agent" | "other";
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
