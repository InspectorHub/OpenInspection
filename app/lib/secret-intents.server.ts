import type { createApi } from "~/lib/api-client.server";

type Api = ReturnType<typeof createApi>;

/** The uniform result of a "paste keys" action, so a page can read any of them the same way. */
type SecretActionResult = {
  intent: string;
  ok: boolean;
  error: string | null;
  field: string | null;
  test: null;
};

/**
 * The non-empty, trimmed values for the named fields. An empty field means
 * "leave it as it is", so it is left out of the body entirely.
 */
export function pickSecretFields(form: FormData, keys: readonly string[]): Record<string, string> {
  const body: Record<string, string> = {};
  for (const key of keys) {
    const v = form.get(key);
    if (v && typeof v === "string" && v.trim()) body[key] = v.trim();
  }
  return body;
}

/**
 * Shared persistence for the "paste API keys" intents: PUT the (already
 * filtered) secret body, then return the uniform action-result shape. An empty
 * body is a no-op success: the person submitted the form without changing keys.
 */
export async function saveSecrets(
  api: Api,
  intent: string,
  body: Record<string, string>,
  fallbackError: string,
): Promise<SecretActionResult> {
  if (Object.keys(body).length === 0) {
    return { intent, ok: true, error: null, field: null, test: null };
  }
  const res = await api.secrets.secrets.$put({ json: body });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as
      | { error?: { message?: string; field?: string } }
      | null;
    return {
      intent,
      ok: false,
      error: errBody?.error?.message ?? fallbackError,
      field: errBody?.error?.field ?? null,
      test: null,
    };
  }
  return { intent, ok: true, error: null, field: null, test: null };
}
