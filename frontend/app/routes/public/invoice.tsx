import { useLoaderData } from "react-router";
import type { Route } from "./+types/invoice";
import { apiFetch } from "~/lib/api.server";

export function meta() {
 return [{ title: "Invoice - OpenInspection" }];
}

interface InvoiceData {
 number: string;
 date: string;
 dueDate: string | null;
 status: "draft" | "sent" | "paid" | "overdue" | "void";
 clientName: string;
 inspectorName: string;
 lineItems: { description: string; amount: number }[];
 total: number;
}

export async function loader({ params }: Route.LoaderArgs) {
 try {
 const res = await apiFetch(`/api/public/r/${params.id}/invoice`);
 const body = res.ok ? await res.json() : {};
 const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
 return {
 invoice: (Object.keys(d).length > 0 ? d : null) as InvoiceData | null,
 error: res.ok ? null : "Invoice not found",
 };
 } catch {
 return { invoice: null, error: "Service unavailable" };
 }
}

const STATUS_STYLES: Record<string, string> = {
 paid: "bg-ih-ok-bg text-ih-ok-fg",
 sent: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
 overdue: "bg-ih-bad-bg text-ih-bad-fg",
 draft: "bg-ih-bg-muted text-ih-fg-3",
 void: "bg-ih-bg-muted text-ih-fg-3",
};

export default function InvoicePage() {
 const { invoice, error } = useLoaderData<typeof loader>();

 if (error || !invoice) {
 return (
 <div className="p-8 text-center">
 <h1 className="text-2xl font-bold">Invoice Not Found</h1>
 <p className="text-ih-fg-3 mt-2">
 {error ?? "This invoice is not available."}
 </p>
 </div>
 );
 }

 return (
 <div className="max-w-2xl mx-auto p-6">
 <div className="flex items-start justify-between mb-6">
 <div>
 <h1 className="text-xl font-bold">Invoice {invoice.number}</h1>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 {invoice.date}
 {invoice.dueDate && <span> &middot; Due {invoice.dueDate}</span>}
 </p>
 </div>
 <span
 className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded ${STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft}`}
 >
 {invoice.status}
 </span>
 </div>

 <div className="text-[13px] text-ih-fg-3 mb-6">
 <p>
 <span className="text-ih-fg-4">From:</span>{" "}
 {invoice.inspectorName}
 </p>
 <p>
 <span className="text-ih-fg-4">To:</span>{" "}
 {invoice.clientName}
 </p>
 </div>

 {/* Line items */}
 <div className="border border-ih-border rounded-lg overflow-hidden mb-6">
 {invoice.lineItems.map((item, i) => (
 <div
 key={i}
 className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
 >
 <span className="text-[13px]">{item.description}</span>
 <span className="text-[13px] font-medium">${item.amount}</span>
 </div>
 ))}
 <div className="flex items-center justify-between px-4 py-3 bg-ih-bg-app font-bold text-sm">
 <span>Total</span>
 <span>${invoice.total}</span>
 </div>
 </div>

 {invoice.status !== "paid" && invoice.status !== "void" && (
 <button
 type="button"
 className="w-full h-10 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
 >
 Pay Now
 </button>
 )}
 </div>
 );
}
