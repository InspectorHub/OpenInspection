import { useLoaderData } from "react-router";
import type { Route } from "./+types/invoices";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Invoices - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.invoices.index.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return {
      invoices: (body.data ?? []) as unknown[],
      stats: {} as Record<string, number>,
    };
  } catch {
    return { invoices: [], stats: {} };
  }
}

export default function InvoicesPage() {
  const { invoices, stats } = useLoaderData<typeof loader>();
  const invoiceList = invoices as unknown[];
  const statData = stats as Record<string, number>;

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Invoices"
        eyebrowColor="emerald"
        title="Invoices"
        meta={`${invoiceList.length} invoices`}
        actions={
          <Button variant="primary">+ New Invoice</Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "TOTAL", value: statData.total || 0, isCurrency: false },
          { label: "UNPAID", value: statData.unpaid || 0, isCurrency: false },
          { label: "PAID", value: statData.paid || 0, isCurrency: false },
          { label: "REVENUE", value: statData.revenue || 0, isCurrency: true },
        ].map((s) => (
          <Card key={s.label} className="p-[14px]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3">
              {s.label}
            </div>
            <div className="text-xl font-bold mt-1 text-ih-fg-1">
              {s.isCurrency
                ? `$${(s.value / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`
                : s.value}
            </div>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ih-border">
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                Client
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                Amount
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                Due Date
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {invoiceList.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <EmptyState title="No invoices yet" />
                </td>
              </tr>
            ) : (
              invoiceList.map((inv: unknown) => {
                const invoice = inv as Record<string, unknown>;
                return (
                  <tr
                    key={invoice.id as string}
                    className="border-b border-ih-border hover:bg-ih-bg-muted/50"
                  >
                    <td className="py-3 px-4 text-[13px] font-medium text-ih-fg-1">
                      {invoice.clientName as string}
                    </td>
                    <td className="py-3 px-4 text-[13px] font-mono text-ih-fg-1">
                      $
                      {(
                        ((invoice.amount as number) || 0) / 100
                      ).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">
                      {(invoice.dueDate as string) || "—"}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">
                      {invoice.status as string}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
