import { qboApiFetch, type QboCaller } from "~/lib/qbo-api.server";
import type { LoadContext } from "~/lib/load-context";
import type { QboCheckOutcome, QboCheckedSetting } from "~/lib/qbo-credential-check";

const SETTINGS: readonly QboCheckedSetting[] = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Asks the API to test the credentials it already holds against Intuit.
 *
 * The request has no body on purpose: the server reads the stored or built-in
 * credentials itself, so nothing secret travels from this page. Every outcome
 * is reduced to a small closed set; names the server lists as missing are
 * filtered to the two settings it can name, so no server text is echoed back.
 */
export async function runCredentialCheck(context: LoadContext, caller: QboCaller): Promise<QboCheckOutcome> {
  // `qboApiFetch` hands back the pending request, so a network failure surfaces here, not inside it.
  let res: Response | null;
  try {
    res = await qboApiFetch(context, caller, "/credentials/check", "POST");
  } catch {
    return { kind: "failed" };
  }
  if (!res) return { kind: "failed" };

  const body: unknown = await res.json().catch(() => null);

  if (res.status === 429) return { kind: "rate_limited" };
  if (!res.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    if (error?.code === "rate_limited") return { kind: "rate_limited" };
    if (error?.code === "app_base_url_missing") return { kind: "app_base_url_missing" };
    if (error?.code === "credentials_missing") {
      const named = Array.isArray(error.details) ? error.details : [];
      return { kind: "credentials_missing", missing: SETTINGS.filter((s) => named.includes(s)) };
    }
    return { kind: "failed" };
  }

  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  const result = data?.result;
  const checkedAt = data?.checkedAt;
  if ((result === "paired" || result === "rejected" || result === "unreachable") && typeof checkedAt === "number") {
    return { kind: result, checkedAt };
  }
  return { kind: "failed" };
}
