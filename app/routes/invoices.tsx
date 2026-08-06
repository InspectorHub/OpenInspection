import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/invoices";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, StatCard, Button, EmptyState, Table, Banner, Modal } from "@core/shared-ui";
import { formatCurrency, formatDate } from "~/lib/format";
import { InvoiceAmountCell } from "~/components/invoices/InvoiceAmountCell";
import { useDisplayLocale, useDisplayCurrency } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";
import { NewInvoiceModal, type InspectionOption } from "~/components/invoices/NewInvoiceModal";
import { PaymentsModal, type PaymentRow } from "~/components/invoices/PaymentsModal";
import { InvoiceStatusCell } from "~/components/invoices/InvoiceStatusCell";
import { InvoiceRowActions } from "~/components/invoices/InvoiceRowActions";

export function meta() {
  return [{ title: m.invoices_meta_title() }];
}

type InvoiceRow = {
  id: string;
  clientName: string | null;
  amountCents: number;
  /** Cumulative amount received; null when a partial carries no recorded figure. */
  amountPaidCents: number | null;
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
  // `?payments=<invoiceId>` asks for one invoice's ledger as well as the list.
  // A query parameter rather than a second route: the modal needs the refreshed
  // BALANCE alongside the rows, and the balance lives on the invoice list.
  // `payments` is always present (empty by default) so the page's data shape
  // never becomes a union.
  const paymentsFor = new URL(request.url).searchParams.get("payments");
  try {
    const api = createApi(context, { token });
    const [invRes, inspRes, payRes] = await Promise.all([
      api.invoices.index.$get(),
      api.inspections.index.$get({ query: { limit: "20" } }).catch(() => null),
      paymentsFor
        ? api.invoices[":id"].payments.$get({ param: { id: paymentsFor } }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const body = invRes.ok ? ((await invRes.json()) as Record<string, unknown>) : { data: [] };
    const inspBody = inspRes?.ok ? ((await inspRes.json()) as { data?: unknown[] }) : { data: [] };
    const payBody = payRes?.ok ? ((await payRes.json()) as { data?: unknown[] }) : { data: [] };
    const inspections = ((inspBody.data ?? []) as Array<Record<string, unknown>>).map((i) => ({
      id: String(i.id ?? ""),
      propertyAddress: (i.propertyAddress as string | null) ?? null,
      clientName: (i.clientName as string | null) ?? null,
      date: (i.date as string | null) ?? null,
    }));
    return {
      invoices: (body.data ?? []) as InvoiceRow[],
      inspections,
      payments: (payBody.data ?? []) as PaymentRow[],
      loadFailed: false,
    };
  } catch {
    // IA-118 — an empty ledger says nothing is outstanding. That is a claim
    // about money owed to the business, and a failed fetch must not make it.
    return {
      invoices: [] as InvoiceRow[],
      inspections: [] as InspectionOption[],
      payments: [] as PaymentRow[],
      loadFailed: true,
    };
  }
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
    // Recording a payment is the one action on this page that moves money in
    // the operator's books. It used to discard the reason for a failure and
    // render nothing at all: the method picker closed, the row stayed SENT,
    // and an operator who had just banked a cheque was left to infer from an
    // unchanged pill that it had not been recorded — or to miss it entirely.
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { intent, ok: false, error: err?.error?.message ?? m.invoices_action_error_mark_paid() };
    }
    return { intent, ok: true, error: null };
  }

  // The offline-payment path. `occurredAt` arrives as a full ISO instant that
  // the BROWSER built from the date picker, because only the browser knows
  // which zone the chosen calendar day belongs to. It is never defaulted here:
  // an absent date is an error, not a licence to stamp now().
  if (intent === "record-payment") {
    const id = String(fd.get("id") || "");
    const amountDollars = Number(String(fd.get("amount") || ""));
    const method = String(fd.get("method") || "cash") as "check" | "cash" | "offline" | "other";
    const occurredAt = String(fd.get("occurredAt") || "");
    const note = String(fd.get("note") || "").trim() || null;
    const allowOverpayment = fd.get("allowOverpayment") === "1";
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
      return { intent, ok: false, error: m.invoices_payments_error_amount() };
    }
    if (!occurredAt) {
      return { intent, ok: false, error: m.invoices_payments_error_date() };
    }
    const api = createApi(context, { token });
    const res = await api.invoices[":id"].payments.$post({
      param: { id },
      json: { amountCents: Math.round(amountDollars * 100), method, occurredAt, note, allowOverpayment },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { intent, ok: false, error: err?.error?.message ?? m.invoices_payments_error_record() };
    }
    return { intent, ok: true, error: null };
  }

  // Append-only: a typo is corrected by a new row, never by editing the old one.
  if (intent === "correct-payment") {
    const id = String(fd.get("id") || "");
    const paymentId = String(fd.get("paymentId") || "");
    const amountDollars = Number(String(fd.get("amount") || ""));
    const reason = String(fd.get("reason") || "").trim();
    if (!Number.isFinite(amountDollars) || amountDollars < 0) {
      return { intent, ok: false, error: m.invoices_payments_error_amount() };
    }
    if (!reason) {
      return { intent, ok: false, error: m.invoices_payments_error_reason() };
    }
    const api = createApi(context, { token });
    const res = await api.invoices[":id"].payments[":paymentId"].corrections.$post({
      param: { id, paymentId },
      json: { correctedAmountCents: Math.round(amountDollars * 100), reason },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { intent, ok: false, error: err?.error?.message ?? m.invoices_payments_error_correct() };
    }
    return { intent, ok: true, error: null };
  }

  // IA-123 — DELETE /api/invoices/{id} does NOT delete. The service comment is
  // explicit: it voids, and "the row is preserved for the audit trail". So the
  // intent is named for what happens, and the confirm copy says the same.
  if (intent === "void-invoice") {
    const id = String(fd.get("id") || "");
    const api = createApi(context, { token });
    const res = await api.invoices[":id"].$delete({ param: { id } });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { intent, ok: false, error: err?.error?.message ?? m.invoices_action_error_void() };
    }
    return { intent, ok: true, error: null };
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

export default function InvoicesPage() {
  const { invoices, inspections, loadFailed } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const locale = useDisplayLocale();
  const currency = useDisplayCurrency();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // The ledger is loaded through its own fetcher so opening the modal does not
  // navigate. React Router revalidates an active fetcher load after any action
  // on this route, so recording or correcting a payment refreshes both the rows
  // and the balance without a second request written by hand.
  const ledgerFetcher = useFetcher<typeof loader>();
  const paymentFetcher = useFetcher<typeof action>();
  const [paymentsFor, setPaymentsFor] = useState<InvoiceRow | null>(null);
  function openPayments(invoice: InvoiceRow) {
    setPaymentsFor(invoice);
    ledgerFetcher.load(`/invoices?payments=${encodeURIComponent(invoice.id)}`);
  }

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
    fetcher.state !== "idle" &&
    (fetcher.formData?.get("intent") === "mark-paid" || fetcher.formData?.get("intent") === "void-invoice")
      ? String(fetcher.formData.get("id"))
      : null;

  // Voiding is not reversible from this page, so it is confirmed. A custom
  // modal, never window.confirm.
  const [pendingVoid, setPendingVoid] = useState<InvoiceRow | null>(null);
  function confirmVoid() {
    if (!pendingVoid) return;
    fetcher.submit({ intent: "void-invoice", id: pendingVoid.id }, { method: "post" });
    setPendingVoid(null);
  }

  function markPaid(id: string, method: string) {
    fetcher.submit({ intent: "mark-paid", id, method }, { method: "post" });
    setPickerFor(null);
  }

  return (
    <div className="space-y-ih-list">
      {/* IA-118 — an empty ledger says nothing is outstanding, which is a claim
          about money owed. Do not make it on a failed fetch. */}
      {loadFailed && <LoadFailedNotice what={m.invoices_count_plural()} />}
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

      <PaymentsModal
        invoice={paymentsFor}
        // The balance is derived from these rows against the invoice total, so
        // it moves the moment the ledger does. Nothing reads a cached paid
        // figure — that column is a cache, and this is the thing it caches.
        payments={ledgerFetcher.data?.payments ?? []}
        loading={ledgerFetcher.state !== "idle"}
        fetcher={paymentFetcher}
        locale={locale}
        onClose={() => setPaymentsFor(null)}
      />

      {/* IA-123 — says what voiding actually does. The row survives for the
          audit trail; what changes is that the invoice stops counting and stops
          gating the report. Calling it "delete" would promise a disappearance
          that does not happen. */}
      <Modal
        open={pendingVoid !== null}
        onClose={() => setPendingVoid(null)}
        title={m.invoices_void_title()}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingVoid(null)}>{m.common_cancel()}</Button>
            <Button variant="danger" onClick={confirmVoid}>{m.invoices_action_void()}</Button>
          </>
        }
      >
        <p className="text-[13px] text-ih-fg-2">{m.invoices_void_confirm()}</p>
      </Modal>

      {/* The create path already surfaces its errors inside the modal; the
          mark-paid path had nowhere to put one, so it silently swallowed them.
          Scoped to mark-paid to avoid double-reporting a create failure. */}
      {fetcher.state === "idle" && fetcher.data?.intent === "mark-paid" && fetcher.data.ok === false && (
        <Banner tone="danger">
          {fetcher.data.error ?? m.invoices_action_error_mark_paid()}
        </Banner>
      )}

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
              // IA-122 — the name is TEXT, not a link, and the row has no
              // `onRowClick`. It used to be a hover-only Link to the
              // inspection, which gave three rows three different ways to
              // reach one destination and announced a person's name as "View
              // inspection". The single labelled control lives in the Action
              // column (see InvoiceRowActions); a row-wide handler would also
              // fire on every button inside it.
              label: m.invoices_col_client(),
              cell: (invoice) => (
                <span className="font-medium text-ih-fg-1">{invoice.clientName || "—"}</span>
              ),
            },
            { label: m.invoices_col_amount(), cell: (invoice) => <InvoiceAmountCell invoice={invoice} currency={currency} locale={locale} /> },
            { label: m.invoices_col_due(), cell: (invoice) => <span className="text-ih-fg-3">{invoice.dueDate ? formatDate(invoice.dueDate, { locale, timeZone: "UTC" }) : "—"}</span> },
            { label: m.invoices_col_status(), cell: (invoice) => <InvoiceStatusCell invoice={invoice} /> },
            {
              label: m.invoices_col_action(),
              align: "right",
              cell: (invoice) => (
                <InvoiceRowActions
                  invoice={invoice}
                  busy={submittingId === invoice.id}
                  pickerOpen={pickerFor === invoice.id}
                  onOpenPicker={() => setPickerFor(invoice.id)}
                  onCancelPicker={() => setPickerFor(null)}
                  onOpenPayments={() => openPayments(invoice)}
                  onMarkPaid={(method) => markPaid(invoice.id, method)}
                  onVoid={() => setPendingVoid(invoice)}
                />
              ),
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
