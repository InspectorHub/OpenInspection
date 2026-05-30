import { useState, useRef, useCallback } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/contacts";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";

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
      api.contacts.index.$get({ query: filterType ? { type: filterType } : {} }),
      api.agents.index.$get(),
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
    const body = {
      name: form.get("name") as string,
      email: form.get("email") as string,
      phone: form.get("phone") as string,
      agency: form.get("agency") as string,
      type: form.get("type") as string,
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
    const res = await api.contacts.import.$post({ json: { csv: csvText, mapping } });
    const data = res.ok ? await res.json() : {};
    return { ok: res.ok, result: data };
  }

  if (intent === "csv-preview") {
    const csvText = form.get("csvText") as string;
    const res = await api.contacts.import.preview.$post({ json: { csv: csvText } });
    const data = res.ok ? await res.json() : {};
    return { ok: res.ok, preview: data };
  }

  return { ok: false };
}

/**
 * Best-effort column mapping for the simple "paste CSV → import" flow:
 * matches column headers case-insensitively against the canonical field
 * names. If the CSV uses non-standard headers, falls back to the first
 * column as `name` so the import still succeeds for the common case.
 */
function inferMappingFromCsv(csv: string): { name: string; email?: string; phone?: string; agency?: string } {
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? "";
  const cols = firstLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const find = (...needles: string[]) =>
    cols.find((c) => needles.some((n) => c.toLowerCase() === n));
  const nameCol = find("name", "full name", "contact") ?? cols[0] ?? "name";
  const emailCol = find("email", "e-mail");
  const phoneCol = find("phone", "tel", "mobile");
  const agencyCol = find("agency", "company", "organization");
  const m: { name: string; email?: string; phone?: string; agency?: string } = { name: nameCol };
  if (emailCol) m.email = emailCol;
  if (phoneCol) m.phone = phoneCol;
  if (agencyCol) m.agency = agencyCol;
  return m;
}

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  agency: string;
  inspectionCount?: number;
}

interface Agent {
  id: string;
  name: string;
  email: string;
  status: string;
  linkedAt: string;
}

