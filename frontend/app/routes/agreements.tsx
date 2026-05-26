import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/agreements";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Agreements - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/agreements", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { agreements: (body.data ?? []) as unknown[] };
  } catch {
    return { agreements: [] };
  }
}

const TABS = [
  { id: "templates", label: "Templates" },
  { id: "signing", label: "Signing" },
];

export default function AgreementsPage() {
  const { agreements } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("templates");

  const filtered = activeTab === "templates"
    ? agreements.filter((a: any) => !a.signedAt)
    : agreements.filter((a: any) => a.signedAt);

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Library · Agreements"
        title="Agreements"
        meta={`${agreements.length} total`}
        actions={
          <Button variant="primary">+ New agreement</Button>
        }
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={activeTab === "templates" ? "No agreement templates yet" : "No signed agreements yet"}
            description={
              activeTab === "templates"
                ? 'Click "+ New agreement" above to create your first agreement template.'
                : "Signed agreements will appear here after clients complete the signing process."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">Title</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">
                  {activeTab === "templates" ? "Last updated" : "Signed"}
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">Status</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ih-border">
              {filtered.map((a: any) => (
                <tr key={a.id} className="hover:bg-ih-bg-muted/50 transition-colors">
                  <td className="px-4 py-3 text-[13px] font-semibold text-ih-fg-1">
                    {a.title || a.name || "Untitled"}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ih-fg-3">
                    {a.signedAt || a.updatedAt || "--"}
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={a.signedAt ? "sat" : "gen"}>
                      {a.signedAt ? "Signed" : "Draft"}
                    </Pill>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold">
                      {activeTab === "templates" ? "Edit" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
