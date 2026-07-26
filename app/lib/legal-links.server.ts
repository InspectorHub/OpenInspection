/**
 * Server-side helper for reading operator legal-link config from env.
 * Returns { termsUrl?, privacyUrl? } when at least one URL is set,
 * or null when neither is configured (feature is off).
 */
import { getCloudflareEnv, type LoadContext } from "~/lib/load-context";
import type { WorkerEnv } from "../../workers/env";

export interface LegalLinks {
  termsUrl?: string;
  privacyUrl?: string;
}

export function readLegalLinks(context: LoadContext): LegalLinks | null {
  // TERMS_URL / PRIVACY_URL are optional operator vars, absent from the config
  // typegen reads, so they are named here rather than on the shared WorkerEnv.
  const env = getCloudflareEnv(context) as WorkerEnv & {
    TERMS_URL?: string;
    PRIVACY_URL?: string;
  };
  const termsUrl = env?.TERMS_URL?.trim() || undefined;
  const privacyUrl = env?.PRIVACY_URL?.trim() || undefined;
  if (!termsUrl && !privacyUrl) return null;
  return { termsUrl, privacyUrl };
}
