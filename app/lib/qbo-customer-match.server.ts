import { qboApiFetch, type QboCaller } from "~/lib/qbo-api.server";
import type { LoadContext } from "~/lib/load-context";
import type {
  CustomerLinkResult,
  CustomerSearchFailure,
  CustomerSearchRow,
} from "~/components/settings/QboCustomerLinkDialog";

/**
 * What an id must look like before it is placed in a request path. Contact ids
 * and QuickBooks customer ids are short opaque tokens; anything else is refused
 * here, before a URL is built, rather than trusting the encoder alone.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Same bounds as the API's own query schema: 2 to 100 characters, no control characters. */
function validSearchText(q: string): boolean {
  return q.length >= 2 && q.length <= 100 && ![...q].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
}

type CustomerSearchOutcome =
  | { ok: true; customers: CustomerSearchRow[] }
  | { ok: false; error: CustomerSearchFailure };

/**
 * One search of the company's QuickBooks customers. Every outcome is reduced to
 * a small closed set: the API's body is read for its error code and nothing of
 * it is passed on, so no QuickBooks text reaches the page.
 */
async function searchQboCustomers(
  context: LoadContext,
  caller: QboCaller,
  rawQuery: string,
): Promise<CustomerSearchOutcome> {
  const q = rawQuery.trim();
  if (!validSearchText(q)) return { ok: false, error: "other" };

  const res = await qboApiFetch(context, caller, `/customers?q=${encodeURIComponent(q)}`);
  if (!res) return { ok: false, error: "other" };

  const body: unknown = await res.json().catch(() => null);
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (!res.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    if (error?.code === "rate_limited") return { ok: false, error: "rate_limited" };
    const details = isRecord(error?.details) ? error.details : null;
    return { ok: false, error: details?.reason === "qbo_not_connected" ? "not_connected" : "other" };
  }

  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (!data || !Array.isArray(data.customers)) return { ok: false, error: "other" };

  const customers: CustomerSearchRow[] = [];
  for (const raw of data.customers) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    if (!id) continue;
    customers.push({
      id,
      displayName: str(raw.displayName) ?? "",
      companyName: str(raw.companyName),
      email: str(raw.email),
      linkedContactId: str(raw.linkedContactId),
      linkedContactName: str(raw.linkedContactName),
    });
  }
  return { ok: true, customers };
}

/** Matches one contact to one QuickBooks customer and says how it went, in words the dialog owns. */
async function linkQboCustomer(
  context: LoadContext,
  caller: QboCaller,
  contactId: string,
  qboCustomerId: string,
): Promise<CustomerLinkResult> {
  if (!ID_PATTERN.test(contactId) || !ID_PATTERN.test(qboCustomerId)) return { ok: false, reason: "other" };

  const res = await qboApiFetch(
    context, caller, `/contacts/${encodeURIComponent(contactId)}/link`, "POST", { qboCustomerId },
  );
  if (!res) return { ok: false, reason: "other" };

  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const data = isRecord(body) && isRecord(body.data) ? body.data : null;
    return { ok: true, displayName: str(data?.displayName) ?? "" };
  }

  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const details = isRecord(error?.details) ? error.details : null;
  switch (details?.reason) {
    case "qbo_customer_taken": {
      const holderName = str(details.holderName);
      return {
        ok: false,
        reason: "taken",
        ...(holderName ? { holderName } : {}),
        ...(details.holderArchived === true ? { holderArchived: true } : {}),
      };
    }
    case "qbo_customer_inactive": return { ok: false, reason: "inactive" };
    case "qbo_not_connected": return { ok: false, reason: "not_connected" };
    default: return { ok: false, reason: "other" };
  }
}

/** What the route's action answers for the two matching intents. */
export interface CustomerMatchActionData {
  success: boolean;
  intent: "qbo-search-customers" | "qbo-link-customer";
  error: null;
  syncEnabled: undefined;
  search?: CustomerSearchOutcome;
  linked?: CustomerLinkResult;
}

/**
 * The route's two matching intents, kept out of the route module (which has a
 * size ceiling). Returns null for any other intent so the route carries on.
 */
export async function runCustomerMatchIntent(
  context: LoadContext,
  caller: QboCaller,
  intent: string | null,
  fd: FormData,
): Promise<CustomerMatchActionData | null> {
  const field = (name: string) => String(fd.get(name) ?? "");
  if (intent === "qbo-search-customers") {
    const search = await searchQboCustomers(context, caller, field("q"));
    return { success: search.ok, intent, error: null, syncEnabled: undefined, search };
  }
  if (intent === "qbo-link-customer") {
    const linked = await linkQboCustomer(context, caller, field("contactId"), field("qboCustomerId"));
    return { success: linked.ok, intent, error: null, syncEnabled: undefined, linked };
  }
  return null;
}
