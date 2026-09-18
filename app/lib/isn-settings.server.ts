/**
 * The ISN panel's load and save, kept out of settings-advanced.tsx so the
 * route stays a list of panels. Credentials go to the encrypted secrets store
 * (PUT /api/secrets).
 */
import type { Api } from "./api-client.server";
import { ISN_SECRET_KEYS, type IsnSecrets } from "~/components/settings/advanced/IsnPanel";
import { m } from "~/paraglide/messages";

export function loadIsnSettings(secrets: Record<string, string>): IsnSecrets {
  return Object.fromEntries(ISN_SECRET_KEYS.map((k) => [k, secrets[k] || ""])) as IsnSecrets;
}

export async function saveIsnSettings(api: Api, fd: FormData) {
  const intent = "save-isn";
  const fail = (error: string, field: string | null = null) => ({ intent, success: false, error, field, test: null });
  const secrets: Record<string, string> = {};
  for (const key of ISN_SECRET_KEYS) {
    const val = fd.get(key);
    if (typeof val === "string" && val.trim()) secrets[key] = val;
  }
  if (Object.keys(secrets).length > 0) {
    const res = await api.secrets.secrets.$put({ json: secrets });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string; field?: string } } | null;
      return fail(err?.error?.message ?? m.settings_isn_save_error(), err?.error?.field ?? null);
    }
  }
  return { intent, success: true, error: null, field: null, test: null };
}
