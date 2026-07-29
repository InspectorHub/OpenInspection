import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/contacts";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { makeAddContactSchema } from "~/lib/forms/contacts.schema";
import { PageHeader, Button, Select } from "@core/shared-ui";
import { inferMappingFromCsv, type Contact } from "~/components/contacts/contacts-helpers";
import { ContactModal } from "~/components/contacts/ContactModal";
import { CsvImportModal } from "~/components/contacts/CsvImportModal";
import { ContactsTable } from "~/components/contacts/ContactsTable";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.contacts_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const filterType = url.searchParams.get("type") || "";
  // IA-120 — a SERVER-side axis, unlike `?type=` below: archived rows are not
  // in the default payload at all, so switching this genuinely needs a refetch.
  const archivedView = url.searchParams.get("archived") === "only";
  const api = createApi(context, { token });

  try {
    // Always fetch the FULL contact list regardless of the URL `?type=`
    // filter: the dropdown narrows it client-side, so a server-side filter
    // would make switching the dropdown a round trip that returns nothing for
    // the other types. `filterType` seeds the dropdown so a deep link still
    // lands where it promised.
    const contactsRes = await api.contacts.index.$get({
      query: archivedView ? { archived: "only" } : {},
    });
    const contactsBody = contactsRes.ok ? ((await contactsRes.json()) as Record<string, unknown>) : { data: [] };
    return { contacts: (contactsBody.data ?? []) as Contact[], filterType, archivedView };
  } catch {
    return { contacts: [] as Contact[], filterType: "", archivedView };
  }
}

/**
 * IA-100 — the archive dialog fetches the contact's live-link count when it
 * opens, rather than the list loading one per row up front. A contacts page
 * with 200 rows would otherwise pay 200 queries to answer a question asked
 * about one of them.
 */
