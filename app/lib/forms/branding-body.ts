import type { z } from "zod";
import type { makeWorkspaceSchema } from "~/lib/forms/settings.schema";
import { parseQuickPhraseLines } from "~/lib/repair-quick-phrases";

type WorkspaceFormValues = z.output<ReturnType<typeof makeWorkspaceSchema>>;

/**
 * Company settings form values → the `POST /api/admin/branding` request body.
 *
 * Pure, so the rules that decide whether a key is SENT AT ALL are readable in
 * one place and testable without a router. Three different rules live here and
 * they are easy to confuse:
 *
 *  - Text fields are sent when the form carried them; an empty string is a
 *    real value that CLEARS the stored one (`companyAddress`).
 *  - Checkboxes are conform-native (a checked box submits `"on"`, an unchecked
 *    one submits nothing), so `undefined` means "off" and must be sent as an
 *    explicit `false` — otherwise unchecking never persists.
 *  - Preference fields (timezone / locale / currency / date + time format) are
 *    sent ONLY when non-empty: an absent key must leave the stored preference
 *    alone, which is why the API schema carries no `.default()` for them
 *    (see #270). Sending `""` there would silently overwrite a real choice.
 */
export function brandingUpdateBody(v: WorkspaceFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (v.companyName !== undefined) body.companyName = v.companyName;
  // Cleared back to blank must store NULL, not "": NULL is the honest "same as
  // the company name" the getBrand fallback is keyed on, and a stored empty
  // string would read as a legal entity with no name.
  if (v.legalName !== undefined) body.legalName = v.legalName.trim() || null;
  if (v.primaryColor !== undefined) body.primaryColor = v.primaryColor;
  if (v.defaultProfileId !== undefined) body.defaultProfileId = v.defaultProfileId;

  // Custom referral sources: one label per line
  if (typeof v.customReferralSources === "string") {
    body.customReferralSources = v.customReferralSources
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // #275 — repair-note quick phrases: one per line, order preserved (line order
  // IS button order). Keyed off the panel's hidden sentinel, NOT off the
  // textarea's own value: an empty textarea arrives as `undefined`, exactly like
  // a form that never rendered the panel, and those two must do opposite things
  // — clear the list ([]) versus leave it alone (key absent). This is the
  // off switch; `[]` means "show no quick buttons" while a missing key means
  // "never configured", and the API keeps them apart all the way to the column.
  if (v.repairQuickPhrasesPresent) {
    body.repairQuickPhrases = parseQuickPhraseLines(v.repairQuickPhrases ?? "");
  }

  // Boolean feature flags — conform-native checkboxes coerce to boolean in
  // submission.value (checked → true, absent → undefined). Always send an explicit
  // boolean so unchecking persists false.
  body.enableRepairList = v.enableRepairList ?? false;
  body.enableCustomerRepairExport = v.enableCustomerRepairExport ?? false;

  // Report PDF settings. companyAddress is free text (trim; empty string clears).
  // The three toggles are conform-native checkboxes — absent (unchecked) must
  // persist false, so coerce with `?? false` (the same pattern as the flags above).
  if (typeof v.companyAddress === "string") body.companyAddress = v.companyAddress.trim();
  body.pdfShowFooter = v.pdfShowFooter ?? false;
  body.pdfShowPageNumbers = v.pdfShowPageNumbers ?? false;
  body.pdfShowLicense = v.pdfShowLicense ?? false;

  // Tenant display timezone (IANA). Only sent when a value is present.
  if (typeof v.defaultTimezone === "string" && v.defaultTimezone) body.defaultTimezone = v.defaultTimezone;
  // Tenant display locale (BCP-47) + currency (ISO 4217). Only sent when present.
  if (typeof v.defaultLocale === "string" && v.defaultLocale) body.defaultLocale = v.defaultLocale;
  if (typeof v.currency === "string" && v.currency) body.currency = v.currency;
  // #270 — an absent key must leave the stored preference alone (which is why
  // the API schema carries no `.default()` for these).
  if (typeof v.dateFormat === "string" && v.dateFormat) body.dateFormat = v.dateFormat;
  if (typeof v.timeFormat === "string" && v.timeFormat) body.timeFormat = v.timeFormat;

  return body;
}
