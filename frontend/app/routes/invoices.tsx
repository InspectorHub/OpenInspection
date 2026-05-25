import { useLoaderData } from "react-router";
import type { Route } from "./+types/invoices";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Invoices - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/invoices", { token });
    const data = res.ok ? await res.json() : {};
    const parsed = data as Record<string, unknown>;
    return {
      invoices: (parsed?.data as unknown[]) || [],
      stats: (parsed?.stats as Record<string, number>) || {},
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
      {/* PageHeader */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Invoices
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">
            Invoices
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            {invoiceList.length} invoices
          </p>
        </div>
        <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2 transition-colors">
          + New Invoice
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "TOTAL", value: statData.total || 0, isCurrency: false },
          { label: "UNPAID", value: statData.unpaid || 0, isCurrency: false },
          { label: "PAID", value: statData.paid || 0, isCurrency: false },
          { label: "REVENUE", value: statData.revenue || 0, isCurrency: true },
        ].map((s) => (
          <div
            key={s.label}
            className="p-[14px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {s.label}
            </div>
            <div className="text-xl font-bold mt-1 text-slate-900 dark:text-slate-100">
              {s.isCurrency
                ? `$${(s.value / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`
                : s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Client
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Amount
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Due Date
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {invoiceList.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="py-12 text-center text-[13px] text-slate-500"
                >
                  No invoices yet
                </td>
              </tr>
            ) : (
              invoiceList.map((inv: unknown) => {
                const invoice = inv as Record<string, unknown>;
                return (
                  <tr
                    key={invoice.id as string}
                    className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                  >
                    <td className="py-3 px-4 text-[13px] font-medium text-slate-900 dark:text-slate-100">
                      {invoice.clientName as string}
                    </td>
                    <td className="py-3 px-4 text-[13px] font-mono text-slate-900 dark:text-slate-100">
                      $
                      {(
                        ((invoice.amount as number) || 0) / 100
                      ).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-500">
                      {(invoice.dueDate as string) || "—"}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">
                      {invoice.status as string}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
