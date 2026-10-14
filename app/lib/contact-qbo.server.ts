import { isAdminRole } from "~/lib/access";
import { resolveRole } from "~/lib/access.server";
import type { LoadContext } from "~/lib/load-context";
import { qboApiFetch, qboCaller, type QboCaller } from "~/lib/qbo-api.server";
import { ID_PATTERN, runCustomerMatchIntent, type CustomerMatchActionData } from "~/lib/qbo-customer-match.server";
import type { ContactQboLink } from "~/components/contacts/ContactQboCard";

/** What the contact page knows about QuickBooks: whether to draw the card, and this contact's match. */
export interface ContactQbo {
  connected: boolean;
  link: ContactQboLink;
}

const NO_LINK: ContactQboLink = { linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 };
const NOT_CONNECTED: ContactQbo = { connected: false, link: NO_LINK };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function readLink(body: unknown): ContactQboLink | null {
  const d = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (!d || typeof d.linked !== "boolean" || typeof d.openErrorCount !== "number") return null;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    linked: d.linked,
    qboCustomerId: text(d.qboCustomerId),
    displayName: text(d.displayName),
    openErrorCount: d.openErrorCount,
  };
}

async function isAdmin(context: LoadContext, token: string): Promise<boolean> {
  try {
    return isAdminRole(await resolveRole(context, token));
  } catch {
    return false;
  }
}

/**
 * The QuickBooks state for one contact page.
 *
 * Only an owner or manager is let through: the API refuses everyone else, and a
 * person who can never use the card must not cost two calls per page view.
 * Anything short of a clean answer reads as "not connected" -- this is a side
 * panel, and its failure must never take the contact page down with it.
 */
export async function loadContactQbo(
  context: LoadContext,
  request: Request,
  token: string,
  contactId: string,
): Promise<ContactQbo> {
  try {
    if (!(await isAdmin(context, token))) return NOT_CONNECTED;
    if (!ID_PATTERN.test(contactId)) return NOT_CONNECTED;

    const caller = qboCaller(request, token);
    const [statusRes, linkRes] = await Promise.all([
      qboApiFetch(context, caller, "/status"),
      qboApiFetch(context, caller, `/contacts/${encodeURIComponent(contactId)}/link`),
    ]);
    if (!statusRes?.ok || !linkRes?.ok) return NOT_CONNECTED;

    const status: unknown = await statusRes.json();
    // `/status` answers `data: null` when there is no connection.
    if (!isRecord(status) || !isRecord(status.data)) return NOT_CONNECTED;

    const link = readLink(await linkRes.json());
    return link ? { connected: true, link } : NOT_CONNECTED;
  } catch {
    return NOT_CONNECTED;
  }
}

type UnlinkResult = { ok: true } | { ok: false; reason: "not_connected" | "other" };

interface ContactUnlinkActionData {
  success: boolean;
  intent: "qbo-unlink-customer";
  error: null;
  unlinked: UnlinkResult;
}

export type ContactQboActionData = CustomerMatchActionData | ContactUnlinkActionData;

/**
 * Takes the match off the contact. Nothing is sent to QuickBooks; the answer is
 * reduced to a closed set so no server text reaches the page. A match that is
 * already gone counts as done: the outcome the person asked for is the same.
 */
async function unlinkContact(context: LoadContext, caller: QboCaller, contactId: string): Promise<UnlinkResult> {
  if (!ID_PATTERN.test(contactId)) return { ok: false, reason: "other" };
  const res = await qboApiFetch(context, caller, `/contacts/${encodeURIComponent(contactId)}/link`, "DELETE");
  if (!res) return { ok: false, reason: "other" };
  if (res.ok) return { ok: true };

  const body: unknown = await res.json().catch(() => null);
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const details = isRecord(error?.details) ? error.details : null;
  return { ok: false, reason: details?.reason === "qbo_not_connected" ? "not_connected" : "other" };
}

/**
 * The contact page's three QuickBooks intents, kept out of the route module
 * (which has a size ceiling). Returns null for any other intent so the route
 * carries on.
 *
 * The contact is always the one in the URL: a form field naming a different id
 * is overwritten for matching and never read for removing.
 */
export async function runContactQboIntent(
  context: LoadContext,
  request: Request,
  token: string,
  contactId: string,
  intent: FormDataEntryValue | null,
  fd: FormData,
): Promise<ContactQboActionData | null> {
  const mine = intent === "qbo-unlink-customer" || intent === "qbo-search-customers" || intent === "qbo-link-customer";
  if (!mine) return null;
  // The API refuses anyone else too; this keeps a non-admin's post from reaching it at all.
  if (!(await isAdmin(context, token))) {
    if (intent === "qbo-unlink-customer") {
      return { success: false, intent, error: null, unlinked: { ok: false, reason: "other" } };
    }
    return intent === "qbo-search-customers"
      ? { success: false, intent, error: null, syncEnabled: undefined, search: { ok: false, error: "other" } }
      : { success: false, intent: "qbo-link-customer", error: null, syncEnabled: undefined, linked: { ok: false, reason: "other" } };
  }
  const caller = qboCaller(request, token);
  if (intent === "qbo-unlink-customer") {
    const unlinked = await unlinkContact(context, caller, contactId);
    return { success: unlinked.ok, intent, error: null, unlinked };
  }
  if (intent === "qbo-search-customers" || intent === "qbo-link-customer") {
    const own = new FormData();
    for (const [key, value] of fd.entries()) own.append(key, value);
    own.set("contactId", contactId);
    return runCustomerMatchIntent(context, caller, intent, own);
  }
  return null;
}
