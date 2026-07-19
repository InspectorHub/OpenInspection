/* ------------------------------------------------------------------ */
/*  Inspection-hub action helpers (pure — no React)                   */
/* ------------------------------------------------------------------ */

import type { Api } from "~/lib/api-client.server";
import type { ContactSearchResult } from "~/components/inspection/AddPersonModal";
import { m } from "~/paraglide/messages";

/**
 * Map an API `Response` to the inspection-hub action's standard result shape,
 * parameterized by the intent literal. On a non-OK response it surfaces the
 * API's `error.message` (B-4: never unconditional ok:true), falling back to the
 * caller-supplied default. On success it returns `{ ok: true, intent }`.
 *
 * Behavior-preserving extraction of the repeated post→error-shape pattern in the
 * route's `action()` (send-agreement / request-payment / attest-sms / publish /
 * submit / return / unpublish). The create-reinspection branch carries an extra
 * `newId` field + pre-validation and stays inline.
 */
export async function toActionResult<I extends string>(
  res: { ok: boolean; json: () => Promise<unknown> },
  intent: I,
  fallbackError: string,
): Promise<{ ok: boolean; intent: I; error: string | undefined }> {
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return {
      ok: false,
      intent,
      error: err?.error?.message ?? fallbackError,
    };
  }
  return { ok: true, intent, error: undefined };
}

/* ------------------------------------------------------------------ */
/*  Plan 1B Task 5 — People editor action intents                     */
/* ------------------------------------------------------------------ */

/**
 * `person-add` — add a contact to the inspection under a role profile.
 * Either an existing `contactId` is posted (typeahead selection), or the
 * "create inline" fields are posted with no contactId — in that case the
 * contact is created first (POST /api/contacts), then linked, so
 * AddPersonModal only ever needs one fetcher submission.
 */
export async function handlePersonAdd(
  api: Api,
  inspectionId: string,
  formData: FormData,
): Promise<{ ok: boolean; intent: "person-add"; error: string | undefined }> {
  const roleProfileId = String(formData.get("roleProfileId") || "").trim();
  if (!roleProfileId) {
    return { ok: false, intent: "person-add", error: m.inspections_hub_error_person_add_role_required() };
  }

  let contactId = String(formData.get("contactId") || "").trim();
  if (!contactId) {
    const newName = String(formData.get("newContactName") || "").trim();
    if (!newName) {
      return { ok: false, intent: "person-add", error: m.inspections_hub_error_person_add_name_required() };
    }
    const newEmail = String(formData.get("newContactEmail") || "").trim();
    const newPhone = String(formData.get("newContactPhone") || "").trim();
    const newAgency = String(formData.get("newContactAgency") || "").trim();
    const newContactType = String(formData.get("newContactType") || "client") === "agent" ? "agent" : "client";
    const createRes = await api.contacts.index.$post({
      json: {
        type: newContactType,
        name: newName,
        ...(newEmail ? { email: newEmail } : {}),
        ...(newPhone ? { phone: newPhone } : {}),
        ...(newAgency ? { agency: newAgency } : {}),
      },
    });
    if (!createRes.ok) {
      const err = (await createRes.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, intent: "person-add", error: err?.error?.message ?? m.inspections_hub_error_person_add() };
    }
    const createdBody = (await createRes.json()) as { data?: { contact?: { id?: string } } };
    contactId = createdBody.data?.contact?.id ?? "";
    if (!contactId) {
      return { ok: false, intent: "person-add", error: m.inspections_hub_error_person_add() };
    }
  }

  const res = await api.inspections[":id"].people.$post({
    param: { id: inspectionId },
    json: { contactId, roleProfileId },
  });
  return toActionResult(res, "person-add", m.inspections_hub_error_person_add());
}

/** `person-remove` — deletes an inspection_people row. */
export async function handlePersonRemove(
  api: Api,
  inspectionId: string,
  formData: FormData,
): Promise<{ ok: boolean; intent: "person-remove"; error: string | undefined }> {
  const personId = String(formData.get("personId") || "").trim();
  const res = await api.inspections[":id"].people[":personId"].$delete({
    param: { id: inspectionId, personId },
  });
  return toActionResult(res, "person-remove", m.inspections_hub_error_person_remove());
}

/**
 * `search-contacts` — AddPersonModal's contact typeahead, mirroring
 * "search-agents" in inspections.tsx (BFF pattern: no client-side fetch).
 */
export async function handleSearchContacts(
  api: Api,
  formData: FormData,
): Promise<{ intent: "search-contacts"; contacts: ContactSearchResult[] }> {
  const search = String(formData.get("search") || "").trim();
  if (search.length < 2) {
    return { intent: "search-contacts", contacts: [] };
  }
  const res = await api.contacts.index.$get({ query: { search, limit: "8" } }).catch(() => null);
  if (res && res.ok) {
    const body = (await res.json().catch(() => ({ data: [] }))) as {
      data?: Array<{ id: string; name: string; email: string | null; phone: string | null; agency: string | null }>;
    };
    return {
      intent: "search-contacts",
      contacts: (body.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        agency: c.agency,
      })),
    };
  }
  return { intent: "search-contacts", contacts: [] };
}
