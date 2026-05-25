import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/team";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, TabStrip, EmptyState } from "@core/shared-ui";

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
    const data = res.ok ? await res.json() : {};
    return {
      members: ((data as any)?.data?.members || []) as Member[],
      settings: (data as any)?.data?.settings || {},
    };
  } catch {
    return { members: [] as Member[], settings: {} };
  }
}

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400",
  admin: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400",
  inspector: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  lead: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  specialist: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  apprentice: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  office: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
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
          <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2 transition-colors">
            <PlusIcon /> Invite Member
          </button>
        }
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
          <EmptyState
            title={activeTab === "pending" ? "No pending invites" : "No members found"}
            description="Invite team members above to get started."
          />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Role</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Last Active</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <td className="py-3 px-4">
                    <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{m.name || "Unnamed"}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{m.email}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] ${ROLE_COLORS[m.role] || ROLE_COLORS.office}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                      m.status === "active" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${m.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
                      {m.status === "active" ? "Active" : "Pending"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[13px] text-slate-500 dark:text-slate-400">
                    {m.lastActiveAt || "—"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button className="text-[12px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Roles reference */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Roles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { role: "Lead inspector", desc: "Full edit, can publish, approves apprentice ratings." },
            { role: "Specialist", desc: "Full edit within their assigned sections." },
            { role: "Apprentice", desc: "Edits route through the lead's review queue before publish." },
            { role: "Office staff", desc: "Read-only access to inspections and scheduling." },
          ].map((r) => (
            <div key={r.role} className="p-3 border border-slate-200 dark:border-slate-700 rounded-md">
              <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{r.role}</p>
              <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{r.desc}</p>
            </div>
          ))}
        </div>
      </section>
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
