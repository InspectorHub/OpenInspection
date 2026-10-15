import { m } from "~/paraglide/messages";

/**
 * What to tell a person when the server refuses a source choice. The server's
 * answer carries a short code; the words are ours, in the person's language.
 */
export async function sourceChangeError(res: { json: () => Promise<unknown> }): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  switch (body?.error?.code) {
    case "own_credentials_incomplete":
      return m.integrations_delivery_error_own_incomplete();
    case "not_offered":
      return m.integrations_delivery_error_not_offered();
    default:
      return m.integrations_delivery_error_generic();
  }
}
