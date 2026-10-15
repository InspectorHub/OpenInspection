/**
 * What the QuickBooks settings loader derives from raw inputs, kept out of the
 * route so the route stays under the file-size ceiling and each rule can be
 * tested without standing up a loader.
 *
 * Everything here returns words, booleans or addresses. No credential value
 * ever leaves this file: the inputs are origins ("env" / "tenant" / "missing")
 * and the masked strings the secrets API already returns.
 */
import { describeCredentialSource } from "../../server/services/qbo/credential-source";
import { qboEnvironmentName } from "../../server/services/qbo/api-base";
import { qboRegistrationUrls } from "../../server/lib/qbo-oauth-paths";
import type { QBOCredentialSource } from "../../server/services/qbo/api-base";

export type QboEnvironment = "sandbox" | "production";

/** The four settings as the secrets API returns them: masked, "" when unset. */
export interface QboMaskedSettings {
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_WEBHOOK_SECRET: string;
  QBO_ENV: string;
}

/**
 * The environment a MASKED stored `QBO_ENV` stands for.
 *
 * `maskSecret` keeps the first and last four characters of anything longer than
 * eight and replaces the whole value otherwise. Only two values pass the
 * format gate on write: "sandbox" (seven characters, fully masked) and
 * "production" (ten, so it starts "prod"). That is enough to tell them apart
 * without ever receiving the value. `app/lib/qbo-settings-loader.test.ts`
 * asserts this against the real masker, so a change to the mask fails there.
 */
export function environmentFromMask(masked: string): QboEnvironment | null {
  if (!masked) return null;
  return masked.startsWith("prod") ? "production" : "sandbox";
}

/**
 * The environment to show when there may be no connection to ask.
 *
 * Connection first (it already applied the env-wins rule), then the Worker
 * env, then the company's stored value. Never a default: an unset environment
 * is a state the page has to be able to show.
 */
export function resolveQboEnvironment(input: {
  connected: QboEnvironment | null | undefined;
  envValue: string | undefined;
  masked: string;
}): QboEnvironment | null {
  if (input.connected) return input.connected;
  const fromEnv = qboEnvironmentName(input.envValue);
  if (fromEnv) return fromEnv;
  return environmentFromMask(input.masked);
}

/**
 * Where each setting comes from when `/status` has nothing to say (it answers
 * `null` until a company is connected). Same rule the connected answer uses:
 * the Worker env wins, a stored value is the fallback, otherwise missing.
 */
export function deriveUnconnectedCredentialSource(
  envValues: Partial<Record<keyof QboMaskedSettings, string | undefined>>,
  stored: QboMaskedSettings,
): QBOCredentialSource {
  const keys = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_WEBHOOK_SECRET", "QBO_ENV"] as const;
  const merged: Partial<Record<keyof QboMaskedSettings, string>> = {};
  const filledFromTenant: string[] = [];
  for (const key of keys) {
    const fromEnv = envValues[key];
    if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
      merged[key] = fromEnv;
    } else if (stored[key]) {
      merged[key] = stored[key];
      filledFromTenant.push(key);
    }
  }
  return describeCredentialSource(merged, filledFromTenant);
}

export interface QboRegistration {
  redirectUri: string;
  disconnectUrl: string;
  webhookUrl: string;
  /** Intuit only accepts https addresses. */
  secure: boolean;
}

/** The addresses to register with Intuit, or null when no public origin is set. */
export function buildRegistration(appBaseUrl: string | undefined): QboRegistration | null {
  if (!appBaseUrl) return null;
  return { ...qboRegistrationUrls(appBaseUrl), secure: appBaseUrl.startsWith("https://") };
}

/**
 * Whether the API let this caller in. The management routes answer 403 to
 * anyone who is not an owner or manager (and 401 to a caller with no role), so
 * a refusal is the server's own verdict on the role. Reading it that way keeps
 * the page from inventing a second, drifting copy of the role rule.
 */
export function qboAccessFrom(res: Response | null): "ok" | "forbidden" {
  return res && (res.status === 401 || res.status === 403) ? "forbidden" : "ok";
}
