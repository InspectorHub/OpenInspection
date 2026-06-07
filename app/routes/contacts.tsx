import { useState, useCallback, useEffect } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useForm, type SubmissionResult } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/contacts";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { addContactSchema } from "~/lib/forms/contacts.schema";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, FileDropzone } from "@core/shared-ui";

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
  const isEdit = !!contact;

  // Conform: server validation flows back through fetcher.data (same as
  // useActionData but scoped to this fetcher). Cast to SubmissionResult<string[]>
  // so Conform's field accessor types are fully resolved (fields.*.errors is
  // string[] | undefined, not unknown[]).
  const lastResult =
    fetcher.data && typeof fetcher.data === "object" && "ok" in (fetcher.data as object)
      ? undefined // success sentinel — don't feed ok:true as a SubmissionResult
      : (fetcher.data as SubmissionResult<string[]> | undefined);

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: addContactSchema });
    },
    // eager-after-error: validate on blur first; once there's an error, switch
    // to real-time revalidation on every keystroke (project validation pattern).
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Close after a successful submission (fetcher.data has ok:true).
  const fetcherOk = (fetcher.data as { ok?: boolean } | undefined)?.ok;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.5)] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-ih-bg-card rounded-md shadow-ih-popover max-w-lg w-full">
        <header className="px-4 py-3 border-b border-ih-border flex items-center justify-between">
          <h3 className="text-lg font-bold text-ih-fg-1">{isEdit ? "Edit Contact" : "Add Contact"}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-ih-bg-muted hover:opacity-80 flex items-center justify-center text-ih-fg-3">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>
        <fetcher.Form
          method="post"
          id={form.id}
          onSubmit={(e) => {
            form.onSubmit(e);
            if (fetcherOk) setTimeout(onClose, 200);
          }}
          noValidate
          className="p-4 space-y-4"
        >
          <input type="hidden" name="intent" value={isEdit ? "update" : "create"} />
          {isEdit && <input type="hidden" name="id" value={contact.id} />}

          <div>
            <label htmlFor={fields.type.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Type</label>
            <select
              id={fields.type.id}
              name={fields.type.name}
              defaultValue={contact?.type || "client"}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            >
              <option value="client">Client</option>
              <option value="agent">Agent</option>
            </select>
          </div>

          <div>
            <label htmlFor={fields.name.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Full Name *</label>
            <input
              id={fields.name.id}
              name={fields.name.name}
              type="text"
              defaultValue={contact?.name || ""}
              placeholder="Jane Smith"
              aria-invalid={fields.name.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            />
            {fields.name.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={fields.email.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Email</label>
              <input
                id={fields.email.id}
                name={fields.email.name}
                type="email"
                defaultValue={contact?.email || ""}
                placeholder="jane@realty.com"
                aria-invalid={fields.email.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
              />
              {fields.email.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.email.errors[0]}</p>
              )}
            </div>
            <div>
              <label htmlFor={fields.phone.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Phone</label>
              <input
                id={fields.phone.id}
                name={fields.phone.name}
                type="tel"
                defaultValue={contact?.phone || ""}
                placeholder="(555) 123-4567"
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor={fields.agency.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Agency</label>
            <input
              id={fields.agency.id}
              name={fields.agency.name}
              type="text"
              defaultValue={contact?.agency || ""}
              placeholder="Sunrise Realty"
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            />
          </div>

          {form.errors && (
            <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg">
              {form.errors[0]}
            </div>
          )}

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
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // `!open` renders null but the component stays MOUNTED, so without this
  // reset a reopened modal resumes on the previous run's result step.
  useEffect(() => {
    if (open) {
      setStep("upload"); setCsvText(""); setFileName(""); setFileSize(null);
      setParsing(false); setFileError(null);
    }
  }, [open]);

  const preview = (fetcher.data as Record<string, unknown>)?.preview as Record<string, unknown> | undefined;
  const importResult = (fetcher.data as Record<string, unknown>)?.result as Record<string, unknown> | undefined;

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setFileSize(file.size);
    setFileError(null);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx")) {
      // Client-side parse (vendored ExcelJS, loaded on demand) → CSV text →
      // the same validate/import pipeline as a pasted CSV. The lazy library
      // load + workbook parse are async — surface it via the busy state.
      setParsing(true);
      import("~/lib/xlsx-import")
        .then((m) => m.parseXlsxFile(file))
        .then(setCsvText)
        .catch((err: unknown) => {
          setCsvText("");
          setFileName("");
          setFileSize(null);
          setFileError(err instanceof Error ? err.message : "Could not read the .xlsx file.");
        })
        .finally(() => setParsing(false));
      return;
    }
    if (lower.endsWith(".xls")) {
      // The 2003 binary format — ExcelJS doesn't read it; modern Excel/WPS/
      // Numbers all save as .xlsx in one step.
      setCsvText("");
      setFileName("");
      setFileSize(null);
      setFileError("Legacy .xls files aren't supported — save the file as .xlsx or CSV and retry.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  }, []);

  const clearFile = useCallback(() => {
    setFileName(""); setFileSize(null); setCsvText(""); setFileError(null);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.5)] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-ih-bg-card rounded-md shadow-ih-popover max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <header className="px-4 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-ih-fg-1">Import contacts from CSV</h2>
          <button onClick={onClose} className="text-ih-fg-4 hover:text-ih-fg-1 text-xl">&times;</button>
        </header>

        {step === "upload" && (
          <div className="p-6 space-y-4">
            <FileDropzone
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onFile={handleFile}
              fileName={fileName || null}
              fileSize={fileSize}
              busy={parsing}
              error={fileError}
              hint="CSV or Excel (.xlsx) — Spectora and ITB exports work out of the box"
              onClear={clearFile}
            />
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-ih-fg-4">
              <span className="h-px flex-1 bg-ih-border" />
              or paste below
              <span className="h-px flex-1 bg-ih-border" />
            </div>
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
            {/* The preview endpoint reports parse results (columns + row count) —
                it does NOT pre-compute import outcomes. The old three-card
                imported/duplicates/errors grid here read fields the preview
                never returned, so it always rendered 0/0/0. */}
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-4 bg-ih-ok-bg rounded-lg">
                <div className="text-xl font-bold text-ih-ok-fg">{(preview as Record<string, number>)?.totalRowsDetected || 0}</div>
                <div className="text-xs text-ih-ok-fg mt-1">Rows detected</div>
              </div>
              <div className="p-4 bg-ih-watch-bg rounded-lg">
                <div className="text-xl font-bold text-ih-watch-fg">{((preview as Record<string, unknown[]>)?.columns?.length) || 0}</div>
                <div className="text-xs text-ih-watch-fg mt-1">Columns</div>
              </div>
            </div>
            {Array.isArray((preview as Record<string, unknown[]>)?.columns) && ((preview as Record<string, unknown[]>).columns?.length ?? 0) > 0 && (
              <p className="text-xs text-ih-fg-3 text-center">
                Detected columns: {((preview as Record<string, string[]>).columns ?? []).join(", ")}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setStep("upload")}>Back</Button>
              <button
                onClick={() => {
                  fetcher.submit({ intent: "csv-import", csvText }, { method: "post" });
                  setStep("done");
                }}
                className="px-5 py-2 rounded-lg bg-ih-ok text-white text-xs font-bold uppercase tracking-widest hover:bg-ih-ok/85"
              >
                Confirm Import
              </button>
            </div>
          </div>
        )}

        {step === "done" && (() => {
          const r = importResult as { inserted?: number; skipped?: number; errors?: { row: number; message: string }[] } | undefined;
          const errs = r?.errors ?? [];
          // Transport/server failure (non-2xx) — never paint it as success.
          if (fetcher.data && (fetcher.data as { ok?: boolean }).ok === false) {
            return (
              <div className="p-6 text-center space-y-3">
                <p className="text-lg font-bold text-ih-bad-fg">Import failed</p>
                <p className="text-sm text-ih-fg-3">The server rejected the import. Nothing was written — try again, and contact support if it persists.</p>
                <div className="flex gap-3 justify-center">
                  <Button variant="secondary" onClick={() => setStep("upload")}>Back to file</Button>
                  <button onClick={onClose} className="px-5 py-2 rounded-lg bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest">Close</button>
                </div>
              </div>
            );
          }
          // B-29+ two-phase import: ANY row error means NOTHING was written —
          // the full error list comes back so the user fixes the file in one
          // pass and retries against an unchanged contact list.
          if (errs.length > 0) {
            return (
              <div className="p-6 space-y-4 overflow-y-auto">
                <p className="text-lg font-bold text-ih-bad-fg text-center">Nothing was imported</p>
                <p className="text-sm text-ih-fg-3 text-center">
                  The file imports all-or-nothing. Fix the rows below and retry — no duplicates will be created.
                </p>
                <ul className="text-xs text-ih-bad-fg bg-ih-bad-bg rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                  {errs.slice(0, 50).map((e) => (
                    <li key={`${e.row}-${e.message}`}>Row {e.row}: {e.message}</li>
                  ))}
                  {errs.length > 50 && <li>…and {errs.length - 50} more</li>}
                </ul>
                <div className="flex gap-3 justify-center">
                  <Button variant="secondary" onClick={() => setStep("upload")}>Back to file</Button>
                  <button onClick={onClose} className="px-5 py-2 rounded-lg bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest">Close</button>
                </div>
              </div>
            );
          }
          return (
            <div className="p-6 text-center">
              <div className="text-3xl mb-3">&#x2713;</div>
              <p className="text-lg font-bold text-ih-ok-fg">
                Imported {r?.inserted ?? 0} contacts
              </p>
              {(r?.skipped ?? 0) > 0 && (
                <p className="text-sm text-ih-fg-3 mt-1">
                  {r?.skipped} skipped (blank name or already in your contacts)
                </p>
              )}
              <button onClick={onClose} className="mt-4 px-5 py-2 rounded-lg bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest">Done</button>
            </div>
          );
        })()}
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
                    <td className="py-3 px-4 text-[13px] font-medium">
                      <Link to={`/contacts/${c.id}`} className="text-ih-fg-1 hover:text-ih-primary hover:underline">
                        {c.name}
                      </Link>
                    </td>
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
                        <button type="submit" className="text-ih-bad-fg text-[12px] font-bold hover:underline">Delete</button>
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
                      <button className="text-ih-bad-fg text-[12px] font-bold hover:underline">Revoke</button>
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
