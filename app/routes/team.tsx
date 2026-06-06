import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/team";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SeatBanner } from "~/components/SeatBanner";
import { InviteSeatModal } from "~/components/modals/InviteSeatModal";
import { useSessionContext } from "~/hooks/useSessionContext";
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

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.team.members.$get();
    const body = res.ok ? ((await res.json()) as unknown as { data?: { members?: Member[] } }) : { data: { members: [] as Member[] } };
    return {
      members: (body.data?.members ?? []) as Member[],
      settings: {} as Record<string, unknown>,
    };
  } catch {
    return { members: [] as Member[], settings: {} };
  }
}

const ROLE_TONES: Record<string, "primary" | "info" | "neutral" | "warning" | "monitor" | "sat" | "gen"> = {
  owner: "primary",
  admin: "info",
  inspector: "neutral",
  lead: "info",
  specialist: "sat",
  apprentice: "monitor",
  agent: "warning",
  office: "gen",
};

const TABS = [
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending Invites" },
  { id: "apprentices", label: "Apprentices" },
  { id: "guests", label: "Guests" },
];

export default function TeamPage() {
  const { members } = useLoaderData<typeof loader>();
  const sessionCtx = useSessionContext();
  const [activeTab, setActiveTab] = useState("active");
  const [inviteOpen, setInviteOpen] = useState(false);

  const leads = members.filter((m) => m.role === "lead").map((m) => ({ id: m.id, email: m.email }));

  const filtered = members.filter((m) => {
    if (activeTab === "active") return m.status !== "pending" && m.role !== "apprentice";
    if (activeTab === "pending") return m.status === "pending";
    if (activeTab === "apprentices") return m.role === "apprentice";
    if (activeTab === "guests") return m.role === "guest";
    return true;
  });

  return (
    <div className="space-y-[18px]">
      {/* F3 — Seat quota banner */}
      {sessionCtx?.seatUsage && (
        <SeatBanner usage={sessionCtx.seatUsage} billingUrl={sessionCtx.branding?.portalBaseUrl ? `${sessionCtx.branding.portalBaseUrl}/billing` : undefined} />
      )}

      <PageHeader
        eyebrow="SETTINGS &middot; TEAM"
        eyebrowColor="slate"
        title="Workspace Team"
        meta={`${members.length} ${members.length === 1 ? "member" : "members"}`}
        actions={
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setInviteOpen(true)}>
            Invite Member
          </Button>
        }
      />

      <InviteSeatModal open={inviteOpen} onClose={() => setInviteOpen(false)} leads={leads} />

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
                    <Pill tone={ROLE_TONES[m.role] || "gen"}>{m.role}</Pill>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                      m.status === "active" ? "text-ih-ok-fg" : "text-ih-watch-fg"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${m.status === "active" ? "bg-ih-ok" : "bg-ih-watch"}`} />
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