function ContactModal({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact: Contact | null;
}) {
  const fetcher = useFetcher();
  if (!open) return null;
  const isEdit = !!contact;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-ih-bg-card rounded-md shadow-2xl max-w-lg w-full">
        <header className="px-4 py-3 border-b border-ih-border flex items-center justify-between">
          <h3 className="text-lg font-bold text-ih-fg-1">{isEdit ? "Edit Contact" : "Add Contact"}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-ih-bg-muted hover:opacity-80 flex items-center justify-center text-ih-fg-3">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>
        <fetcher.Form method="post" className="p-4 space-y-4" onSubmit={() => setTimeout(onClose, 200)}>
          <input type="hidden" name="intent" value={isEdit ? "update" : "create"} />
          {isEdit && <input type="hidden" name="id" value={contact.id} />}
          <div>
            <label className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Type</label>
            <select name="type" defaultValue={contact?.type || "client"} className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm">
              <option value="client">Client</option>
              <option value="agent">Agent</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Full Name *</label>
            <input type="text" name="name" defaultValue={contact?.name || ""} placeholder="Jane Smith" required className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Email</label>
              <input type="email" name="email" defaultValue={contact?.email || ""} placeholder="jane@realty.com" className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Phone</label>
              <input type="tel" name="phone" defaultValue={contact?.phone || ""} placeholder="(555) 123-4567" className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Agency</label>
            <input type="text" name="agency" defaultValue={contact?.agency || ""} placeholder="Sunrise Realty" className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit">Save</Button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

function CsvImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fetcher = useFetcher();
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = (fetcher.data as Record<string, unknown>)?.preview as Record<string, unknown> | undefined;
  const importResult = (fetcher.data as Record<string, unknown>)?.result as Record<string, unknown> | undefined;

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-ih-bg-card rounded-md shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <header className="px-4 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-ih-fg-1">Import contacts from CSV</h2>
          <button onClick={onClose} className="text-ih-fg-4 hover:text-ih-fg-1 text-xl">&times;</button>
        </header>

        {step === "upload" && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-ih-fg-3">Upload a CSV with your contacts. Spectora and ITB exports work out of the box.</p>
            <input type="file" ref={fileRef} accept=".csv,text/csv" onChange={onFileChange} className="text-sm" />
            {fileName && <p className="text-xs text-ih-fg-3">Selected: {fileName}</p>}
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} placeholder="...or paste CSV content here" className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-xs font-mono" />
            <Button
              variant="primary"
              onClick={() => {
                fetcher.submit({ intent: "csv-preview", csvText }, { method: "post" });
                setStep("preview");
              }}
              disabled={!csvText.trim()}
            >
              Preview
            </Button>
          </div>
        )}

        {step === "preview" && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-ih-ok-bg rounded-lg">
                <div className="text-xl font-bold text-ih-ok-fg">{(preview as Record<string, number>)?.imported || 0}</div>
                <div className="text-xs text-ih-ok-fg mt-1">New contacts</div>
              </div>
              <div className="p-4 bg-ih-watch-bg rounded-lg">
                <div className="text-xl font-bold text-ih-watch-fg">{(preview as Record<string, number>)?.skipped || 0}</div>
                <div className="text-xs text-ih-watch-fg mt-1">Duplicates</div>
              </div>
              <div className="p-4 bg-ih-bad-bg rounded-lg">
                <div className="text-xl font-bold text-ih-bad-fg">{((preview as Record<string, unknown[]>)?.errors?.length) || 0}</div>
                <div className="text-xs text-ih-bad-fg mt-1">Errors</div>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setStep("upload")}>Back</Button>
              <button
                onClick={() => {
                  fetcher.submit({ intent: "csv-import", csvText }, { method: "post" });
                  setStep("done");
                }}
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-700"
              >
                Confirm Import
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="p-6 text-center">
            <div className="text-3xl mb-3">&#x2713;</div>
            <p className="text-lg font-bold text-ih-ok-fg">
              Imported {(importResult as Record<string, number>)?.imported || 0} contacts
            </p>
            <button onClick={onClose} className="mt-4 px-5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold uppercase tracking-widest">Done</button>
          </div>
        )}
      </div>
    </div>
  );
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
        eyebrow="Contacts"
        eyebrowColor="indigo"
        title="Contacts"
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
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Name</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Type</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Email</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Phone</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Agency</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Inspections</th>
                <th className="py-3 px-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState title="No contacts yet" description="Add one above to get started." />
                </td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="border-b border-ih-border hover:bg-ih-bg-muted/50">
                    <td className="py-3 px-4 text-[13px] font-medium text-ih-fg-1">{c.name}</td>
                    <td className="py-3 px-4 text-[13px]">
                      <Pill tone={c.type === "agent" ? "info" : "info"}>{c.type}</Pill>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.email || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.phone || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.agency || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.inspectionCount ?? 0}</td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => { setEditContact(c); setModalOpen(true); }} className="text-ih-primary text-[12px] font-bold hover:underline mr-3">Edit</button>
                      <deleteFetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="text-red-500 dark:text-red-400 text-[12px] font-bold hover:underline">Delete</button>
                      </deleteFetcher.Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}

      {activeTab === "agents" && (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Agent</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Status</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Linked</th>
                <th className="py-3 px-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {agentList.length === 0 ? (
                <tr><td colSpan={4}>
                  <EmptyState title="No agent partners yet" />
                </td></tr>
              ) : (
                agentList.map((a) => (
                  <tr key={a.id} className="border-b border-ih-border hover:bg-ih-bg-muted/50">
                    <td className="py-3 px-4 text-[13px] font-medium text-ih-fg-1">{a.name}</td>
                    <td className="py-3 px-4">
                      <Pill tone={a.status === "active" ? "sat" : "monitor"}>{a.status}</Pill>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{a.linkedAt || "—"}</td>
                    <td className="py-3 px-4 text-right">
                      <button className="text-red-500 text-[12px] font-bold hover:underline">Revoke</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
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
