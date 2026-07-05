import { useEffect, useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/invoices";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, StatCard, Button, EmptyState, Modal, Table, Pill, type PillTone } from "@core/shared-ui";

export function meta() {
  return [{ title: "Invoices - OpenInspection" }];
}

type InvoiceRow = {
  id: string;
  clientName: string | null;
  amountCents: number;
  dueDate: string | null;
  status: "draft" | "sent" | "paid" | "partial" | "void";
  paymentMethod: "card" | "check" | "cash" | "offline" | "other" | null;
  inspectionId: string | null;
};

type InspectionOption = {
  id: string;
  propertyAddress: string | null;
  clientName: string | null;
  date: string | null;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const [invRes, inspRes] = await Promise.all([
      api.invoices.index.$get(),
      api.inspections.index.$get({ query: { limit: "20" } }).catch(() => null),
    ]);
    const body = invRes.ok ? ((await invRes.json()) as Record<string, unknown>) : { data: [] };
    const inspBody = inspRes?.ok ? ((await inspRes.json()) as { data?: unknown[] }) : { data: [] };
    const inspections = ((inspBody.data ?? []) as Array<Record<string, unknown>>).map((i) => ({
      id: String(i.id ?? ""),
      propertyAddress: (i.propertyAddress as string | null) ?? null,
      clientName: (i.clientName as string | null) ?? null,
      date: (i.date as string | null) ?? null,
    }));
    return { invoices: (body.data ?? []) as InvoiceRow[], inspections };
  } catch {
    return { invoices: [] as InvoiceRow[], inspections: [] as InspectionOption[] };
  }
}

