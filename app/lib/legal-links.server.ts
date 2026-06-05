/**
 * Server-side helper for reading operator legal-link config from env.
 * Returns { termsUrl?, privacyUrl? } when at least one URL is set,
 * or null when neither is configured (feature is off).
 */

export interface LegalLinks {
  termsUrl?: string;
  privacyUrl?: string;
}

export function readLegalLinks(context: unknown): LegalLinks | null {
  // The env shape is not fully typed in the generated worker-configuration.d.ts
  // because TERMS_URL / PRIVACY_URL are optional operator vars; cast via unknown.
  const env = (context as { cloudflare?: { env?: Record<string, string | undefined> } })
    ?.cloudflare?.env;
  const termsUrl = env?.TERMS_URL?.trim() || undefined;
  const privacyUrl = env?.PRIVACY_URL?.trim() || undefined;
  if (!termsUrl && !privacyUrl) return null;
  return { termsUrl, privacyUrl };
}
