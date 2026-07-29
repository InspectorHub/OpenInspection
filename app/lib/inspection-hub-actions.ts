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
): Promise<{ ok: boolean; intent: "person-add"; error: string | undefined; alreadyPresent?: boolean }> {
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
  const result = await toActionResult(res, "person-add", m.inspections_hub_error_person_add());
  if (!result.ok) return result;

  // IA-133 — a 200 here does NOT mean a seat was created. The insert is
  // idempotent, so re-adding someone already on the inspection succeeds and
  // changes nothing. The modal used to close on that, which read as "done" — and
  // its own notice had just told the operator that re-adding reissues a revoked
  // report link. It cannot: report tokens are unique per (inspection, recipient).
  // Surfacing `alreadyPresent` is what lets the modal say so and point at "Reset
  // access link", which is the control that actually restores access.
  const body = (await res.json().catch(() => null)) as { data?: { added?: boolean } } | null;
  return { ...result, alreadyPresent: body?.data?.added === false };
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
 * `person-reset-access` — IA-36 ② "Reset access link". Rotates this recipient's
 * report link IN PLACE; the URL they hold stops working immediately. The new
 * token is deliberately not returned to the browser — it reaches the recipient
 * the same way the first one did, by sending the report.
 */
export async function handlePersonResetAccess(
  api: Api,
  inspectionId: string,
  formData: FormData,
): Promise<{ ok: boolean; intent: "person-reset-access"; error: string | undefined }> {
  const personId = String(formData.get("personId") || "").trim();
  const reset = api.inspections[":id"].people[":personId"]["reset-access"].$post as unknown as
    (args: { param: { id: string; personId: string } }) => Promise<Response>;
  const res = await reset({ param: { id: inspectionId, personId } });
  return toActionResult(res, "person-reset-access", m.inspections_hub_error_person_reset());
}

/** `person-make-primary` — IA-36 ⑫⑬. Moves the primary-client seat. */
export async function handlePersonMakePrimary(
  api: Api,
  inspectionId: string,
  formData: FormData,
): Promise<{ ok: boolean; intent: "person-make-primary"; error: string | undefined }> {
  const personId = String(formData.get("personId") || "").trim();
  const makePrimary = api.inspections[":id"].people[":personId"]["make-primary"].$post as unknown as
    (args: { param: { id: string; personId: string } }) => Promise<Response>;
  const res = await makePrimary({ param: { id: inspectionId, personId } });
  return toActionResult(res, "person-make-primary", m.inspections_hub_error_person_make_primary());
}

/**
 * `report-link-expiry` — IA-36 ⑥⑦. Applies a DURATION to the links this
 * inspection has already issued. Deliberately separate from the company-wide
 * policy, which never reaches back to links already in customers' inboxes.
 */
export async function handleReportLinkExpiry(
  api: Api,
  inspectionId: string,
  formData: FormData,
): Promise<{ ok: boolean; intent: "report-link-expiry"; error: string | undefined }> {
  let ttl: unknown;
  try {
    ttl = JSON.parse(String(formData.get("ttl") ?? '"never"'));
  } catch {
    return { ok: false, intent: "report-link-expiry", error: m.inspections_hub_error_link_expiry() };
  }
  const put = api.inspections[":id"]["report-link-expiry"].$put as unknown as
    (args: { param: { id: string }; json: { ttl: unknown } }) => Promise<Response>;
  const res = await put({ param: { id: inspectionId }, json: { ttl } });
  return toActionResult(res, "report-link-expiry", m.inspections_hub_error_link_expiry());
}

/* ------------------------------------------------------------------ */
/*  IA-65 — signing-request intents                                    */
/* ------------------------------------------------------------------ */

/**
 * `send-agreement` — send this inspection's agreement to one or more parties.
 *
 * Malformed signer JSON is rejected here rather than posted: the endpoint reads
 * an absent list as "no signers given" and falls back to the primary client, so
 * a serialization bug would silently mail the wrong (smaller) set of people
 * while reporting success.
 */
export async function handleSendAgreement(
  api: Api,
  inspectionId: string,
  formData: FormData,
): Promise<{ ok: boolean; intent: "send-agreement"; error: string | undefined }> {
  const agreementId = String(formData.get("agreementId") || "").trim();
  const rawSigners = String(formData.get("signers") || "").trim();
  let signers: Array<{ name: string; email: string; role?: "client" | "co_client" | "agent" | "other" }> = [];
  if (rawSigners) {
    try {
      signers = JSON.parse(rawSigners) as typeof signers;
    } catch {
      return { ok: false, intent: "send-agreement", error: m.inspections_hub_error_send_agreement() };
    }
  }
  const completionPolicy = formData.get("completionPolicy") === "one" ? "one" : "all";
  const res = await api.inspections[":id"]["agreement-requests"].$post({
    param: { id: inspectionId },
    json: {
      ...(agreementId ? { agreementId } : {}),
      ...(signers.length > 0 ? { signers, completionPolicy } : {}),
    },
  });
  return toActionResult(res, "send-agreement", m.inspections_hub_error_send_agreement());
}

/**
 * `inspector-sign` — the envelope-level signature an inspector applies before
 * the client sees the agreement. Moved onto the inspection with the rest of
 * signer management (IA-65); the endpoint admits inspectors, not just admins.
 */
export async function handleInspectorSign(
  api: Api,
  formData: FormData,
): Promise<{ ok: boolean; intent: "inspector-sign"; error: string | undefined }> {
  const envelopeId = String(formData.get("envelopeId") || "").trim();
  const signatureBase64 = String(formData.get("signatureBase64") || "").trim();
  if (!envelopeId || !signatureBase64) {
    return { ok: false, intent: "inspector-sign", error: m.inspections_hub_error_inspector_sign() };
  }
  const res = await api.admin["agreement-requests"][":id"]["inspector-sign"].$post({
    param: { id: envelopeId },
    json: { signatureBase64 },
  });
  return toActionResult(res, "inspector-sign", m.inspections_hub_error_inspector_sign());
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
