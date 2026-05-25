import { useState, useRef, useCallback } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/contacts";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Contacts - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const filterType = url.searchParams.get("type") || "";
  try {
    const [contactsRes, agentsRes] = await Promise.all([
      apiFetch(`/api/contacts${filterType ? `?type=${filterType}` : ""}`, { token }),
      apiFetch("/api/agents", { token }),
    ]);
    const contactsData = contactsRes.ok ? await contactsRes.json() : {};
    const agentsData = agentsRes.ok ? await agentsRes.json() : {};
    return {
      contacts: ((contactsData as Record<string, unknown>)?.data as unknown[]) || [],
      agents: ((agentsData as Record<string, unknown>)?.data as unknown[]) || [],
      filterType,
    };
  } catch {
    return { contacts: [], agents: [], filterType: "" };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "create" || intent === "update") {
    const id = form.get("id") as string | null;
    const body = {
      name: form.get("name"),
      email: form.get("email"),
      phone: form.get("phone"),
      agency: form.get("agency"),
      type: form.get("type"),
    };
    const res = id
      ? await apiFetch(`/api/contacts/${id}`, { token, method: "PUT", body: JSON.stringify(body) })
      : await apiFetch("/api/contacts", { token, method: "POST", body: JSON.stringify(body) });
    return { ok: res.ok };
  }

  if (intent === "delete") {
    const id = form.get("id") as string;
    const res = await apiFetch(`/api/contacts/${id}`, { token, method: "DELETE" });
    return { ok: res.ok };
  }

  if (intent === "csv-import") {
    const csvText = form.get("csvText") as string;
    const res = await apiFetch("/api/contacts/import", {
      token,
      method: "POST",
      body: JSON.stringify({ csv: csvText }),
    });
    const data = res.ok ? await res.json() : {};
    return { ok: res.ok, result: data };
  }

  if (intent === "csv-preview") {
    const csvText = form.get("csvText") as string;
    const res = await apiFetch("/api/contacts/import/preview", {
      token,
      method: "POST",
      body: JSON.stringify({ csv: csvText }),
    });
    const data = res.ok ? await res.json() : {};
    return { ok: res.ok, preview: data };
  }

  return { ok: false };
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
      <div className="bg-white dark:bg-slate-800 rounded-md shadow-2xl max-w-lg w-full">
        <header className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{isEdit ? "Edit Contact" : "Add Contact"}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center text-slate-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>
        <fetcher.Form method="post" className="p-4 space-y-4" onSubmit={() => setTimeout(onClose, 200)}>
          <input type="hidden" name="intent" value={isEdit ? "update" : "create"} />
          {isEdit && <input type="hidden" name="id" value={contact.id} />}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Type</label>
            <select name="type" defaultValue={contact?.type || "client"} className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm">
              <option value="client">Client</option>
              <option value="agent">Agent</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Full Name *</label>
            <input type="text" name="name" defaultValue={contact?.name || ""} placeholder="Jane Smith" required className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Email</label>
              <input type="email" name="email" defaultValue={contact?.email || ""} placeholder="jane@realty.com" className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Phone</label>
              <input type="tel" name="phone" defaultValue={contact?.phone || ""} placeholder="(555) 123-4567" className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Agency</label>
            <input type="text" name="agency" defaultValue={contact?.agency || ""} placeholder="Sunrise Realty" className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-md ring-1 ring-slate-300 dark:ring-slate-600 text-slate-700 dark:text-slate-300 text-[13px] font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 transition-all">Save</button>
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
      <div className="bg-white dark:bg-slate-800 rounded-md shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <header className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Import contacts from CSV</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-xl">&times;</button>
        </header>

        {step === "upload" && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">Upload a CSV with your contacts. Spectora and ITB exports work out of the box.</p>
            <input type="file" ref={fileRef} accept=".csv,text/csv" onChange={onFileChange} className="text-sm" />
            {fileName && <p className="text-xs text-slate-500">Selected: {fileName}</p>}
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} placeholder="...or paste CSV content here" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 text-xs font-mono" />
            <button
              onClick={() => {
                fetcher.submit({ intent: "csv-preview", csvText }, { method: "post" });
                setStep("preview");
              }}
              disabled={!csvText.trim()}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50"
            >
              Preview
            </button>
          </div>
        )}

        {step === "preview" && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{(preview as Record<string, number>)?.imported || 0}</div>
                <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">New contacts</div>
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                <div className="text-xl font-bold text-amber-700 dark:text-amber-400">{(preview as Record<string, number>)?.skipped || 0}</div>
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">Duplicates</div>
              </div>
              <div className="p-4 bg-rose-50 dark:bg-rose-900/20 rounded-lg">
                <div className="text-xl font-bold text-rose-700 dark:text-rose-400">{((preview as Record<string, unknown[]>)?.errors?.length) || 0}</div>
                <div className="text-xs text-rose-700 dark:text-rose-400 mt-1">Errors</div>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setStep("upload")} className="px-5 py-2 rounded-lg ring-2 ring-slate-300 dark:ring-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold">Back</button>
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
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
              Imported {(importResult as Record<string, number>)?.imported || 0} contacts
            </p>
            <button onClick={onClose} className="mt-4 px-5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold uppercase tracking-widest">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Contacts
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">Contacts</h1>
          <p className="text-[13px] text-slate-500 mt-1">{filtered.length} contacts</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 px-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-[13px] font-medium bg-white"
          >
            <option value="">All Types</option>
            <option value="agent">Agents</option>
            <option value="client">Clients</option>
          </select>
          <button onClick={() => setCsvModalOpen(true)} className="h-8 px-3 rounded-md ring-1 ring-slate-300 dark:ring-slate-600 text-slate-700 dark:text-slate-300 text-[13px] font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">
            Import CSV
          </button>
          <button onClick={() => { setEditContact(null); setModalOpen(true); }} className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Contact
          </button>
        </div>
      </div>

      <div className="flex items-center border-b border-slate-200 dark:border-slate-700">
        {[{ key: "contacts", label: "Contacts" }, { key: "agents", label: "Agents" }].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${
              activeTab === tab.key
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "contacts" && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Type</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Email</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Phone</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Agency</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Inspections</th>
                <th className="py-3 px-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-[13px] text-slate-500">No contacts yet. Add one above to get started.</td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="py-3 px-4 text-[13px] font-medium text-slate-900 dark:text-slate-100">{c.name}</td>
                    <td className="py-3 px-4 text-[13px]">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${c.type === "agent" ? "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400" : "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400"}`}>
                        {c.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">{c.email || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">{c.phone || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-slate-500">{c.agency || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-slate-500">{c.inspectionCount ?? 0}</td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => { setEditContact(c); setModalOpen(true); }} className="text-indigo-600 dark:text-indigo-400 text-[12px] font-bold hover:underline mr-3">Edit</button>
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
        </div>
      )}

      {activeTab === "agents" && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Agent</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Linked</th>
                <th className="py-3 px-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {agentList.length === 0 ? (
                <tr><td colSpan={4} className="py-12 text-center text-[13px] text-slate-500">No agent partners yet.</td></tr>
              ) : (
                agentList.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="py-3 px-4 text-[13px] font-medium text-slate-900 dark:text-slate-100">{a.name}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${a.status === "active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-500">{a.linkedAt || "—"}</td>
                    <td className="py-3 px-4 text-right">
                      <button className="text-red-500 text-[12px] font-bold hover:underline">Revoke</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <ContactModal open={modalOpen} onClose={() => setModalOpen(false)} contact={editContact} />
      <CsvImportModal open={csvModalOpen} onClose={() => setCsvModalOpen(false)} />
    </div>
  );
}
