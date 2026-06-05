import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/invoices";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Invoices - OpenInspection" }];
}

type InvoiceRow = {
  id: string;
  clientName: string | null;
  amountCents: number;
  dueDate: string | null;
  status: "draft" | "sent" | "paid" | "partial";
  paymentMethod: "card" | "check" | "cash" | "offline" | "other" | null;
  inspectionId: string | null;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.invoices.index.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { invoices: (body.data ?? []) as InvoiceRow[] };
  } catch {
    return { invoices: [] as InvoiceRow[] };
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
  if (fd.get("intent") === "mark-paid") {
    const id = String(fd.get("id") || "");
    const method = String(fd.get("method") || "offline") as
      "card" | "check" | "cash" | "offline" | "other";
    const api = createApi(context, { token });
    const res = await api.invoices[":id"]["mark-paid"].$post({ param: { id }, json: { method } });
    return { ok: res.ok };
  }
  return { ok: false };
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

const STATUS_PILL: Record<string, string> = {
  paid: "bg-ih-ok-bg text-ih-ok-fg",
  partial: "bg-ih-watch-bg text-ih-watch-fg",
  sent: "bg-ih-info-bg text-ih-info-fg",
  draft: "bg-ih-bg-muted text-ih-fg-3",
};

const METHOD_LABEL: Record<string, string> = {
  card: "Card", check: "Check", cash: "Cash", offline: "Offline", other: "Other",
};

export default function InvoicesPage() {
  const { invoices } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [pickerFor, setPickerFor] = useState<string | null>(null);

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
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Invoices"
        eyebrowColor="emerald"
        title="Invoices"
        meta={`${total} ${total === 1 ? "invoice" : "invoices"}`}
        actions={<Button variant="primary">+ New Invoice</Button>}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "TOTAL", value: String(total) },
          { label: "UNPAID", value: String(unpaid) },
          { label: "PAID", value: String(paid) },
          { label: "REVENUE", value: money(revenue) },
        ].map((s) => (
          <Card key={s.label} className="p-[14px]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3">{s.label}</div>
            <div className="text-xl font-bold mt-1 text-ih-fg-1">{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ih-border">
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Client</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Amount</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Due Date</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Status</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No invoices yet" />
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => {
                const isPaid = invoice.status === "paid";
                const busy = submittingId === invoice.id;
                return (
                  <tr key={invoice.id} className="border-b border-ih-border hover:bg-ih-bg-muted/50 align-middle">
                    <td className="py-3 px-4 text-[13px] font-medium text-ih-fg-1">{invoice.clientName || "—"}</td>
                    <td className="py-3 px-4 text-[13px] font-mono text-ih-fg-1">{money(invoice.amountCents)}</td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{invoice.dueDate || "—"}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_PILL[invoice.status] ?? STATUS_PILL.draft}`}>
                        {invoice.status}
                        {isPaid && invoice.paymentMethod && (
                          <span className="font-medium normal-case tracking-normal opacity-80">· {METHOD_LABEL[invoice.paymentMethod]}</span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {isPaid ? (
                        <span className="text-[12px] text-ih-fg-4">—</span>
                      ) : pickerFor === invoice.id ? (
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
                      ) : (
                        <button
                          onClick={() => setPickerFor(invoice.id)}
                          className="px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                        >
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <p className="text-[12px] text-ih-fg-4">
        &ldquo;Mark paid&rdquo; records an offline payment (check, cash, bank transfer) and unlocks the report. Online card payments are marked automatically when the customer pays.
      </p>
    </div>
  );
}