function useLiveAccess(contact: Contact | null) {
  const fetcher = useFetcher<{ access?: unknown[]; archiveRevokesAccess?: boolean }>();
  const id = contact?.id;
  useEffect(() => {
    if (id) fetcher.load(`/resources/contact-access?id=${id}`);
    // fetcher is stable per instance; re-running on it would loop.
  }, [id]);
  return {
    count: id ? (fetcher.data?.access?.length ?? 0) : 0,
    revokesOnArchive: fetcher.data?.archiveRevokesAccess ?? false,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  const api = createApi(context, { token });

  if (intent === "create" || intent === "update") {
    const id = form.get("id") as string | null;
    const submission = parseWithZod(form, { schema: makeAddContactSchema() });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { type, name, email, phone, agency } = submission.value;
    const body = {
      name,
      email: email ?? null,
      phone: phone || null,
      agency: agency || null,
      type,
    };
    const res = id
      ? await api.contacts[":id"].$put({ param: { id }, json: body })
      : await api.contacts.index.$post({ json: body });
    return { ok: res.ok };
  }

  if (intent === "delete") {
    const id = form.get("id") as string;
    const res = await api.contacts[":id"].$delete({ param: { id } });
    return { ok: res.ok };
  }

  if (intent === "restore") {
    const id = form.get("id") as string;
    const restore = api.contacts[":id"].restore.$post as unknown as
      (args: { param: { id: string } }) => Promise<Response>;
    const res = await restore({ param: { id } });
    return { ok: res.ok };
  }

  if (intent === "csv-import") {
    const csvText = form.get("csvText") as string;
    // The preview endpoint surfaces detected columns; the UI currently
    // auto-maps by case-insensitive header name (name/email/phone/agency).
    // Customers picking custom column names can be supported by a future
    // mapping picker — the typed backend already accepts arbitrary mappings.
    const mapping = inferMappingFromCsv(csvText);
    const res = await api.contactsImport.import.$post({ json: { csv: csvText, mapping } });
    // Unwrap the { success, data } envelope — the modal reads the result
    // fields directly (this used to pass the whole envelope, so the done
    // step's count always rendered 0).
    const data = res.ok ? await res.json() : null;
    return { ok: res.ok, result: (data as { data?: unknown } | null)?.data ?? {} };
  }

  if (intent === "csv-preview") {
    const csvText = form.get("csvText") as string;
    // TODO(C-10): hono/client leaf+branch collision — `/import` (endpoint) and
    // `/import/preview` share a prefix, so `.preview` drops off the intersected
    // ClientRequest type. Localized assertion keeps the API_WORKER binding; revisit
    // if the import sub-router is restructured to avoid the prefix collision.
    const importClient = api.contactsImport.import as unknown as {
      preview: { $post: (a: { json: { csv: string } }) => Promise<Response> };
    };
    const res = await importClient.preview.$post({ json: { csv: csvText } });
    const data = res.ok ? await res.json() : null;
    return { ok: res.ok, preview: (data as { data?: unknown } | null)?.data ?? {} };
  }

  // The `role-*` intents moved to routes/settings-inspection-roles.tsx with
  // the table itself (IA-96). They are gone from here rather than kept as
  // dead branches: this route is reachable by any authenticated user, and the
  // new home gates on `requireAdminLoader`.

  return { ok: false };
}

export default function ContactsPage() {
  const { contacts, filterType, archivedView } = useLoaderData<typeof loader>();
  const contactList = contacts as Contact[];
  const [modalOpen, setModalOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [typeFilter, setTypeFilter] = useState(filterType || "");
  const [pendingArchive, setPendingArchive] = useState<Contact | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const archiveFetcher = useFetcher<{ ok?: boolean }>();
  // IA-100 — how many reports this person can still open, fetched only for the
  // contact actually being archived, plus whether this tenant treats archiving
  // as revoking.
  const { count: pendingAccessCount, revokesOnArchive: archiveRevokesAccess } = useLiveAccess(pendingArchive);

  const openEdit = (c: Contact) => { setEditContact(c); setModalOpen(true); };
  const restore = (c: Contact) =>
    archiveFetcher.submit({ intent: "restore", id: c.id }, { method: "post" });
  const confirmArchive = () => {
    if (pendingArchive) {
      archiveFetcher.submit(
        { intent: "delete", id: pendingArchive.id },
        { method: "post" },
      );
      setPendingArchive(null);
    }
  };

  const filtered = typeFilter
    ? contactList.filter((c) => c.type === typeFilter)
    : contactList;

  // IA-96 — the page used to carry three tabs. "Agents" was the same list as
  // "Contacts" narrowed to `type === 'agent'`, which the type dropdown beside
  // it already did — a superset and its own subset presented as peers, with a
  // filter whose scope nobody could guess. "Roles" was not a list of people at
  // all; it moved to Settings → Inspection roles.
  //
  // What is left is one list and one filter. The count follows the filter, so
  // the meta line says what is being shown AND out of how many — otherwise a
  // filtered page just looks like a small address book.
  const totalLabel = m.contacts_list_meta_count({ count: contactList.length });
  const metaLine = typeFilter
    ? `${m.contacts_list_meta_showing({ count: filtered.length })} · ${totalLabel}`
    : totalLabel;

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title={m.contacts_label_contacts()}
        meta={metaLine}
        actions={
          <>
            {/* IA-120 — Active/Archived is a SERVER round trip (archived rows
                are not in the default payload), so it drives the URL rather
                than local state. The type dropdown beside it stays client-side;
                two filters, two mechanisms, because they are two different
                questions. */}
            <div className="w-[120px]">
              <Select
                bare
                aria-label={m.contacts_filter_status_aria()}
                value={archivedView ? "only" : ""}
                onChange={(e) => {
                  const next = new URLSearchParams(searchParams);
                  if (e.target.value === "only") next.set("archived", "only");
                  else next.delete("archived");
                  setSearchParams(next);
                }}
                options={[
                  { value: "", label: m.contacts_filter_status_active() },
                  { value: "only", label: m.contacts_filter_status_archived() },
                ]}
              />
            </div>
            <div className="w-[130px]">
              <Select
                bare
                aria-label={m.contacts_filter_type_aria()}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                options={[
                  { value: "", label: m.contacts_filter_all_types() },
                  { value: "agent", label: m.contacts_label_agents() },
                  { value: "client", label: m.contacts_label_clients() },
                  // IA-96 — `contact_role_profiles.kind` has always had three
                  // values; `contacts.type` had two, so a person added under a
                  // contractor/other role was filed as a Client. The type now
                  // matches the roles that produce it.
                  { value: "other", label: m.contacts_label_other() },
                ]}
              />
            </div>
            <Button variant="secondary" size="sm" onClick={() => setCsvModalOpen(true)}>
              {m.contacts_action_import_csv()}
            </Button>
            <Button variant="primary" onClick={() => { setEditContact(null); setModalOpen(true); }} icon={<PlusIcon />}>
              {m.contacts_action_add()}
            </Button>
          </>
        }
      />

      <ContactsTable
        filtered={filtered}
        onEdit={openEdit}
        onArchive={setPendingArchive}
        onRestore={restore}
        archivedView={archivedView}
      />

      <ContactModal open={modalOpen} onClose={() => setModalOpen(false)} contact={editContact} />
      <CsvImportModal open={csvModalOpen} onClose={() => setCsvModalOpen(false)} />

      {/* IA-100 — say what archiving does and does not withdraw. A report link
          is a per-inspection token that works with no account, so archiving
          the contact does not touch it unless the tenant opted in. Operators
          were reading "archive" as "cut off", which it was not. */}
      <ConfirmDialog
        open={pendingArchive !== null}
        title={m.contacts_archive_title()}
        message={
          pendingAccessCount > 0
            ? `${m.contacts_archive_confirm()} ${
                archiveRevokesAccess
                  ? m.contacts_archive_access_warning_revoking({ count: pendingAccessCount })
                  : m.contacts_archive_access_warning({ count: pendingAccessCount })
              }`
            : m.contacts_archive_confirm()
        }
        confirmLabel={m.contacts_action_archive()}
        tone="default"
        busy={archiveFetcher.state !== "idle"}
        onConfirm={confirmArchive}
        onCancel={() => setPendingArchive(null)}
      />
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}