const PAY_METHODS = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "offline", label: "Bank / Other offline" },
  { value: "other", label: "Other" },
] as const;

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "mark-paid") {
    const id = String(fd.get("id") || "");
    const method = String(fd.get("method") || "offline") as
      "card" | "check" | "cash" | "offline" | "other";
    const api = createApi(context, { token });
    const res = await api.invoices[":id"]["mark-paid"].$post({ param: { id }, json: { method } });
    return { intent, ok: res.ok, error: null };
  }

  if (intent === "create-invoice") {
    const clientName = String(fd.get("clientName") || "").trim();
    const amountDollars = Number(String(fd.get("amount") || ""));
    const inspectionId = String(fd.get("inspectionId") || "").trim() || null;
    const dueDate = String(fd.get("dueDate") || "").trim() || null;
    const notes = String(fd.get("notes") || "").trim() || null;
    if (!clientName || !Number.isFinite(amountDollars) || amountDollars <= 0) {
      return { intent, ok: false, error: "Client name and a positive amount are required." };
    }
    const api = createApi(context, { token });
    const res = await api.invoices.index.$post({
      json: {
        inspectionId,
        clientName,
        amountCents: Math.round(amountDollars * 100),
        lineItems: [],
        dueDate,
        notes,
      },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { intent, ok: false, error: err?.error?.message ?? "Failed to create the invoice." };
    }
    return { intent, ok: true, error: null };
  }

  return { intent: null, ok: false, error: null };
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

const STATUS_TONE: Record<InvoiceRow["status"], PillTone> = {
  paid: "sat",
  partial: "monitor",
  sent: "info",
  draft: "neutral",
  void: "neutral",
};

const METHOD_LABEL: Record<string, string> = {
  card: "Card", check: "Check", cash: "Cash", offline: "Offline", other: "Other",
};

function NewInvoiceModal({
  open,
  onClose,
  inspections,
}: {
  open: boolean;
  onClose: () => void;
  inspections: InspectionOption[];
}) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const [clientName, setClientName] = useState("");

  // Close on successful create; the action revalidates the list automatically.
  // (onClose is intentionally omitted from deps — parent recreates it per render.)
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.intent === "create-invoice" && fetcher.data.ok) {
      onClose();
    }
  }, [fetcher.state, fetcher.data]);  

  if (!open) return null;
  const inputCls =
    "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all";
  const labelCls = "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1";

  return (
    <Modal open={open} onClose={onClose} title="New invoice" size="md">
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="create-invoice" />
        <div>
          <label htmlFor="ninv-inspection" className={labelCls}>Inspection (links the payment page)</label>
          <select
            id="ninv-inspection"
            name="inspectionId"
            className={inputCls}
            defaultValue=""
            onChange={(e) => {
              const insp = inspections.find((i) => i.id === e.target.value);
              if (insp?.clientName && !clientName) setClientName(insp.clientName);
            }}
          >
            <option value="">— No inspection (standalone invoice) —</option>
            {inspections.map((i) => (
              <option key={i.id} value={i.id}>
                {(i.propertyAddress || i.id.slice(0, 8)) + (i.date ? ` · ${i.date.slice(0, 10)}` : "")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ninv-client" className={labelCls}>Client name</label>
          <input
            id="ninv-client" name="clientName" required className={inputCls}
            value={clientName} onChange={(e) => setClientName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ninv-amount" className={labelCls}>Amount (USD)</label>
            <input id="ninv-amount" name="amount" type="number" min="0.01" step="0.01" required className={inputCls} />
          </div>
          <div>
            <label htmlFor="ninv-due" className={labelCls}>Due date</label>
            <input id="ninv-due" name="dueDate" type="date" className={inputCls} />
          </div>
        </div>
        <div>
          <label htmlFor="ninv-notes" className={labelCls}>Notes</label>
          <input id="ninv-notes" name="notes" className={inputCls} />
        </div>
        {fetcher.data?.intent === "create-invoice" && fetcher.data.error && (
          <p className="text-[12px] text-ih-bad-fg">{fetcher.data.error}</p>
        )}
        <div className="flex justify-end gap-3 pt-2 border-t border-ih-border">
          <button type="button" onClick={onClose} disabled={busy}
            className="h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {busy ? "Creating…" : "Create invoice"}
          </button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

export default function InvoicesPage() {
  const { invoices, inspections } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const total = invoices.length;
  const paid = invoices.filter((i) => i.status === "paid").length;
  const unpaid = invoices.filter((i) => i.status !== "paid").length;
  const revenue = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + (i.amountCents || 0), 0);

  // The row currently being submitted (optimistic disable).
  const submittingId =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "mark-paid"
      ? String(fetcher.formData.get("id"))
      : null;

  function markPaid(id: string, method: string) {
    fetcher.submit({ intent: "mark-paid", id, method }, { method: "post" });
    setPickerFor(null);
  }

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title={`${total} ${total === 1 ? "Invoice" : "Invoices"}`}
        meta={`${total} ${total === 1 ? "invoice" : "invoices"}`}
        actions={<Button variant="primary" onClick={() => setNewOpen(true)}>+ New Invoice</Button>}
      />

      <NewInvoiceModal open={newOpen} onClose={() => setNewOpen(false)} inspections={inspections} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "TOTAL", value: String(total) },
          { label: "UNPAID", value: String(unpaid) },
          { label: "PAID", value: String(paid) },
          { label: "REVENUE", value: money(revenue) },
        ].map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <Table<InvoiceRow>
          rows={invoices}
          getRowKey={(invoice) => invoice.id}
          empty={<EmptyState title="No invoices yet" />}
          columns={[
            { label: "Client", cell: (invoice) => <span className="font-medium text-ih-fg-1">{invoice.clientName || "—"}</span> },
            { label: "Amount", cell: (invoice) => <span className="font-mono text-ih-fg-1">{money(invoice.amountCents)}</span> },
            { label: "Due Date", cell: (invoice) => <span className="text-ih-fg-3">{invoice.dueDate || "—"}</span> },
            {
              label: "Status",
              cell: (invoice) => {
                const isPaid = invoice.status === "paid";
                return (
                  <Pill tone={STATUS_TONE[invoice.status] ?? "neutral"} className="uppercase tracking-wide">
                    {invoice.status}
                    {isPaid && invoice.paymentMethod && (
                      <span className="font-medium normal-case tracking-normal opacity-80">· {METHOD_LABEL[invoice.paymentMethod]}</span>
                    )}
                  </Pill>
                );
              },
            },
            {
              label: "Action",
              align: "right",
              cell: (invoice) => {
                const isPaid = invoice.status === "paid";
                const busy = submittingId === invoice.id;
                if (isPaid) return <span className="text-[12px] text-ih-fg-4">—</span>;
                if (pickerFor === invoice.id) {
                  return (
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <span className="text-[11px] text-ih-fg-3 mr-1">Paid by:</span>
                      {PAY_METHODS.map((m) => (
                        <button
                          key={m.value}
                          onClick={() => markPaid(invoice.id, m.value)}
                          disabled={busy}
                          className="px-2 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 hover:border-ih-ok-fg hover:text-ih-ok-fg transition-colors disabled:opacity-50"
                        >
                          {m.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setPickerFor(null)}
                        disabled={busy}
                        className="px-2 h-7 rounded-md text-[12px] font-semibold text-ih-fg-4 hover:text-ih-fg-2 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  );
                }
                return (
                  <button
                    onClick={() => setPickerFor(invoice.id)}
                    className="px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                  >
                    Mark paid
                  </button>
                );
              },
            },
          ]}
        />
      </Card>

      <p className="text-[12px] text-ih-fg-4">
        &ldquo;Mark paid&rdquo; records an offline payment (check, cash, bank transfer) and unlocks the report. Online card payments are marked automatically when the customer pays.
      </p>
    </div>
  );
}
