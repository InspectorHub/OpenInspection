export type EmailByoProvider = "resend" | "sendgrid" | "postmark" | "mailgun";

/** The masked-secret values the Settings loader receives. The secrets GET
 *  returns masked strings where "" means not-configured, so a non-empty value
 *  is a reliable "is set" signal per key. */
export interface EmailProviderSecrets {
  RESEND_API_KEY: string;
  SENDGRID_API_KEY: string;
  POSTMARK_SERVER_TOKEN: string;
  MAILGUN_API_KEY: string;
  MAILGUN_DOMAIN: string;
}

/**
 * Whether the tenant's OWN selected email provider has its credentials saved.
 * Mirrors the server-side own-path creds check in `assembleTenantEmailService`
 * (Mailgun needs BOTH key and domain). Drives the Email delivery panel's
 * provider-aware guardrail + status copy.
 */
export function ownEmailProviderConfigured(
  provider: EmailByoProvider,
  secrets: EmailProviderSecrets,
): boolean {
  switch (provider) {
    case "sendgrid": return secrets.SENDGRID_API_KEY !== "";
    case "postmark": return secrets.POSTMARK_SERVER_TOKEN !== "";
    case "mailgun":  return secrets.MAILGUN_API_KEY !== "" && secrets.MAILGUN_DOMAIN !== "";
    default:         return secrets.RESEND_API_KEY !== ""; // resend
  }
}
