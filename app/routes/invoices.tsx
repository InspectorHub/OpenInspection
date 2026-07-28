import { useState } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/invoices";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, StatCard, Button, EmptyState, Table, Pill, type PillTone } from "@core/shared-ui";
import { formatCurrency, formatDate } from "~/lib/format";
import { useDisplayLocale, useDisplayCurrency } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";
import { NewInvoiceModal, type InspectionOption } from "~/components/invoices/NewInvoiceModal";

export function meta() {
  return [{ title: m.invoices_meta_title() }];
}

type InvoiceRow = {
  id: string;
  clientName: string | null;
  amountCents: number;
  dueDate: string | null;
  status: "draft" | "sent" | "paid" | "partial" | "void";
  paymentMethod: "card" | "check" | "cash" | "offline" | "other" | null;
  inspectionId: string | null;
  // Phase B — the invoice's own snapshot currency; wins over the live tenant
  // setting so a historical record never gets re-labelled after a switch.
  currency: string;
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

// Built as a thunk (not a module-level const) so the Paraglide `m.*()` labels
// resolve inside the per-request locale scope instead of freezing at import.
function getPayMethods() {
  return [
    { value: "check", label: m.invoices_pay_method_check() },
    { value: "cash", label: m.invoices_pay_method_cash() },
    { value: "offline", label: m.invoices_pay_method_offline() },
    { value: "other", label: m.invoices_pay_method_other() },
  ] as const;
}

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
      return { intent, ok: false, error: m.invoices_action_error_amount() };
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
      return { intent, ok: false, error: err?.error?.message ?? m.invoices_action_error_create() };
    }
    return { intent, ok: true, error: null };
  }

  return { intent: null, ok: false, error: null };
}

const STATUS_TONE: Record<InvoiceRow["status"], PillTone> = {
  paid: "sat",
  partial: "monitor",
  sent: "info",
  draft: "neutral",
  void: "neutral",
};

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    card: m.invoices_method_label_card(),
    check: m.invoices_method_label_check(),
    cash: m.invoices_method_label_cash(),
    offline: m.invoices_method_label_offline(),
    other: m.invoices_method_label_other(),
  };
  return labels[method];
}

