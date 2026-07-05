import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/team";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SeatBanner } from "~/components/SeatBanner";
import { InviteSeatDrawer } from "~/components/modals/InviteSeatDrawer";
import { useSessionContext } from "~/hooks/useSessionContext";
import { Breadcrumb } from "~/components/Breadcrumb";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Table } from "@core/shared-ui";

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
  manager: "info",
  inspector: "neutral",
  lead: "info",
  specialist: "sat",
  agent: "warning",
  office: "gen",
};

const TABS = [
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending Invites" },
];

export default function TeamPage() {
  const { members } = useLoaderData<typeof loader>();
  const sessionCtx = useSessionContext();
  const [activeTab, setActiveTab] = useState("active");
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = members.filter((m) => {
    if (activeTab === "active") return m.status !== "pending";
    if (activeTab === "pending") return m.status === "pending";
    return true;
  });

  // Reuse the same sessionCtx.seatUsage the SeatBanner below already consumes
  // (no extra API call) to gate the invite modal at open — see
  // InviteSeatDrawer's `seatLimitAtOpen` doc comment. `seatUsage` is null for
  // unlimited deployments, so `atCapSeatUsage` stays undefined (normal
  // invite form) in that case; the server's 402 SEAT_LIMIT_REACHED remains
  // the authoritative backstop for races.
  const billingUrl = sessionCtx?.branding?.portalBaseUrl ? `${sessionCtx.branding.portalBaseUrl}/billing` : undefined;
  const atCapSeatUsage =
    sessionCtx?.seatUsage && sessionCtx.seatUsage.used >= sessionCtx.seatUsage.limit
      ? { used: sessionCtx.seatUsage.used, max: sessionCtx.seatUsage.limit, billingUrl }
      : undefined;

  return (
    <div className="space-y-ih-list">
      {/* F3 — Seat quota banner */}
      {sessionCtx?.seatUsage && (
        <SeatBanner usage={sessionCtx.seatUsage} billingUrl={billingUrl} />
      )}

      <Breadcrumb
        items={[
          { label: "Settings", href: "/settings" },
          { label: "Team" },
        ]}
      />

      <PageHeader
        title="Workspace Team"
        meta={`${members.length} ${members.length === 1 ? "member" : "members"}`}
        actions={
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setInviteOpen(true)}>
            Invite Member
          </Button>
        }
      />

      <InviteSeatDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} seatLimitAtOpen={atCapSeatUsage} />

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
          <Table<Member>
            rows={filtered}
            getRowKey={(m) => m.id}
            columns={[
              {
                label: "Name",
                cell: (m) => (
                  <>
                    <p className="text-[13px] font-medium text-ih-fg-1">{m.name || "Unnamed"}</p>
                    <p className="text-[11px] text-ih-fg-3">{m.email}</p>
                  </>
                ),
              },
              { label: "Role", cell: (m) => <Pill tone={ROLE_TONES[m.role] || "gen"}>{m.role}</Pill> },
              {
                label: "Status",
                cell: (m) => (
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                    m.status === "active" ? "text-ih-ok-fg" : "text-ih-watch-fg"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${m.status === "active" ? "bg-ih-ok" : "bg-ih-watch"}`} />
                    {m.status === "active" ? "Active" : "Pending"}
                  </span>
                ),
              },
              { label: "Last Active", cell: (m) => <span className="text-ih-fg-3">{m.lastActiveAt || "—"}</span> },
              {
                label: "",
                align: "right",
                cell: () => (
                  <button className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1">
                    Edit
                  </button>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* Roles reference */}
      <Card className="p-6">
        <h2 className="text-sm font-bold text-ih-fg-1 mb-3">Roles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { role: "Owner", desc: "Account holder. Full access, including billing." },
            { role: "Manager", desc: "Back office: team, settings, scheduling, and all inspections." },
            { role: "Inspector", desc: "Conducts inspections; edits and publishes reports." },
            { role: "Agent", desc: "External agent. Read-only access to their own orders." },
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
