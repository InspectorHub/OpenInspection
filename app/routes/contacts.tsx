import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/contacts";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { addContactSchema } from "~/lib/forms/contacts.schema";
import { PageHeader, TabStrip, Button } from "@core/shared-ui";
import { inferMappingFromCsv, type Contact, type Agent } from "~/components/contacts/contacts-helpers";
import { ContactModal } from "~/components/contacts/ContactModal";
import { CsvImportModal } from "~/components/contacts/CsvImportModal";
import { ContactsTable } from "~/components/contacts/ContactsTable";
import { AgentsTable } from "~/components/contacts/AgentsTable";

export function meta() {
  return [{ title: "Contacts - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const filterType = url.searchParams.get("type") || "";
  try {
    const api = createApi(context, { token });
    const [contactsRes, agentsRes] = await Promise.all([
      api.contacts.index.$get({ query: filterType === "agent" || filterType === "client" ? { type: filterType } : {} }),
      api.agents.links.$get(),
    ]);
    const contactsBody = contactsRes.ok ? ((await contactsRes.json()) as Record<string, unknown>) : { data: [] };
    const agentsBody = agentsRes.ok ? ((await agentsRes.json()) as Record<string, unknown>) : { data: [] };
    return {
      contacts: (contactsBody.data ?? []) as Contact[],
      agents: (agentsBody.data ?? []) as Agent[],
      filterType,
    };
  } catch {
    return { contacts: [], agents: [], filterType: "" };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  const api = createApi(context, { token });

  if (intent === "create" || intent === "update") {
    const id = form.get("id") as string | null;
    const submission = parseWithZod(form, { schema: addContactSchema });
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

  return { ok: false };
}

const TABS = [
  { id: "contacts", label: "Contacts" },
  { id: "agents", label: "Agents" },
];

export default function ContactsPage() {
  const { contacts, agents, filterType } = useLoaderData<typeof loader>();
  const contactList = contacts as Contact[];
  const agentList = agents as Agent[];
  const [activeTab, setActiveTab] = useState("contacts");
  const [modalOpen, setModalOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [typeFilter, setTypeFilter] = useState(filterType || "");
  const deleteFetcher = useFetcher();

  const filtered = typeFilter
    ? contactList.filter((c) => c.type === typeFilter)
    : contactList;

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title={`${filtered.length} ${filtered.length === 1 ? "Contact" : "Contacts"}`}
        meta={`${filtered.length} contacts`}
        actions={
          <>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-[13px] font-medium"
            >
              <option value="">All Types</option>
              <option value="agent">Agents</option>
              <option value="client">Clients</option>
            </select>
            <Button variant="secondary" size="sm" onClick={() => setCsvModalOpen(true)}>
              Import CSV
            </Button>
            <Button variant="primary" onClick={() => { setEditContact(null); setModalOpen(true); }} icon={<PlusIcon />}>
              Add Contact
            </Button>
          </>
        }
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === "contacts" && (
        <ContactsTable filtered={filtered} setEditContact={setEditContact} setModalOpen={setModalOpen} deleteFetcher={deleteFetcher} />
      )}

      {activeTab === "agents" && (
        <AgentsTable agentList={agentList} />
      )}

      <ContactModal open={modalOpen} onClose={() => setModalOpen(false)} contact={editContact} />
      <CsvImportModal open={csvModalOpen} onClose={() => setCsvModalOpen(false)} />
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
