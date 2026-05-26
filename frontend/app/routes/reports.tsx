import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/reports";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, TabStrip, Card, Pill, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Reports - OpenInspection" }];
}

interface Report {
  id: string;
  address: string | null;
  clientName: string | null;
  date: string | null;
  status: string;
  paymentStatus: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/inspections?status=completed,delivered", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { reports: (body.data ?? []) as Report[] };
  } catch {
    return { reports: [] as Report[] };
  }
}

const TABS = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready for Review" },
  { id: "delivered", label: "Delivered" },
  { id: "signed", label: "Signed" },
];

const STATUS_TONE: Record<string, "monitor" | "sat" | "info"> = {
  completed: "monitor",
  delivered: "sat",
  signed: "info",
};

function statusLabel(s: string): string {
  if (s === "completed") return "Ready";
  if (s === "delivered") return "Delivered";
  if (s === "signed") return "Signed";
  return s;
}

export default function ReportsPage() {
  const { reports } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = reports.filter((r) => {
    if (activeTab === "ready" && r.status !== "completed") return false;
    if (activeTab === "delivered" && r.status !== "delivered") return false;
    if (activeTab === "signed" && r.status !== "signed") return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.address?.toLowerCase().includes(q) || r.clientName?.toLowerCase().includes(q));
    }
    return true;
  });

  const tabsWithCount = TABS.map((t) => ({
    ...t,
    count: t.id === "all" ? reports.length
      : t.id === "ready" ? reports.filter((r) => r.status === "completed").length
      : t.id === "delivered" ? reports.filter((r) => r.status === "delivered").length
      : reports.filter((r) => r.status === "signed").length,
  }));

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="REPORTS"
        eyebrowColor="emerald"
        title="Reports"
        meta={`${reports.length} ${reports.length === 1 ? "report" : "reports"}`}
        actions={
          <input
            type="search"
            placeholder="Search address, client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none transition-all text-[13px] font-medium placeholder:text-ih-fg-4"
          />
        }
      />

      <TabStrip tabs={tabsWithCount} activeId={activeTab} onChange={setActiveTab} />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No reports found"
            description={search ? "Try a different search term." : "Published inspection reports will appear here."}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-ih-border">
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Property</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Client</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Date</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Status</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Payment</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-ih-border hover:bg-ih-bg-muted/50">
                    <td className="py-3 px-4 text-[13px] font-medium text-ih-fg-1 max-w-[240px] truncate">
                      {r.address || "No address"}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">
                      {r.clientName || "No client"}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">
                      {r.date || "—"}
                    </td>
                    <td className="py-3 px-4">
                      <Pill tone={STATUS_TONE[r.status] || "gen"}>{statusLabel(r.status)}</Pill>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">
                      {r.paymentStatus || "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        to={`/inspections/${r.id}/edit`}
                        className="text-[12px] font-semibold text-ih-primary hover:opacity-80"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-ih-border">
            {filtered.map((r) => (
              <Link
                key={r.id}
                to={`/inspections/${r.id}/edit`}
                className="block px-4 py-3 hover:bg-ih-bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-ih-fg-1 truncate">
                    {r.address || "No address"}
                  </p>
                  <Pill tone={STATUS_TONE[r.status] || "gen"} className="ml-2 shrink-0">
                    {statusLabel(r.status)}
                  </Pill>
                </div>
                <p className="text-[11px] text-ih-fg-3 mt-0.5">
                  {r.clientName || "No client"} {r.date && <>&middot; {r.date}</>}
                </p>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
