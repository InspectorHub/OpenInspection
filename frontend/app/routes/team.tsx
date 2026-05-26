import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/team";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { extractArray, extractObject } from "~/lib/api-helpers";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Team - OpenInspection" }];
}

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  lastActiveAt: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/team", { token });
    const body = res.ok ? await res.json() : {};
    return {
      members: extractArray(body, "members") as Member[],
      settings: extractObject(body, "settings"),
    };
  } catch {
    return { members: [] as Member[], settings: {} };
  }
}

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-ih-primary-tint text-ih-primary",
  admin: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400",
  inspector: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  lead: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  specialist: "bg-ih-ok-bg text-ih-ok-fg",
  apprentice: "bg-ih-watch-bg text-ih-watch-fg",
  office: "bg-ih-bg-muted text-ih-fg-3",
};

const TABS = [
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending Invites" },
  { id: "apprentices", label: "Apprentices" },
  { id: "guests", label: "Guests" },
];

export default function TeamPage() {
  const { members } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("active");

  const filtered = members.filter((m) => {
    if (activeTab === "active") return m.status !== "pending" && m.role !== "apprentice";
    if (activeTab === "pending") return m.status === "pending";
    if (activeTab === "apprentices") return m.role === "apprentice";
    if (activeTab === "guests") return m.role === "guest";
    return true;
  });

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="SETTINGS &middot; TEAM"
        eyebrowColor="slate"
        title="Workspace Team"
        meta={`${members.length} ${members.length === 1 ? "member" : "members"}`}
        actions={
          <Button variant="primary" icon={<PlusIcon />}>
            Invite Member
          </Button>
        }
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={activeTab === "pending" ? "No pending invites" : "No members found"}
            description="Invite team members above to get started."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Name</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Role</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Status</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Last Active</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-ih-border hover:bg-ih-bg-muted/50">
                  <td className="py-3 px-4">
                    <p className="text-[13px] font-medium text-ih-fg-1">{m.name || "Unnamed"}</p>
                    <p className="text-[11px] text-ih-fg-3">{m.email}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] ${ROLE_COLORS[m.role] || ROLE_COLORS.office}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                      m.status === "active" ? "text-ih-ok-fg" : "text-ih-watch-fg"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${m.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
                      {m.status === "active" ? "Active" : "Pending"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[13px] text-ih-fg-3">
                    {m.lastActiveAt || "—"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Roles reference */}
      <Card className="p-6">
        <h2 className="text-sm font-bold text-ih-fg-1 mb-3">Roles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { role: "Lead inspector", desc: "Full edit, can publish, approves apprentice ratings." },
            { role: "Specialist", desc: "Full edit within their assigned sections." },
            { role: "Apprentice", desc: "Edits route through the lead's review queue before publish." },
            { role: "Office staff", desc: "Read-only access to inspections and scheduling." },
          ].map((r) => (
            <div key={r.role} className="p-3 border border-ih-border rounded-md">
              <p className="text-[13px] font-bold text-ih-fg-1">{r.role}</p>
              <p className="text-[12px] text-ih-fg-3 mt-0.5">{r.desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
    </svg>
  );
}
