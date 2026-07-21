import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/contacts";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { makeAddContactSchema } from "~/lib/forms/contacts.schema";
import { PageHeader, TabStrip, Button, Select } from "@core/shared-ui";
import { inferMappingFromCsv, type Contact, type RoleProfile, type MessageTemplateOption } from "~/components/contacts/contacts-helpers";
import { ContactModal } from "~/components/contacts/ContactModal";
import { CsvImportModal } from "~/components/contacts/CsvImportModal";
import { ContactsTable } from "~/components/contacts/ContactsTable";
import { AgentsTable } from "~/components/contacts/AgentsTable";
import { RolesTable } from "~/components/contacts/RolesTable";
import { RoleProfileModal } from "~/components/contacts/RoleProfileModal";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { isAdminRole } from "~/lib/access";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.contacts_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const filterType = url.searchParams.get("type") || "";
  const api = createApi(context, { token });

  // Resolve the session role to gate the admin-only Roles tab — mirrors the
  // loader-side pattern in settings-connected-apps.tsx (fail-closed on error:
  // an unresolved role never shows the admin surface).
  let role: string | null | undefined;
  try {
    const ctxRes = await api.sessionContext.context.$get();
    if (ctxRes.ok) {
      const body = (await ctxRes.json()) as { data?: { user?: { role?: string } } };
      role = body.data?.user?.role;
    }
  } catch {
    role = undefined;
  }
  const isAdmin = isAdminRole(role);

  try {
    const [contactsRes, rolesRes, emailTemplatesRes, smsTemplatesRes] = await Promise.all([
      // Always fetch the full contact list, regardless of the URL `?type=`
      // filter. Both tabs filter locally — the Contacts tab by the `typeFilter`
      // state (seeded from `?type=`) and the Agents tab by `type === 'agent'`.
      // Filtering server-side would starve the Agents tab on a `?type=client`
      // deep-link (it would receive zero agents). `filterType` still seeds the
      // dropdown below so the deep-link intent is preserved for the Contacts tab.
      api.contacts.index.$get({ query: {} }),
      api.roleProfiles.index.$get(),
      api.messageTemplates.index.$get({ query: { channel: "email" } }).catch(() => null),
      api.messageTemplates.index.$get({ query: { channel: "sms" } }).catch(() => null),
    ]);
    const contactsBody = contactsRes.ok ? ((await contactsRes.json()) as Record<string, unknown>) : { data: [] };
    const rolesBody = rolesRes.ok ? ((await rolesRes.json()) as Record<string, unknown>) : { data: [] };
    const emailTemplatesBody =
      emailTemplatesRes && emailTemplatesRes.ok ? ((await emailTemplatesRes.json()) as { data?: MessageTemplateOption[] }) : { data: [] };
    const smsTemplatesBody =
      smsTemplatesRes && smsTemplatesRes.ok ? ((await smsTemplatesRes.json()) as { data?: MessageTemplateOption[] }) : { data: [] };
    return {
      contacts: (contactsBody.data ?? []) as Contact[],
      roleProfiles: (rolesBody.data ?? []) as RoleProfile[],
      messageTemplates: [...(emailTemplatesBody.data ?? []), ...(smsTemplatesBody.data ?? [])] as MessageTemplateOption[],
      filterType,
      isAdmin,
    };
  } catch {
    return { contacts: [], roleProfiles: [], messageTemplates: [], filterType: "", isAdmin };
  }
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

  if (intent === "role-create") {
    const label = String(form.get("label") ?? "").trim();
    const kind = String(form.get("kind") ?? "") as "client" | "agent" | "other";
    if (!label || !kind) return { ok: false };
    const emailTemplateId = String(form.get("emailTemplateId") ?? "").trim();
    const smsTemplateId = String(form.get("smsTemplateId") ?? "").trim();
    const body: { label: string; kind: "client" | "agent" | "other"; emailTemplateId?: string; smsTemplateId?: string } = { label, kind };
    if (emailTemplateId) body.emailTemplateId = emailTemplateId;
    if (smsTemplateId) body.smsTemplateId = smsTemplateId;
    const res = await api.roleProfiles.index.$post({ json: body });
    return { ok: res.ok };
  }

  if (intent === "role-update") {
    const id = form.get("id") as string;
    const label = String(form.get("label") ?? "").trim();
    const emailTemplateId = String(form.get("emailTemplateId") ?? "").trim();
    const smsTemplateId = String(form.get("smsTemplateId") ?? "").trim();
    const res = await api.roleProfiles[":id"].$put({
      param: { id },
      json: {
        label,
        emailTemplateId: emailTemplateId || null,
        smsTemplateId: smsTemplateId || null,
      },
    });
    return { ok: res.ok };
  }

  if (intent === "role-delete") {
    const id = form.get("id") as string;
    const res = await api.roleProfiles[":id"].$delete({ param: { id } });
    return { ok: res.ok };
  }

  return { ok: false };
}

export default function ContactsPage() {
  const { contacts, roleProfiles, messageTemplates, filterType, isAdmin } = useLoaderData<typeof loader>();
  const TABS = [
    { id: "contacts", label: m.contacts_label_contacts() },
    { id: "agents", label: m.contacts_label_agents() },
    ...(isAdmin ? [{ id: "roles", label: m.contacts_label_roles() }] : []),
  ];
  const contactList = contacts as Contact[];
  const roleProfileList = roleProfiles as RoleProfile[];
  const templateList = messageTemplates as MessageTemplateOption[];
  const [activeTab, setActiveTab] = useState("contacts");
  const [modalOpen, setModalOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleProfile | null>(null);
  const [typeFilter, setTypeFilter] = useState(filterType || "");
  const [pendingArchive, setPendingArchive] = useState<Contact | null>(null);
  const archiveFetcher = useFetcher<{ ok?: boolean }>();

  const agentContacts = contactList.filter((c) => c.type === "agent");

  const openEdit = (c: Contact) => { setEditContact(c); setModalOpen(true); };
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

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title={`${filtered.length} ${filtered.length === 1 ? m.contacts_list_count_one() : m.contacts_label_contacts()}`}
        meta={m.contacts_list_meta_count({ count: filtered.length })}
        actions={
          activeTab === "roles" ? undefined : (
            <>
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
          )
        }
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === "contacts" && (
        <ContactsTable filtered={filtered} onEdit={openEdit} onArchive={setPendingArchive} />
      )}

      {activeTab === "agents" && (
        <AgentsTable agentContacts={agentContacts} onEdit={openEdit} onArchive={setPendingArchive} />
      )}

      {activeTab === "roles" && isAdmin && (
        <RolesTable
          roleProfiles={roleProfileList}
          onEdit={(p) => { setEditRole(p); setRoleModalOpen(true); }}
          onCreate={() => { setEditRole(null); setRoleModalOpen(true); }}
        />
      )}

      <ContactModal open={modalOpen} onClose={() => setModalOpen(false)} contact={editContact} />
      <CsvImportModal open={csvModalOpen} onClose={() => setCsvModalOpen(false)} />
      {isAdmin && (
        <RoleProfileModal
          open={roleModalOpen}
          onClose={() => setRoleModalOpen(false)}
          profile={editRole}
          templates={templateList}
        />
      )}

      <ConfirmDialog
        open={pendingArchive !== null}
        title={m.contacts_archive_title()}
        message={m.contacts_archive_confirm()}
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