export default function InvoicesPage() {
  const { invoices, inspections } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const locale = useDisplayLocale();
  const currency = useDisplayCurrency();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const total = invoices.length;
  const paid = invoices.filter((i) => i.status === "paid").length;
  const unpaid = invoices.filter((i) => i.status !== "paid").length;
  const revenue = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + (i.amountCents || 0), 0);

  const countLabel = `${total} ${total === 1 ? m.invoices_meta_singular() : m.invoices_meta_plural()}`;
  // Only mention unpaid when there are some — "0 unpaid" is noise on a clean
  // ledger, and an empty list should not read as if something were pending.
  const metaLine = unpaid > 0 ? `${countLabel} · ${unpaid} ${m.invoices_meta_unpaid()}` : countLabel;

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
      {/* IA-97 — title and meta used to render the same sentence twice ("2
          Invoices" over "2 invoices"). Convention across list pages (templates,
          team) is title = the page's name, meta = the counts; the count moves
          down and the meta earns its line by naming the number that prompts
          action. */}
      <PageHeader
        title={m.invoices_count_plural()}
        meta={metaLine}
        actions={<Button variant="primary" onClick={() => setNewOpen(true)}>{m.invoices_new_button()}</Button>}
      />

      <NewInvoiceModal open={newOpen} onClose={() => setNewOpen(false)} inspections={inspections} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: m.invoices_stat_total(), value: String(total) },
          { label: m.invoices_stat_unpaid(), value: String(unpaid) },
          { label: m.invoices_stat_paid(), value: String(paid) },
          { label: m.invoices_stat_revenue(), value: formatCurrency(revenue, { locale, currency }) },
        ].map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <Table<InvoiceRow>
          rows={invoices}
          getRowKey={(invoice) => invoice.id}
          empty={<EmptyState title={m.invoices_empty_title()} />}
          columns={[
            {
              // IA-97 — the list was a dead end: no way from an invoice to the
              // inspection it bills, and a PAID row had no control at all, so
              // the page looked broken ("why is there no action?").
              //
              // The identity cell links, NOT the whole row via `onRowClick`:
              // the Action column holds real buttons, and a row-wide handler
              // would fire on every "Mark paid" click too. A <Link> is also
              // keyboard-reachable and middle-clickable, which a `<tr onClick>`
              // is not.
              //
              // It points at the hub rather than growing invoice actions here.
              // The hub already owns them — including the tokenized pay link,
              // which is minted per recipient (IA-34) and would cost one token
              // issue per row to reproduce on a list.
              label: m.invoices_col_client(),
              cell: (invoice) => {
                const name = invoice.clientName || "—";
                // A standalone invoice has no inspection to open.
                if (!invoice.inspectionId) {
                  return <span className="font-medium text-ih-fg-1">{name}</span>;
                }
                return (
                  <Link
                    to={`/inspections/${invoice.inspectionId}`}
                    title={m.invoices_row_view_inspection()}
                    className="font-medium text-ih-fg-1 hover:text-ih-primary hover:underline transition-colors"
                  >
                    {name}
                  </Link>
                );
              },
            },
            { label: m.invoices_col_amount(), cell: (invoice) => <span className="font-mono text-ih-fg-1">{formatCurrency(invoice.amountCents, { locale, currency: invoice.currency || currency })}</span> },
            { label: m.invoices_col_due(), cell: (invoice) => <span className="text-ih-fg-3">{invoice.dueDate ? formatDate(invoice.dueDate, { locale, timeZone: "UTC" }) : "—"}</span> },
            {
              label: m.invoices_col_status(),
              cell: (invoice) => {
                const isPaid = invoice.status === "paid";
                return (
                  <Pill tone={STATUS_TONE[invoice.status] ?? "neutral"} className="uppercase tracking-wide">
                    {invoice.status}
                    {isPaid && invoice.paymentMethod && (
                      <span className="font-medium normal-case tracking-normal opacity-80">· {methodLabel(invoice.paymentMethod)}</span>
                    )}
                  </Pill>
                );
              },
            },
            {
              label: m.invoices_col_action(),
              align: "right",
              cell: (invoice) => {
                const isPaid = invoice.status === "paid";
                const busy = submittingId === invoice.id;
                // IA-97 — a paid invoice has nothing left to mark, but an
                // Action column reading "—" looks like a missing feature
                // rather than a settled account. Offer the one thing still
                // worth doing: open the inspection it belongs to.
                if (isPaid) {
                  return invoice.inspectionId ? (
                    <Link
                      to={`/inspections/${invoice.inspectionId}`}
                      className="px-3 h-7 inline-flex items-center rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                    >
                      {m.invoices_row_view_inspection()}
                    </Link>
                  ) : (
                    <span className="text-[12px] text-ih-fg-4">—</span>
                  );
                }
                if (pickerFor === invoice.id) {
                  return (
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <span className="text-[11px] text-ih-fg-3 mr-1">{m.invoices_paid_by()}</span>
                      {getPayMethods().map((method) => (
                        <button
                          key={method.value}
                          onClick={() => markPaid(invoice.id, method.value)}
                          disabled={busy}
                          className="px-2 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 hover:border-ih-ok-fg hover:text-ih-ok-fg transition-colors disabled:opacity-50"
                        >
                          {method.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setPickerFor(null)}
                        disabled={busy}
                        className="px-2 h-7 rounded-md text-[12px] font-semibold text-ih-fg-4 hover:text-ih-fg-2 disabled:opacity-50"
                      >
                        {m.common_cancel()}
                      </button>
                    </div>
                  );
                }
                return (
                  <button
                    onClick={() => setPickerFor(invoice.id)}
                    className="px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                  >
                    {m.invoices_mark_paid()}
                  </button>
                );
              },
            },
          ]}
        />
      </Card>

      <p className="text-[12px] text-ih-fg-4">
        {m.invoices_footer_note()}
      </p>
    </div>
  );
}
